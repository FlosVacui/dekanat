// Стипендия студента (20.11, раздел «Стипендия»). Чистые функции: без базы и без часов, «сегодня» приходит аргументом.
// Правило — раздел 3 вымышленного положения (`regulations/data.ts`): п. 3.1 — на бюджетных местах, п. 3.2 — академическая стипендия
// за сессию без троек и без долгов, п. 3.3 — повышенная, п. 3.7 — выплата до 25 числа.
// Суммы и даты ниже — вымышленные, как весь прототип (ТР-5). Настоящих платежей и реквизитов здесь нет.

import { addWorkingDays, formatDayMonth, weekdayShort } from './dates'
import { describeDiscipline, type FirstActionInput } from './grades'

// ---------- Вымышленный приказ о размерах ----------

/** «Приказ о размерах стипендий»: в положении размеров нет (п. 3.1), они — в приказе. Суммы придуманы для прототипа. */
export const SCHOLARSHIP_ORDER = {
  title: 'Приказ о размерах стипендий',
  number: '№ 214-С',
  /** Дата приказа, ГГГГ-ММ-ДД. */
  date: '2026-08-28',
  /** Государственная академическая стипендия, ₽ в месяц. */
  academic: 4500,
  /** Повышенная академическая стипендия, ₽ в месяц. */
  raised: 12000,
  /** Социальная стипендия, ₽ в месяц. */
  social: 6800,
} as const

/** Пометка на экране рядом с суммами. */
export const SAMPLE_NOTE = 'Суммы — пример для прототипа'

/** День месяца, до которого выплачивают (п. 3.7). */
export const PAYMENT_DAY = 25
/** Последний день прошлой (летней) сессии: от него считается начало выплаты по п. 3.2 — «с первого числа месяца после окончания сессии». */
export const PREVIOUS_SESSION_END = '2026-08-31'
/** Конец семестра: выплата идёт по этот день включительно (последний месяц — январь). */
export const TERM_END = '2027-01-31'
/** Сколько рабочих дней идёт приём заявлений на повышенную стипендию и сколько — решение комиссии (п. 3.3). */
export const RAISED_WORKING_DAYS = 10

const NBSP = ' '

/** «4 500 ₽»: пробел между разрядами и перед знаком — неразрывные, число не рвётся на строки. */
export function formatRub(amount: number): string {
  const digits = String(Math.round(Math.abs(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  return `${amount < 0 ? '−' : ''}${digits}${NBSP}₽`
}

// ---------- Даты ----------

const MONTHS_NOMINATIVE = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

/** Первое число месяца, следующего за днём `iso`: «2026-08-31» → «2026-09-01». */
export function firstOfNextMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number) as [number, number]
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** Следующий месяц «ГГГГ-ММ». */
function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/** «2026-09» → «Сентябрь 2026». */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return `${MONTHS_NOMINATIVE[m - 1] ?? ''} ${y}`
}

/** «2026-11-25» → «25 ноября, ср». */
export function dayWithWeekday(iso: string): string {
  return `${formatDayMonth(iso)}, ${weekdayShort(iso)}`
}

// ---------- Статус ----------

/** Основа обучения. В данных кабинета её пока нет, поэтому страница не передаёт её и считает место бюджетным; ветка «платная» проверена тестами. */
export type TuitionBasis = 'budget' | 'paid'

/** Дисциплина для расчёта: поля `GradeItem` слоя доступа. */
export interface ScholarshipGrade extends FirstActionInput {
  semester: number
}

export type BlockerKind = 'paid_basis' | 'debt' | 'three' | 'no_results'

export interface BlockerItem {
  disciplineId: string
  name: string
  /** Дата пересдачи или контроля; нет — `null`. */
  examDate: string | null
}

export interface ScholarshipBlocker {
  kind: BlockerKind
  /** Дисциплины: долги или тройки; у остальных причин пусто. */
  items: BlockerItem[]
}

export interface ScholarshipStatus {
  kind: 'academic' | 'none'
  /** Текущий семестр: самый поздний у группы; нет дисциплин — `null`. */
  currentSemester: number | null
  /** Семестр, по итогам сессии которого считано: самый поздний до текущего с хотя бы одним итогом; нет — `null`. */
  sessionSemester: number | null
  /** Причины отказа по важности: платная основа, долг, тройка, нет итогов. У назначенной стипендии пусто. */
  blockers: ScholarshipBlocker[]
  /** Назначена, и все экзамены прошлой сессии сданы на «5»: условие по оценкам для повышенной (п. 3.3) выполнено. Решение остаётся за комиссией. */
  excellent: boolean
}

function byDateThenName(a: BlockerItem, b: BlockerItem): number {
  if (a.examDate !== b.examDate) {
    if (a.examDate === null) return 1
    if (b.examDate === null) return -1
    return a.examDate < b.examDate ? -1 : 1
  }
  return a.name.localeCompare(b.name, 'ru')
}

function toItem(g: ScholarshipGrade): BlockerItem {
  return { disciplineId: g.disciplineId, name: g.name, examDate: g.examDate }
}

/** Номер текущего семестра по списку дисциплин группы. */
export function currentSemesterOf(grades: readonly { semester: number }[]): number | null {
  return grades.length === 0 ? null : Math.max(...grades.map((g) => g.semester))
}

/** Семестр прошлой сессии: самый поздний до текущего, где есть хотя бы один итог (не «впереди»). */
export function sessionSemesterOf(grades: readonly { semester: number; outcome: string }[], current: number | null): number | null {
  if (current === null) return null
  const done = grades.filter((g) => g.semester < current && g.outcome !== 'pending').map((g) => g.semester)
  return done.length === 0 ? null : Math.max(...done)
}

/**
 * Назначена ли академическая стипендия на текущий семестр (п. 3.1 и 3.2):
 * - платная основа — нет;
 * - долг по любой дисциплине — нет (тот же счёт долга, что на «Успеваемости» и в «Ждёт вас»);
 * - тройка в итогах прошлой сессии — нет;
 * - итогов прошлой сессии нет — нет: назначать не по чему;
 * - иначе — назначена.
 * Повышенную эта функция не назначает: её назначает комиссия по заявлению (п. 3.3), честно вычислить её нельзя.
 */
export function evaluateScholarship(input: { grades: readonly ScholarshipGrade[]; basis?: TuitionBasis }): ScholarshipStatus {
  const { grades } = input
  const currentSemester = currentSemesterOf(grades)
  const sessionSemester = sessionSemesterOf(grades, currentSemester)
  const base = { currentSemester, sessionSemester }

  if (input.basis === 'paid') {
    return { kind: 'none', ...base, blockers: [{ kind: 'paid_basis', items: [] }], excellent: false }
  }

  const blockers: ScholarshipBlocker[] = []
  const debts = grades.filter((g) => describeDiscipline(g).kind === 'debt').map(toItem).sort(byDateThenName)
  if (debts.length > 0) blockers.push({ kind: 'debt', items: debts })

  const session = grades.filter((g) => g.semester === sessionSemester)
  const threes = session.filter((g) => g.outcome === '3').map(toItem).sort(byDateThenName)
  if (threes.length > 0) blockers.push({ kind: 'three', items: threes })

  if (sessionSemester === null) blockers.push({ kind: 'no_results', items: [] })

  const exams = session.filter((g) => g.controlKind === 'exam')
  const excellent = blockers.length === 0 && exams.length > 0 && exams.every((g) => g.outcome === '5')
  return { kind: blockers.length === 0 ? 'academic' : 'none', ...base, blockers, excellent }
}

const REASON_SHORT: Record<BlockerKind, string> = {
  paid_basis: 'платная основа обучения',
  debt: 'есть долг',
  three: 'в прошлой сессии есть тройка',
  no_results: 'нет итогов прошлой сессии',
}

function quoted(items: readonly BlockerItem[]): string {
  return items.map((i) => `«${i.name}»`).join(', ')
}

export interface StatusView {
  /** «Назначена академическая» или «Не назначена: есть долг». */
  title: string
  /** Пояснение под заголовком. */
  text: string
  /** Номер пункта положения, на который ссылается статус: `3.1` или `3.2`. */
  point: '3.1' | '3.2'
  tone: 'ok' | 'err'
}

/** Заголовок, пояснение и пункт положения для статуса. */
export function describeStatus(status: ScholarshipStatus): StatusView {
  if (status.kind === 'academic') {
    return {
      title: 'Назначена академическая',
      text: `По итогам сессии ${status.sessionSemester} семестра: без троек и без долгов.`,
      point: '3.2',
      tone: 'ok',
    }
  }
  const first = status.blockers[0]
  const kind = first?.kind ?? 'no_results'
  const title = `Не назначена: ${REASON_SHORT[kind]}`
  switch (kind) {
    case 'paid_basis':
      return { title, text: 'Стипендии назначают студентам очной формы на бюджетных местах.', point: '3.1', tone: 'err' }
    case 'debt':
      return {
        title,
        text: `Долг по дисциплинам: ${quoted(first?.items ?? [])}. Академическую стипендию назначают за сессию без троек и без долгов.`,
        point: '3.2',
        tone: 'err',
      }
    case 'three':
      return {
        title,
        text: `Тройки в итогах ${status.sessionSemester} семестра: ${quoted(first?.items ?? [])}. Академическую стипендию назначают за сессию без троек и без долгов.`,
        point: '3.2',
        tone: 'err',
      }
    default:
      return { title, text: 'Стипендию назначают по итогам прошлой сессии, а их в кабинете пока нет.', point: '3.2', tone: 'err' }
  }
}

// ---------- «Что сделать» ----------

export interface TodoLine {
  text: string
  /** Куда ведёт строка; `null` — просто текст. */
  href: string | null
}

function retakePhrase(examDate: string | null, today: string): string {
  if (!examDate) return 'дата пересдачи не назначена'
  if (examDate < today) return `пересдача была ${formatDayMonth(examDate)}, новую дату назначит кафедра`
  return `пересдача ${formatDayMonth(examDate)}`
}

/** День, когда кончается ближайшая сессия: самая поздняя дата контроля среди дисциплин текущего семестра. Дат нет — `null`. */
export function nextSessionEnd(grades: readonly { semester: number; examDate: string | null }[], current: number | null): string | null {
  if (current === null) return null
  const dates = grades.filter((g) => g.semester === current && g.examDate !== null).map((g) => g.examDate as string)
  return dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b))
}

/**
 * Строки «что сделать, чтобы получать»: закрыть долги (со ссылкой на дисциплину), затем сдать ближайшую сессию без троек и долгов.
 * У назначенной стипендии и у платной основы строк нет: делать нечего.
 */
export function buildTodo(status: ScholarshipStatus, ctx: { today: string; sessionEnd: string | null }): TodoLine[] {
  if (status.kind === 'academic') return []
  const lines: TodoLine[] = []
  for (const blocker of status.blockers) {
    if (blocker.kind === 'paid_basis') return []
    if (blocker.kind === 'debt') {
      for (const item of blocker.items) {
        lines.push({ text: `Закрыть долг по «${item.name}»: ${retakePhrase(item.examDate, ctx.today)}`, href: `/grades/${item.disciplineId}` })
      }
    }
  }
  const end = ctx.sessionEnd && ctx.sessionEnd >= ctx.today ? ` — она кончается ${formatDayMonth(ctx.sessionEnd)}` : ''
  lines.push({ text: `Сдать ближайшую сессию без троек и без долгов${end}`, href: null })
  return lines
}

// ---------- Выплаты ----------

export interface Payout {
  /** Месяц «ГГГГ-ММ». */
  month: string
  /** «Сентябрь 2026». */
  label: string
  /** День выплаты, ГГГГ-ММ-ДД. */
  date: string
  amount: number
  /** `paid` — день выплаты уже прошёл; `planned` — ещё впереди (текущий месяц до 25 числа). */
  state: 'paid' | 'planned'
}

export interface PayoutPlan {
  /** История с начала выплаты до текущего месяца включительно, новые сверху. */
  history: Payout[]
  /** Ближайшая выплата: сегодня или позже; кончился срок — `null`. */
  next: { date: string; amount: number } | null
  /** Сумма уже выплаченного за семестр. */
  paidTotal: number
}

/**
 * Выплаты по месяцам: от месяца начала до месяца конца семестра, в день `PAYMENT_DAY`. История — месяцы до текущего включительно
 * (без новых таблиц: всё считается из дат и суммы). Начало выплаты в будущем — истории нет, ближайшая выплата — первая.
 */
export function buildPayouts(input: { payFrom: string; termEnd: string; today: string; amount: number }): PayoutPlan {
  const { payFrom, termEnd, today, amount } = input
  const lastMonth = termEnd.slice(0, 7)
  const thisMonth = today.slice(0, 7)
  const all: Payout[] = []
  for (let ym = payFrom.slice(0, 7); ym <= lastMonth; ym = nextMonth(ym)) {
    const date = `${ym}-${String(PAYMENT_DAY).padStart(2, '0')}`
    all.push({ month: ym, label: monthLabel(ym), date, amount, state: date < today ? 'paid' : 'planned' })
  }
  const history = all.filter((p) => p.month <= thisMonth).reverse()
  const upcoming = all.find((p) => p.date >= today)
  return {
    history,
    next: upcoming ? { date: upcoming.date, amount } : null,
    paidTotal: history.filter((p) => p.state === 'paid').reduce((sum, p) => sum + p.amount, 0),
  }
}

// ---------- Повышенная стипендия ----------

export interface RaisedWindow {
  /** Последний экзамен семестра, ГГГГ-ММ-ДД. */
  lastExam: string
  /** Последний день приёма заявления: 10 рабочих дней после последнего экзамена (п. 3.3). */
  deadline: string
  /** Не позднее этого дня комиссия объявляет решение: ещё 10 рабочих дней после конца приёма (п. 3.3). */
  decisionBy: string
}

/** Срок подачи по п. 3.3. Дат экзаменов нет или срок уже вышел — `null`: на экране остаётся общее правило без числа. */
export function raisedWindow(sessionEnd: string | null, today: string): RaisedWindow | null {
  if (!sessionEnd) return null
  const deadline = addWorkingDays(sessionEnd, RAISED_WORKING_DAYS)
  if (deadline < today) return null
  return { lastExam: sessionEnd, deadline, decisionBy: addWorkingDays(deadline, RAISED_WORKING_DAYS) }
}

/** Текст вопроса в деканат о заявлении на повышенную стипендию: ложится в форму «Вопрос в деканат» (`?text=`). Не длиннее 1000 знаков. */
export const RAISED_QUESTION_TEXT =
  'Здравствуйте! Хочу подать заявление на повышенную академическую стипендию (п. 3.3 положения). ' +
  'Подскажите, какие документы и портфолио нужны и до какого числа деканат принимает заявления.'

/** Адрес формы «Вопрос в деканат» с подставленным текстом заявления. Отдельного вида заявки на повышенную стипендию в кабинете нет. */
export function raisedQuestionHref(): string {
  return `/questions/new?text=${encodeURIComponent(RAISED_QUESTION_TEXT)}`
}
