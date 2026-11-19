// ИИ-функции (19.11, задание B-ideas-D): разбор фразы моделью и черновик ответа сотруднику.
// Сеть подменена: настоящая модель не вызывается. «Сегодня» — четверг, 19.11.2026.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractJsonObject, parseIntent, validateModelIntent } from '@/lib/intent'
import { DEAN_PURPOSE_KEYS, REQUEST_KINDS } from '@/lib/requests'
import {
  AI_TIMEOUT_MS,
  DRAFT_MAX_LENGTH,
  DRAFT_PROMPT,
  INTENT_PROMPT,
  LIMIT_PER_DAY,
  aiEnabled,
  buildIntentPrompt,
  cleanDraft,
  draftStaffAnswer,
  parseRequestIntent,
  resetAiLimits,
} from '@/server/ai'

const TODAY = '2026-11-19'
const KEY = 'test-key-not-real-0000'
const PHRASE = 'нужна справка в налоговую к пятнице, 2 экземпляра'

function reply(content: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: init.status ?? 200 })
}

const modelJson = (o: Record<string, unknown>) => reply(JSON.stringify(o))

let fetchMock: ReturnType<typeof vi.fn>

function enableAi(extra: Record<string, string> = {}) {
  vi.stubEnv('AI_BASE_URL', 'https://llm.example.test/v1')
  vi.stubEnv('AI_API_KEY', KEY)
  vi.stubEnv('AI_MODEL', 'model-x')
  vi.stubEnv('AI_FOLDER_ID', '')
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v)
}

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
  vi.useRealTimers()
})

describe('aiEnabled: без ключа модель не вызывается', () => {
  it('нет ключа, адреса или модели — выключено', () => {
    expect(aiEnabled()).toBe(false)
    enableAi()
    expect(aiEnabled()).toBe(true)
    vi.stubEnv('AI_API_KEY', '  ')
    expect(aiEnabled()).toBe(false)
    enableAi()
    vi.stubEnv('AI_MODEL', '')
    expect(aiEnabled()).toBe(false)
  })

  it('адрес не https (кроме своего компьютера) — выключено', () => {
    enableAi({ AI_BASE_URL: 'http://llm.example.test/v1' })
    expect(aiEnabled()).toBe(false)
    enableAi({ AI_BASE_URL: 'ftp://x' })
    expect(aiEnabled()).toBe(false)
    enableAi({ AI_BASE_URL: 'http://localhost:8080/v1' })
    expect(aiEnabled()).toBe(true)
  })

  it('parseRequestIntent без ключа: запасной путь, fetch не вызван', async () => {
    const r = await parseRequestIntent(PHRASE, TODAY, 'u1')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.source).toBe('keywords')
    expect(r.intent).toEqual(parseIntent(PHRASE, TODAY))
  })

  it('draftStaffAnswer без ключа: отказ «disabled», fetch не вызван', async () => {
    expect(await draftStaffAnswer('Когда пересдача?', 'u1')).toEqual({ ok: false, reason: 'disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('parseRequestIntent: ответ модели', () => {
  beforeEach(() => enableAi())

  it('валидный JSON → поля из ответа, источник «ai»; в запросе только фраза и промпт', async () => {
    fetchMock.mockResolvedValue(modelJson({ kind: 'dean_certificate', purpose: 'tax_office', dueDate: '2026-11-20', copies: 2 }))
    const r = await parseRequestIntent(PHRASE, TODAY, 'u1')
    expect(r.source).toBe('ai')
    expect(r.intent).toEqual({ kind: 'dean_certificate', purpose: 'tax_office', paymentYear: null, dueDate: '2026-11-20', copies: 2, recognized: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://llm.example.test/v1/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${KEY}`)
    expect(headers['openai-project']).toBeUndefined()
    const body = JSON.parse(String(init.body)) as { model: string; messages: { role: string; content: string }[] }
    expect(body.model).toBe('model-x')
    expect(body.messages).toEqual([
      { role: 'system', content: buildIntentPrompt(TODAY) },
      { role: 'user', content: PHRASE },
    ])
  })

  it('AI_FOLDER_ID уходит заголовком OpenAI-Project; адрес уже с /chat/completions не дублируется', async () => {
    enableAi({ AI_FOLDER_ID: 'folder-1', AI_BASE_URL: 'https://llm.example.test/v1/chat/completions/' })
    fetchMock.mockResolvedValue(modelJson({ kind: 'financial_aid', purpose: null, dueDate: null, copies: null }))
    await parseRequestIntent('нужна материальная помощь', TODAY, 'u1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://llm.example.test/v1/chat/completions')
    expect((init.headers as Record<string, string>)['openai-project']).toBe('folder-1')
  })

  it('JSON в ограде ```json и с текстом вокруг принимается', async () => {
    fetchMock.mockResolvedValue(reply('Вот результат:\n```json\n{"kind":"financial_aid","purpose":null,"dueDate":null,"copies":null}\n```'))
    const r = await parseRequestIntent('нужна материальная помощь', TODAY, 'u1')
    expect(r.source).toBe('ai')
    expect(r.intent.kind).toBe('financial_aid')
  })

  it('год оплаты берётся из разбора по ключевым словам, назначение у справки об оплате отбрасывается', async () => {
    fetchMock.mockResolvedValue(modelJson({ kind: 'tuition_certificate', purpose: 'tax_office', dueDate: null, copies: null }))
    const r = await parseRequestIntent('справка об оплате для вычета за 2025 год', TODAY, 'u1')
    expect(r.source).toBe('ai')
    expect(r.intent).toMatchObject({ kind: 'tuition_certificate', purpose: null, paymentYear: 2025 })
  })

  it('фраза длиннее 300 знаков обрезается до отправки', async () => {
    fetchMock.mockResolvedValue(modelJson({ kind: 'dean_certificate', purpose: null, dueDate: null, copies: null }))
    await parseRequestIntent(`справка ${'а'.repeat(500)}`, TODAY, 'u1')
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as { messages: { content: string }[] }
    expect(body.messages[1]?.content.length).toBe(300)
  })

  const fallbackCases: [string, () => void][] = [
    ['мусор вместо JSON', () => fetchMock.mockResolvedValue(reply('не знаю, что вы имели в виду'))],
    ['JSON-массив', () => fetchMock.mockResolvedValue(reply('[1,2]'))],
    ['пустой ответ', () => fetchMock.mockResolvedValue(reply(''))],
    ['нет choices', () => fetchMock.mockResolvedValue(new Response('{}'))],
    ['тело не JSON', () => fetchMock.mockResolvedValue(new Response('<html>'))],
    ['недопустимый kind', () => fetchMock.mockResolvedValue(modelJson({ kind: 'passport', purpose: null, dueDate: null, copies: null }))],
    ['kind = null', () => fetchMock.mockResolvedValue(modelJson({ kind: null, purpose: null, dueDate: null, copies: null }))],
    ['недопустимое назначение', () => fetchMock.mockResolvedValue(modelJson({ kind: 'dean_certificate', purpose: 'visa_center', dueDate: null, copies: null }))],
    ['дата в прошлом', () => fetchMock.mockResolvedValue(modelJson({ kind: 'dean_certificate', purpose: null, dueDate: '2026-11-01', copies: null }))],
    ['дата не ISO', () => fetchMock.mockResolvedValue(modelJson({ kind: 'dean_certificate', purpose: null, dueDate: '20.11.2026', copies: null }))],
    ['несуществующая дата', () => fetchMock.mockResolvedValue(modelJson({ kind: 'dean_certificate', purpose: null, dueDate: '2026-02-30', copies: null }))],
    ['экземпляров 0', () => fetchMock.mockResolvedValue(modelJson({ kind: 'dean_certificate', purpose: null, dueDate: null, copies: 0 }))],
    ['экземпляров 50', () => fetchMock.mockResolvedValue(modelJson({ kind: 'dean_certificate', purpose: null, dueDate: null, copies: 50 }))],
    ['экземпляров строкой', () => fetchMock.mockResolvedValue(modelJson({ kind: 'dean_certificate', purpose: null, dueDate: null, copies: '2' }))],
    ['HTTP 500', () => fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))],
    ['HTTP 401', () => fetchMock.mockResolvedValue(new Response('no', { status: 401 }))],
    ['сеть оборвалась', () => fetchMock.mockRejectedValue(new TypeError('fetch failed'))],
  ]
  it.each(fallbackCases)('%s → разбор по ключевым словам', async (_name, arrange) => {
    arrange()
    const r = await parseRequestIntent(PHRASE, TODAY, 'u1')
    expect(r.source).toBe('keywords')
    expect(r.intent).toEqual(parseIntent(PHRASE, TODAY))
  })

  it(`таймаут ${AI_TIMEOUT_MS} мс: запрос обрывается, одна попытка, запасной путь`, async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const pending = parseRequestIntent(PHRASE, TODAY, 'u1')
    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS + 1)
    const r = await pending
    expect(r.source).toBe('keywords')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('пустая фраза: модель не вызывается', async () => {
    const r = await parseRequestIntent('   ', TODAY, 'u1')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.source).toBe('keywords')
    expect(r.intent.recognized).toBe(false)
  })

  it('предел: одиннадцатый вызов одного пользователя за минуту идёт по запасному пути без запроса', async () => {
    fetchMock.mockImplementation(async () => modelJson({ kind: 'dean_certificate', purpose: null, dueDate: null, copies: null }))
    for (let i = 0; i < 10; i += 1) expect((await parseRequestIntent(PHRASE, TODAY, 'u1')).source).toBe('ai')
    expect((await parseRequestIntent(PHRASE, TODAY, 'u1')).source).toBe('keywords')
    expect(fetchMock).toHaveBeenCalledTimes(10)
    // Другой пользователь свой предел не исчерпал.
    expect((await parseRequestIntent(PHRASE, TODAY, 'u2')).source).toBe('ai')
  })
})

describe('validateModelIntent и extractJsonObject', () => {
  const kw = parseIntent('нужна справка', TODAY)

  it('все виды и назначения из списков принимаются, посторонние — нет', () => {
    for (const kind of REQUEST_KINDS) expect(validateModelIntent({ kind, purpose: null, dueDate: null, copies: null }, TODAY, kw)?.kind).toBe(kind)
    for (const purpose of DEAN_PURPOSE_KEYS) {
      expect(validateModelIntent({ kind: 'dean_certificate', purpose, dueDate: null, copies: null }, TODAY, kw)?.purpose).toBe(purpose)
    }
    expect(validateModelIntent({ kind: 'dean_certificate', purpose: 'x', dueDate: null, copies: null }, TODAY, kw)).toBeNull()
    expect(validateModelIntent(null, TODAY, kw)).toBeNull()
    expect(validateModelIntent('dean_certificate', TODAY, kw)).toBeNull()
  })

  it('поля можно опустить; срок — от сегодня до года вперёд', () => {
    expect(validateModelIntent({ kind: 'dean_certificate' }, TODAY, kw)).toMatchObject({ dueDate: null, copies: null, recognized: true })
    expect(validateModelIntent({ kind: 'dean_certificate', dueDate: TODAY }, TODAY, kw)?.dueDate).toBe(TODAY)
    expect(validateModelIntent({ kind: 'dean_certificate', dueDate: '2028-01-01' }, TODAY, kw)).toBeNull()
  })

  it('extractJsonObject: объект из текста, остальное — null', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(extractJsonObject('текст {"a":1} текст')).toEqual({ a: 1 })
    expect(extractJsonObject('{"a":')).toBeNull()
    expect(extractJsonObject('[{"a":1}]')).toBeNull()
    expect(extractJsonObject(42)).toBeNull()
  })
})

describe('draftStaffAnswer: черновик ответа сотруднику', () => {
  beforeEach(() => enableAi())

  it('черновик обрезается до 600 знаков; в запросе только текст вопроса', async () => {
    const long = `${'Слово '.repeat(200)}конец`
    fetchMock.mockResolvedValue(reply(long))
    const r = await draftStaffAnswer('Когда пересдача по физике?', 'u1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Array.from(r.text).length).toBeLessThanOrEqual(DRAFT_MAX_LENGTH)
      expect(r.text.length).toBeGreaterThan(500)
      expect(r.text.endsWith('Слово')).toBe(true)
    }
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as { messages: { role: string; content: string }[] }
    expect(body.messages).toEqual([
      { role: 'system', content: DRAFT_PROMPT },
      { role: 'user', content: 'Когда пересдача по физике?' },
    ])
  })

  it('короткий ответ не меняется; управляющие знаки убираются', async () => {
    fetchMock.mockResolvedValue(reply('Здравствуйте!\u0000 Уточним у преподавателя [уточнить пункт положения].\n\n\n\nДеканат'))
    const r = await draftStaffAnswer('Вопрос', 'u1')
    expect(r).toEqual({ ok: true, text: 'Здравствуйте! Уточним у преподавателя [уточнить пункт положения].\n\nДеканат' })
  })

  it('ошибки модели → отказ с причиной, без текста', async () => {
    fetchMock.mockResolvedValue(new Response('x', { status: 503 }))
    expect(await draftStaffAnswer('Вопрос', 'u1')).toEqual({ ok: false, reason: 'http' })
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    expect(await draftStaffAnswer('Вопрос', 'u1')).toEqual({ ok: false, reason: 'network' })
    fetchMock.mockResolvedValue(reply('   '))
    expect(await draftStaffAnswer('Вопрос', 'u1')).toEqual({ ok: false, reason: 'bad_response' })
  })

  it('пустой вопрос: запроса нет', async () => {
    expect(await draftStaffAnswer('  ', 'u1')).toEqual({ ok: false, reason: 'bad_response' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cleanDraft: ровно 600 знаков не трогает, 601 обрезает', () => {
    expect(cleanDraft('а'.repeat(600))).toHaveLength(600)
    expect(cleanDraft('а'.repeat(601))).toHaveLength(600)
  })
})

describe('предел вызовов', () => {
  beforeEach(() => enableAi())

  it('суточный потолок: 500 вызовов за сутки на всех, 501-й — отказ без запроса; через 24 часа снова можно', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-19T00:00:00Z'), toFake: ['Date'] })
    fetchMock.mockImplementation(async () => reply('Ответ'))
    // 60 в минуту на всех и 10 на пользователя: набираем потолок по 10 вызовов от 50 пользователей раз в минуту.
    let made = 0
    for (let minute = 0; made < LIMIT_PER_DAY; minute += 1) {
      vi.setSystemTime(new Date('2026-11-19T00:00:00Z').getTime() + minute * 61_000)
      for (let user = 0; user < 6 && made < LIMIT_PER_DAY; user += 1) {
        for (let n = 0; n < 10 && made < LIMIT_PER_DAY; n += 1) {
          expect((await draftStaffAnswer('Вопрос', `u${user}`)).ok, `вызов ${made + 1}`).toBe(true)
          made += 1
        }
      }
    }
    expect(fetchMock).toHaveBeenCalledTimes(LIMIT_PER_DAY)
    vi.setSystemTime(new Date('2026-11-19T00:00:00Z').getTime() + 12 * 3_600_000)
    expect(await draftStaffAnswer('Вопрос', 'u-new')).toEqual({ ok: false, reason: 'rate_limited' })
    expect(fetchMock).toHaveBeenCalledTimes(LIMIT_PER_DAY)
    vi.setSystemTime(new Date('2026-11-21T00:00:00Z'))
    expect((await draftStaffAnswer('Вопрос', 'u-new')).ok).toBe(true)
  })
})

describe('промпты в prompts/ совпадают с кодом', () => {
  const read = (name: string) => readFileSync(fileURLToPath(new URL(`../../../prompts/${name}`, import.meta.url)), 'utf8')

  it('P-AI-01: шаблон и пример после подстановки дословно как в коде', () => {
    const md = read('P-AI-01-intent.md')
    expect(md).toContain(INTENT_PROMPT)
    expect(md).toContain(buildIntentPrompt('2026-11-19'))
    for (const kind of REQUEST_KINDS) expect(buildIntentPrompt(TODAY)).toContain(kind)
    for (const key of DEAN_PURPOSE_KEYS) expect(buildIntentPrompt(TODAY)).toContain(key)
  })

  it('P-AI-02: промпт дословно как в коде; в нём есть заглушка для пункта положения и предел 600', () => {
    expect(read('P-AI-02-staff-draft.md')).toContain(DRAFT_PROMPT)
    expect(DRAFT_PROMPT).toContain('[уточнить пункт положения]')
    expect(DRAFT_PROMPT).toContain(String(DRAFT_MAX_LENGTH))
  })
})
