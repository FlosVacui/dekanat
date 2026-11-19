// Блок «Ждёт вас» на «Сегодня» (дизайн-проход 19.11): сборка строк по важности. Выдуманные данные, «сегодня» — аргумент, база не нужна.
import { describe, expect, it } from 'vitest'
import { STIPEND_DEBT_LINE } from '../../src/lib/grades'
import {
  buildWaiting,
  dateHeading,
  WAITING_EMPTY_TEXT,
  type WaitingGradeInput,
  type WaitingQuestionInput,
  type WaitingRequestInput,
} from '../../src/lib/today'

const TODAY = '2026-11-19' // четверг

function grade(name: string, patch: Partial<WaitingGradeInput> = {}): WaitingGradeInput {
  return {
    disciplineId: `id-${name}`,
    name,
    controlKind: 'exam',
    outcome: 'pending',
    points: 41,
    admitted: true,
    examDate: null,
    nextDue: null,
    ...patch,
  }
}

function request(id: string, patch: Partial<WaitingRequestInput> = {}): WaitingRequestInput {
  return { id, kind: 'dean_certificate', status: 'ready', dueDate: null, pickupUntil: '2026-11-25', issuedOn: null, rejectReason: null, ...patch }
}

const NO_REQUESTS: WaitingRequestInput[] = []
const NO_QUESTIONS: WaitingQuestionInput[] = []

describe('«Ждёт вас»: пустой случай', () => {
  it('нет долгов, недопусков, готовых заявок и ответов — строк нет', () => {
    const grades = [grade('Сданное', { outcome: '5', points: 90 }), grade('Впереди с допуском')]
    const requests = [request('r1', { status: 'submitted' }), request('r2', { status: 'issued', issuedOn: '2026-11-10' })]
    const questions: WaitingQuestionInput[] = [{ id: 'q1', topic: 'other', status: 'sent' }]
    expect(buildWaiting({ grades, requests, questions, today: TODAY })).toEqual([])
  })

  it('текст пустого блока — утверждённая фраза', () => {
    expect(WAITING_EMPTY_TEXT).toBe('Всё в порядке: долгов и ответов от вас не ждут')
  })
})

describe('«Ждёт вас»: долг', () => {
  it('красная метка, дата пересдачи, ссылка на страницу предмета; стипендия — только у первого долга', () => {
    const grades = [
      grade('Эконометрика', { outcome: '2', examDate: '2026-11-25' }),
      grade('Статистика', { outcome: 'no_credit', controlKind: 'credit', examDate: '2026-11-21' }),
    ]
    const rows = buildWaiting({ grades, requests: NO_REQUESTS, questions: NO_QUESTIONS, today: TODAY })
    expect(rows.map((r) => r.title)).toEqual(['Статистика', 'Эконометрика'])
    expect(rows[0]).toMatchObject({
      kind: 'debt',
      tone: 'err',
      label: 'Долг',
      detail: 'Пересдача 21 ноября',
      note: STIPEND_DEBT_LINE,
      href: '/grades/id-Статистика',
      action: 'Подготовиться к пересдаче',
    })
    expect(rows[1]?.note).toBeNull()
    expect(rows[1]?.detail).toBe('Пересдача 25 ноября')
  })

  it('даты пересдачи нет или она прошла — это сказано словами', () => {
    const none = buildWaiting({ grades: [grade('Без даты', { outcome: '2' })], requests: NO_REQUESTS, questions: NO_QUESTIONS, today: TODAY })
    expect(none[0]?.detail).toBe('Дата пересдачи не назначена')
    const past = buildWaiting({
      grades: [grade('Прошла', { outcome: '2', examDate: '2026-11-10' })],
      requests: NO_REQUESTS,
      questions: NO_QUESTIONS,
      today: TODAY,
    })
    expect(past[0]?.detail).toBe('Пересдача была 10 ноября, новая дата не назначена')
  })
})

describe('«Ждёт вас»: нет допуска', () => {
  it('жёлтая метка, сколько баллов не хватает, ближайшая работа, ссылка на «Успеваемость»', () => {
    const grades = [grade('Корпоративные финансы', { points: 22, admitted: false, nextDue: { title: 'Контрольная 3', dueDate: '2026-11-23' } })]
    const [row] = buildWaiting({ grades, requests: NO_REQUESTS, questions: NO_QUESTIONS, today: TODAY })
    expect(row).toMatchObject({
      kind: 'no_admission',
      tone: 'warn',
      label: 'Нет допуска',
      title: 'Корпоративные финансы',
      detail: 'До допуска не хватает 8 баллов',
      note: 'Ближайшая работа: Контрольная 3, до 23 ноября',
      href: '/grades',
      action: 'Открыть работы',
    })
  })

  it('баллов хватает, а признак допуска «нет» — числа нет, строка остаётся', () => {
    const [row] = buildWaiting({
      grades: [grade('Признак', { points: 45, admitted: false })],
      requests: NO_REQUESTS,
      questions: NO_QUESTIONS,
      today: TODAY,
    })
    expect(row?.detail).toBe('Допуска пока нет')
    expect(row?.note).toBeNull()
  })
})

describe('«Ждёт вас»: справка и ответ', () => {
  it('готовая справка — зелёная метка и «Забрать справку»; поданная и выданная не попадают', () => {
    const requests = [request('ok1'), request('wait', { status: 'in_progress', dueDate: '2026-11-21' }), request('done', { status: 'issued' })]
    const rows = buildWaiting({ grades: [], requests, questions: NO_QUESTIONS, today: TODAY })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'ready', tone: 'ok', label: 'Готово', title: 'Справка из деканата', href: '/requests/ok1', action: 'Забрать справку' })
    expect(rows[0]?.detail).toContain('до 25.11.2026')
  })

  it('у материальной помощи глагол другой: справки забирать нечего', () => {
    const rows = buildWaiting({ grades: [], requests: [request('fa', { kind: 'financial_aid' })], questions: NO_QUESTIONS, today: TODAY })
    expect(rows[0]?.action).toBe('Открыть заявку')
  })

  it('ответ деканата — один, самый новый (список приходит новыми сверху); ссылка на вопрос', () => {
    const questions: WaitingQuestionInput[] = [
      { id: 'q-new', topic: 'resits', status: 'answered' },
      { id: 'q-sent', topic: 'other', status: 'sent' },
      { id: 'q-old', topic: 'documents', status: 'answered' },
    ]
    const rows = buildWaiting({ grades: [], requests: NO_REQUESTS, questions, today: TODAY })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'answer', tone: 'ok', label: 'Ответ', detail: 'Пересдачи и долги', href: '/questions/q-new', action: 'Прочитать ответ' })
  })
})

describe('«Ждёт вас»: давность ответа деканата', () => {
  const answered = (id: string, answeredOn: string | null): WaitingQuestionInput => ({ id, topic: 'documents', status: 'answered', answeredOn })

  it('ответ от сегодняшнего до семи дней назад стоит в блоке; старше семи дней — нет, строки нет совсем', () => {
    for (const on of [TODAY, '2026-11-18', '2026-11-12']) {
      const rows = buildWaiting({ grades: [], requests: NO_REQUESTS, questions: [answered('q', on)], today: TODAY })
      expect(rows.map((r) => r.kind), on).toEqual(['answer'])
    }
    const old = buildWaiting({ grades: [], requests: NO_REQUESTS, questions: [answered('q', '2026-11-11')], today: TODAY })
    expect(old, 'ответ восьмидневной давности').toEqual([])
  })

  it('старый ответ не заслоняет более новый, а день ответа не известен — ответ показывается', () => {
    const rows = buildWaiting({ grades: [], requests: NO_REQUESTS, questions: [answered('q-new', '2026-11-18'), answered('q-old', '2026-10-01')], today: TODAY })
    expect(rows[0]).toMatchObject({ href: '/questions/q-new' })
    const unknown = buildWaiting({ grades: [], requests: NO_REQUESTS, questions: [answered('q-x', null)], today: TODAY })
    expect(unknown).toHaveLength(1)
  })
})

describe('«Ждёт вас»: порядок по важности', () => {
  it('долг, затем нет допуска, затем справка, затем ответ', () => {
    const rows = buildWaiting({
      grades: [grade('Недопуск', { points: 10, admitted: false }), grade('Долг', { outcome: '2' })],
      requests: [request('r1')],
      questions: [{ id: 'q1', topic: 'other', status: 'answered' }],
      today: TODAY,
    })
    expect(rows.map((r) => r.kind)).toEqual(['debt', 'no_admission', 'ready', 'answer'])
    expect(rows.map((r) => r.tone)).toEqual(['err', 'warn', 'ok', 'ok'])
  })
})

describe('заголовок экрана — дата', () => {
  it('«Четверг, 19 ноября»', () => {
    expect(dateHeading(TODAY)).toBe('Четверг, 19 ноября')
  })
})
