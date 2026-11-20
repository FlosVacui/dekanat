// 20.11, «Сводка недели от ИИ»: числа из слоя доступа, сообщение модели, проверка ответа, подмена сети.
// Настоящая модель не вызывается. Данные слоя — основной набор вымышленных аккаунтов плюс строки, которые тест вставляет под владельцем.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUESTION_TOPICS } from '@/lib/questions'
import { REQUEST_KINDS, REQUEST_STATUSES } from '@/lib/requests'
import {
  WEEK_SUMMARY_PROMPT,
  buildWeekSummaryUser,
  cleanWeekSummary,
  isEmptyDigest,
  resetAiLimits,
  summarizeWeek,
} from '@/server/ai'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as staffDal from '@/server/dal/staff'
import type { WeekDigest } from '@/server/dal/staff'
import { STAFF_ALT, STAFF_MAIN, STUDENT_A } from './fixtures'
import { actorFor, withOwner } from './helpers'

const TODAY = '2026-11-20'
const KEY = 'test-key-not-real-0000'

function reply(content: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: init.status ?? 200 })
}

function enableAi() {
  vi.stubEnv('AI_BASE_URL', 'https://llm.example.test/v1')
  vi.stubEnv('AI_API_KEY', KEY)
  vi.stubEnv('AI_MODEL', 'model-x')
  vi.stubEnv('AI_FOLDER_ID', '')
}

/** Заявки: справок из деканата подано 5 (было 3), две в работе и одна просрочена; вопросов по расписанию 4 (было 1), без ответа 3. */
function digest(): WeekDigest {
  const zero = () => Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as WeekDigest['requests'][number]['byStatus']
  return {
    requests: REQUEST_KINDS.map((kind) =>
      kind === 'dean_certificate'
        ? { kind, total: 5, byStatus: { ...zero(), submitted: 1, in_progress: 2, ready: 2 }, previousWeek: 3, overdue: 1 }
        : { kind, total: 0, byStatus: zero(), previousWeek: 0, overdue: 0 },
    ),
    questions: QUESTION_TOPICS.map((topic) =>
      topic === 'schedule' ? { topic, total: 4, unanswered: 3, previousWeek: 1 } : { topic, total: 0, unanswered: 0, previousWeek: 0 },
    ),
  }
}

const GOOD = 'Справок из деканата подано 5, неделей раньше было 3.\nПросрочена 1 заявка.\nВопросов по расписанию 4, без ответа 3.\nНачните с ответов на вопросы о расписании.'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubEnv('AI_BASE_URL', '')
  vi.stubEnv('AI_API_KEY', '')
  vi.stubEnv('AI_MODEL', '')
  vi.stubEnv('AI_FOLDER_ID', '')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  resetAiLimits()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('промпт P-AI-04 совпадает с кодом', () => {
  it('prompts/P-AI-04-week-summary.md содержит промпт дословно; в нём нет места для имён и текстов', () => {
    const md = readFileSync(fileURLToPath(new URL('../../../prompts/P-AI-04-week-summary.md', import.meta.url)), 'utf8')
    expect(md).toContain(WEEK_SUMMARY_PROMPT)
    expect(WEEK_SUMMARY_PROMPT).toContain('От 4 до 6 строк')
    expect(WEEK_SUMMARY_PROMPT).not.toMatch(/\{\{/)
  })
})

describe('что уходит модели', () => {
  it('числа по видам, статусам и темам; итоги посчитаны сервером', () => {
    const text = buildWeekSummaryUser(digest())
    expect(text).toContain('Справка из деканата: подано 5 (3); сейчас: Подана — 1, В работе — 2, Готова — 2; просрочено сейчас: 1')
    expect(text).toContain('Справка об оплате обучения: подано 0 (0); сейчас: нет; просрочено сейчас: 0')
    expect(text).toContain('Всего заявок: 5 (3). Всего просрочено сейчас: 1.')
    expect(text).toContain('Расписание и занятия: задано 4 (1); без ответа сейчас: 3')
    expect(text).toContain('Всего вопросов: 4 (1). Всего без ответа: 3.')
  })

  it('в сообщении нет ничего, кроме меток и чисел: ни ФИО, ни групп, ни текстов', () => {
    const text = buildWeekSummaryUser(digest())
    for (const forbidden of [STUDENT_A.fullName, STUDENT_A.login, STUDENT_A.groupName, 'Белозёров']) expect(text).not.toContain(forbidden)
    // Каждая строка — «метка: числа»; цифр и пунктуации хватает, а длинных текстов нет.
    for (const line of text.split('\n')) expect(line.length).toBeLessThan(160)
  })

  it('пустая неделя: сводить нечего', () => {
    const empty: WeekDigest = {
      requests: digest().requests.map((r) => ({ ...r, total: 0, previousWeek: 0, overdue: 0 })),
      questions: digest().questions.map((q) => ({ ...q, total: 0, unanswered: 0, previousWeek: 0 })),
    }
    expect(isEmptyDigest(empty)).toBe(true)
    expect(isEmptyDigest(digest())).toBe(false)
  })
})

describe('проверка ответа модели', () => {
  const sent = buildWeekSummaryUser(digest())

  it('хороший ответ: строки без маркеров и разметки', () => {
    const raw = '- **Справок** подано 5, прошлые 7 суток — 3.\n2. Просрочена 1 заявка.\n\n• Вопросов по расписанию 4, без ответа 3.\nНачните с вопросов.'
    expect(cleanWeekSummary(raw, sent)).toEqual([
      'Справок подано 5, прошлые 7 суток — 3.',
      'Просрочена 1 заявка.',
      'Вопросов по расписанию 4, без ответа 3.',
      'Начните с вопросов.',
    ])
  })

  it('выдуманное число — отказ: 9 заявок нет в данных', () => {
    expect(cleanWeekSummary('Подано 9 заявок.\nНачните с просроченных.', sent)).toBeNull()
  })

  it('проценты, посчитанные моделью, — отказ: 67 нет в данных', () => {
    expect(cleanWeekSummary('Рост на 67 процентов.\nНачните с просроченных.', sent)).toBeNull()
  })

  it('одна строка, семь строк, слишком длинная строка — отказ', () => {
    expect(cleanWeekSummary('Одна строка.', sent)).toBeNull()
    expect(cleanWeekSummary(Array.from({ length: 7 }, () => 'Строка.').join('\n'), sent)).toBeNull()
    expect(cleanWeekSummary(`${'а'.repeat(301)}\nВторая.`, sent)).toBeNull()
    expect(cleanWeekSummary('', sent)).toBeNull()
  })

  it('управляющие знаки убираются', () => {
    expect(cleanWeekSummary('Первая\u0000 строка.\nВторая.', sent)).toEqual(['Первая строка.', 'Вторая.'])
  })
})

describe('summarizeWeek: подмена сети', () => {
  it('без ключа: модель не вызывается, ответ «disabled»', async () => {
    expect(await summarizeWeek(digest(), 'u1')).toEqual({ kind: 'failed', reason: 'disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('валидный ответ: строки; запрос — системное сообщение с промптом и сообщение с числами', async () => {
    enableAi()
    fetchMock.mockResolvedValue(reply(GOOD))
    const result = await summarizeWeek(digest(), 'u1')
    expect(result).toEqual({ kind: 'summary', lines: GOOD.split('\n') })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://llm.example.test/v1/chat/completions')
    const body = JSON.parse(init.body as string) as { messages: { role: string; content: string }[]; temperature: number }
    expect(body.temperature).toBe(0)
    expect(body.messages).toEqual([
      { role: 'system', content: WEEK_SUMMARY_PROMPT },
      { role: 'user', content: buildWeekSummaryUser(digest()) },
    ])
    // Ключ — только в заголовке.
    expect(init.body as string).not.toContain(KEY)
  })

  it('мусор вместо текста (одна строка или выдуманные числа) — отказ «bad_response»', async () => {
    enableAi()
    fetchMock.mockResolvedValueOnce(reply('Не знаю.'))
    expect(await summarizeWeek(digest(), 'u1')).toEqual({ kind: 'failed', reason: 'bad_response' })
    fetchMock.mockResolvedValueOnce(reply('Подано 99 заявок.\nСрочно ответьте всем.'))
    expect(await summarizeWeek(digest(), 'u1')).toEqual({ kind: 'failed', reason: 'bad_response' })
    fetchMock.mockResolvedValueOnce(reply(''))
    expect(await summarizeWeek(digest(), 'u1')).toEqual({ kind: 'failed', reason: 'bad_response' })
  })

  it('ошибка сервиса и сбой сети — отказ без исключения', async () => {
    enableAi()
    fetchMock.mockResolvedValueOnce(reply('x', { status: 500 }))
    expect(await summarizeWeek(digest(), 'u1')).toEqual({ kind: 'failed', reason: 'http' })
    fetchMock.mockRejectedValueOnce(new Error('сеть'))
    expect(await summarizeWeek(digest(), 'u1')).toEqual({ kind: 'failed', reason: 'network' })
  })

  it('неделя пустая: модель не вызывается', async () => {
    enableAi()
    const empty: WeekDigest = {
      requests: digest().requests.map((r) => ({ ...r, total: 0, previousWeek: 0, overdue: 0 })),
      questions: digest().questions.map((q) => ({ ...q, total: 0, unanswered: 0, previousWeek: 0 })),
    }
    expect(await summarizeWeek(empty, 'u1')).toEqual({ kind: 'empty' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('предел вызовов общий: одиннадцатый вызов за минуту — «rate_limited» без сети', async () => {
    enableAi()
    fetchMock.mockImplementation(async () => reply(GOOD))
    for (let i = 0; i < 10; i++) expect((await summarizeWeek(digest(), 'u-limit')).kind).toBe('summary')
    expect(await summarizeWeek(digest(), 'u-limit')).toEqual({ kind: 'failed', reason: 'rate_limited' })
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })
})

// ---------- Слой доступа: числа недели ----------

let staff: Actor
let altStaff: Actor
let student: Actor
const TAG = 'Сводка-недели-тест'
const DAY = 86_400_000

beforeAll(async () => {
  ;[staff, altStaff, student] = await Promise.all([actorFor(STAFF_MAIN), actorFor(STAFF_ALT), actorFor(STUDENT_A)])
})
afterAll(async () => {
  await withOwner((c) => c.query(`delete from questions where body like $1`, [`${TAG}%`]))
  await closeDb()
})

describe('getCohortWeekDigest', () => {
  it('студент получает отказ, а не пустой ответ', async () => {
    await expect(staffDal.getCohortWeekDigest(student, TODAY)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('видов и тем — по списку; нули есть; у вида сумма по статусам равна числу', async () => {
    const d = await staffDal.getCohortWeekDigest(staff, TODAY)
    expect(d.requests.map((r) => r.kind)).toEqual([...REQUEST_KINDS])
    expect(d.questions.map((q) => q.topic)).toEqual([...QUESTION_TOPICS])
    for (const r of d.requests) expect(REQUEST_STATUSES.reduce((sum, s) => sum + r.byStatus[s], 0)).toBe(r.total)
  })

  it('числа совпадают со списком заявок слоя: неделя и предыдущая неделя считаются от «сейчас»', async () => {
    const now = new Date()
    const d = await staffDal.getCohortWeekDigest(staff, TODAY, now)
    const list = await staffDal.listCohortRequests(staff)
    for (const r of d.requests) {
      const mine = list.filter((x) => x.kind === r.kind)
      expect(r.total).toBe(mine.filter((x) => x.createdAt.getTime() >= now.getTime() - 7 * DAY).length)
      expect(r.previousWeek).toBe(mine.filter((x) => x.createdAt.getTime() < now.getTime() - 7 * DAY && x.createdAt.getTime() >= now.getTime() - 14 * DAY).length)
    }
  })

  it('вопросы: неделя, предыдущая неделя и «без ответа» — по темам; старше двух недель не считается', async () => {
    const now = new Date()
    const before = await staffDal.getCohortWeekDigest(staff, TODAY, now)
    const altBefore = await staffDal.getCohortWeekDigest(altStaff, TODAY, now)
    await withOwner(async (c) => {
      const row = (await c.query(`select user_id from students s join users u on u.id = s.user_id where u.login = $1`, [STUDENT_A.login])).rows[0]
      const insert = (topic: string, status: string, ageDays: number, n: number) =>
        c.query(
          `insert into questions (student_id, topic, body, status, answer, answered_at, ip, created_at)
           values ($1, $2, $3, $4, $5, $6, 'test', $7)`,
          [row.user_id, topic, `${TAG} ${n}`, status, status === 'answered' ? 'Ответ' : null, status === 'answered' ? new Date(now.getTime() - ageDays * DAY + 3_600_000) : null, new Date(now.getTime() - ageDays * DAY)],
        )
      await insert('stipend', 'sent', 1, 1) // неделя, без ответа
      await insert('stipend', 'sent', 2, 2) // неделя, без ответа
      await insert('stipend', 'answered', 3, 3) // неделя, отвечен
      await insert('stipend', 'sent', 9, 4) // предыдущая неделя
      await insert('stipend', 'sent', 20, 5) // старше двух недель: не считается
    })
    const after = await staffDal.getCohortWeekDigest(staff, TODAY, now)
    const pick = (d: WeekDigest) => d.questions.find((q) => q.topic === 'stipend')!
    expect(pick(after).total - pick(before).total).toBe(3)
    expect(pick(after).unanswered - pick(before).unanswered).toBe(2)
    expect(pick(after).previousWeek - pick(before).previousWeek).toBe(1)
    // Набор — из сессии: числа сотрудника второго набора от вопросов основного набора не меняются.
    expect(await staffDal.getCohortWeekDigest(altStaff, TODAY, now)).toEqual(altBefore)
    // Другие темы не изменились.
    expect(after.questions.filter((q) => q.topic !== 'stipend')).toEqual(before.questions.filter((q) => q.topic !== 'stipend'))
  })

  it('в ответе слоя — только числа и ключи видов и тем: ни ФИО, ни групп, ни текстов', async () => {
    const text = JSON.stringify(await staffDal.getCohortWeekDigest(staff, TODAY))
    for (const forbidden of [STUDENT_A.fullName, STUDENT_A.groupName, TAG, 'Белозёров']) expect(text).not.toContain(forbidden)
  })
})
