// Виды заявок, статусы, допустимые переходы и тексты статусов: S-2.1, раздел 5. Чистая логика, без базы.
// Все номера кабинетов и сроки вымышленные (ТР-5). Сроки и кабинет в текстах подставляет сервер.
import { addDays, addWorkingDays, formatDate, nowTimeIn, todayIn } from './dates'

export const REQUEST_KINDS = ['dean_certificate', 'tuition_certificate', 'financial_aid'] as const
export type RequestKind = (typeof REQUEST_KINDS)[number]

export const REQUEST_STATUSES = ['submitted', 'in_progress', 'ready', 'issued', 'rejected'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export interface RequestKindInfo {
  title: string
  /** Срок изготовления, как он написан на экране «Новая заявка». */
  productionTime: string
  /** Где и как получить. */
  pickup: string
  /** Кабинет для текста «Готова». */
  room: string
  /** Сколько дней на изготовление; считается от дня, когда сотрудник взял заявку в работу. */
  productionDays: number
  /** Рабочие дни (true) или календарные (false). */
  workingDays: boolean
}

export const REQUEST_KIND_INFO: Record<RequestKind, RequestKindInfo> = {
  dean_certificate: {
    title: 'Справка из деканата',
    productionTime: '1–2 рабочих дня',
    pickup: 'Забрать в деканате лично, кабинет 120а, 1 корпус',
    room: '120а, 1 корпус',
    productionDays: 2,
    workingDays: true,
  },
  tuition_certificate: {
    title: 'Справка об оплате обучения',
    productionTime: '10 рабочих дней',
    pickup: 'Забрать в деканате лично, кабинет 118, 1 корпус',
    room: '118, 1 корпус',
    productionDays: 10,
    workingDays: true,
  },
  financial_aid: {
    title: 'Заявление на материальную помощь',
    productionTime: 'Рассмотрение комиссией: окна 1–15 октября, декабря, марта и мая',
    pickup: 'Оригиналы документов — в деканат, кабинет 124, 1 корпус, в течение десяти дней',
    room: '124, 1 корпус',
    productionDays: 10,
    workingDays: false,
  },
}

export function isRequestKind(value: unknown): value is RequestKind {
  return typeof value === 'string' && (REQUEST_KINDS as readonly string[]).includes(value)
}

export function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === 'string' && (REQUEST_STATUSES as readonly string[]).includes(value)
}

// ---------- Поля заявки (пакет 3.4) ----------

/**
 * «Куда справка» у справки из деканата: 17 видов, порядок и написание — как в R-1.6, таблица 3.2. В базе хранится ключ
 * латиницей, на экране — подпись. Перечень со страницы faq.gubkin.ru, прочитан 12.11.2026. Со списком в кабинете вуза
 * человеком не сверен. Первая буква прописная; «в ВУЗ» записано как «В вуз».
 * Отступление от источника — решение пользователя 13.11.2026, замечание R-3.4-7: вид 16 в источнике называет настоящий вуз,
 * в прототипе подпись нейтральная — «Вызов в вуз». Ключ `summons` прежний.
 */
export const DEAN_PURPOSES = [
  { key: 'pension_fund', label: 'В Пенсионный фонд РФ' },
  { key: 'passport_office', label: 'В паспортный стол' },
  { key: 'parents_workplace', label: 'По месту работы родителей' },
  { key: 'student_workplace', label: 'По месту работы студента' },
  { key: 'tax_office', label: 'В налоговую инспекцию' },
  { key: 'social_security', label: 'В отдел социального обеспечения' },
  { key: 'insurance', label: 'В страховую компанию' },
  { key: 'library', label: 'В библиотеку' },
  { key: 'university', label: 'В вуз' },
  { key: 'embassy', label: 'В посольство' },
  { key: 'mosgortrans', label: 'В Мосгортранс' },
  { key: 'traffic_police', label: 'В ГИБДД' },
  { key: 'on_demand', label: 'По месту требования' },
  { key: 'residence', label: 'По месту жительства' },
  { key: 'railway_tickets', label: 'В кассы РЖД' },
  { key: 'summons', label: 'Вызов в вуз' },
  { key: 'study_period', label: 'О периоде обучения (с оценками, на основании заявления в деканате)' },
] as const

export type DeanPurpose = (typeof DEAN_PURPOSES)[number]['key']

export const DEAN_PURPOSE_KEYS: readonly DeanPurpose[] = DEAN_PURPOSES.map((p) => p.key)

export const DEAN_PURPOSE_LABELS = Object.fromEntries(DEAN_PURPOSES.map((p) => [p.key, p.label])) as Record<DeanPurpose, string>

/** Значение по умолчанию — «По месту требования» (решение проекта: самое общее назначение). */
export const DEFAULT_PURPOSE: DeanPurpose = 'on_demand'

export function isDeanPurpose(value: unknown): value is DeanPurpose {
  return typeof value === 'string' && (DEAN_PURPOSE_KEYS as readonly string[]).includes(value)
}

/** Самый ранний год оплаты: «налоговый период не ранее 2024 года», R-1.6, строка 84. */
export const PAYMENT_YEAR_MIN = 2024

/** Текущий год по часовому поясу вуза, как остальные даты. */
export function currentYearIn(timezone: string, now: Date = new Date()): number {
  return Number(todayIn(timezone, now).slice(0, 4))
}

/** Годы для выбора: от 2024 до текущего включительно, по возрастанию. */
export function paymentYears(currentYear: number): number[] {
  const years: number[] = []
  for (let year = PAYMENT_YEAR_MIN; year <= currentYear; year += 1) years.push(year)
  return years
}

/** По умолчанию — прошлый год, но не раньше 2024. Значение по умолчанию — решение проекта. */
export function defaultPaymentYear(currentYear: number): number {
  return Math.max(PAYMENT_YEAR_MIN, currentYear - 1)
}

/** Год из числа или из строки «2025» (так он приходит из формы). Любое другое значение — null. */
export function parsePaymentYear(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null
  if (typeof value === 'string' && /^\d{4}$/.test(value)) return Number(value)
  return null
}

export function isPaymentYear(value: unknown, currentYear: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= PAYMENT_YEAR_MIN && value <= currentYear
}

export interface RequestFields {
  purpose: DeanPurpose | null
  paymentYear: number | null
}

/** Значения по умолчанию для вида: справка из деканата — назначение, справка об оплате — год, помощь — ничего. */
export function defaultFields(kind: RequestKind, currentYear: number): RequestFields {
  return {
    purpose: kind === 'dean_certificate' ? DEFAULT_PURPOSE : null,
    paymentYear: kind === 'tuition_certificate' ? defaultPaymentYear(currentYear) : null,
  }
}

/**
 * Поля заявки из присланных значений. Не прислано (undefined или null) — значение по умолчанию. Прислано, но не из списка —
 * null: заявка не создаётся. Значение для вида, у которого такого поля нет, отбрасывается, даже неверное.
 */
export function normalizeFields(
  kind: RequestKind,
  input: { purpose?: unknown; paymentYear?: unknown },
  currentYear: number,
): RequestFields | null {
  const defaults = defaultFields(kind, currentYear)
  if (kind === 'dean_certificate') {
    if (input.purpose === undefined || input.purpose === null) return defaults
    return isDeanPurpose(input.purpose) ? { purpose: input.purpose, paymentYear: null } : null
  }
  if (kind === 'tuition_certificate') {
    if (input.paymentYear === undefined || input.paymentYear === null) return defaults
    const year = parsePaymentYear(input.paymentYear)
    return year !== null && isPaymentYear(year, currentYear) ? { purpose: null, paymentYear: year } : null
  }
  return defaults
}

/**
 * Прежние значения для «Подать снова»: подходит — берётся прежнее, иначе значение по умолчанию (например, год
 * вне нынешнего диапазона).
 */
export function reuseFields(
  kind: RequestKind,
  previous: { purpose: string | null; paymentYear: number | null },
  currentYear: number,
): RequestFields {
  const defaults = defaultFields(kind, currentYear)
  return {
    purpose: kind === 'dean_certificate' && isDeanPurpose(previous.purpose) ? previous.purpose : defaults.purpose,
    paymentYear:
      kind === 'tuition_certificate' && isPaymentYear(previous.paymentYear, currentYear) ? previous.paymentYear : defaults.paymentYear,
  }
}

export interface RequestFieldView {
  /** Подпись поля в форме и на экране сотрудника. */
  title: string
  /** Короткая подпись для строки «Куда: …». */
  shortLabel: string
  value: string
}

/** Поле заявки для показа; у материальной помощи и при неизвестном значении — null. */
export function requestFieldView(
  kind: RequestKind,
  fields: { purpose: string | null; paymentYear: number | null },
): RequestFieldView | null {
  if (kind === 'dean_certificate' && isDeanPurpose(fields.purpose)) {
    return { title: 'Куда справка', shortLabel: 'Куда', value: DEAN_PURPOSE_LABELS[fields.purpose] }
  }
  if (kind === 'tuition_certificate' && typeof fields.paymentYear === 'number') {
    return { title: 'Год оплаты', shortLabel: 'Год оплаты', value: String(fields.paymentYear) }
  }
  return null
}

/** Строка поля под заголовком: «Куда: В налоговую инспекцию» или «Год оплаты: 2025». */
export function requestFieldLine(kind: RequestKind, fields: { purpose: string | null; paymentYear: number | null }): string | null {
  const view = requestFieldView(kind, fields)
  return view ? `${view.shortLabel}: ${view.value}` : null
}

export const STATUS_LABELS: Record<RequestStatus, string> = {
  submitted: 'Подана',
  in_progress: 'В работе',
  ready: 'Готова',
  issued: 'Выдана',
  rejected: 'Отклонена',
}

/** Целевой статус -> из каких статусов в него можно перейти. Подана -> В работе -> Готова -> Выдана; в Отклонена — из первых двух. */
export const ALLOWED_FROM: Record<RequestStatus, readonly RequestStatus[]> = {
  submitted: [],
  in_progress: ['submitted'],
  ready: ['in_progress'],
  issued: ['ready'],
  rejected: ['submitted', 'in_progress'],
}

/** Статус -> в какие статусы из него можно перейти (для кнопок сотрудника). */
export function nextStatuses(from: RequestStatus): RequestStatus[] {
  return REQUEST_STATUSES.filter((target) => ALLOWED_FROM[target].includes(from))
}

export function isAllowedTransition(from: RequestStatus, to: RequestStatus): boolean {
  return ALLOWED_FROM[to].includes(from)
}

export const REJECT_REASONS = ['incomplete_data', 'not_eligible', 'duplicate', 'other'] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  incomplete_data: 'Не хватает данных',
  not_eligible: 'Нет оснований для выдачи',
  duplicate: 'Такая заявка уже подана',
  other: 'Другая причина, уточните в деканате',
}

export function isRejectReason(value: unknown): value is RejectReason {
  return typeof value === 'string' && (REJECT_REASONS as readonly string[]).includes(value)
}

/** Срок, который сервер записывает, когда сотрудник берёт заявку в работу. */
export function computeDueDate(kind: RequestKind, today: string): string {
  const info = REQUEST_KIND_INFO[kind]
  return info.workingDays ? addWorkingDays(today, info.productionDays) : addDays(today, info.productionDays)
}

/**
 * Дата «до <дата>» в тексте «Готова». Срока получения в источнике нет (S-2.1, раздел 5: «до <дата>»), поэтому берётся
 * единственный срок из источника — срок вида заявки (2 рабочих дня, 10 рабочих дней, 10 дней), отсчёт от дня, когда
 * сотрудник поставил «Готова». Число «5 рабочих дней» этапа 1 убрано: у него источника не было. Вопрос открыт — отчёт этапа 2.
 */
export function computePickupUntil(kind: RequestKind, today: string): string {
  return computeDueDate(kind, today)
}

export interface StatusTextInput {
  kind: RequestKind
  status: RequestStatus
  dueDate: string | null
  pickupUntil: string | null
  issuedOn: string | null
  rejectReason: string | null
}

/**
 * Что видит студент: не «статус», а «что дальше» (решение по Р-2). Тексты «Подана», «В работе» у справок, «Готова» и «Выдана»
 * у материальной помощи и «Отклонена» с причиной `other` — решения пользователя 13.11.2026, смена 14. Точки в конце нет.
 */
export function statusText(input: StatusTextInput): string {
  const info = REQUEST_KIND_INFO[input.kind]
  switch (input.status) {
    case 'submitted':
      return 'Заявка у деканата. Пока ничего делать не нужно'
    case 'in_progress': {
      const due = input.dueDate ? formatDate(input.dueDate) : 'уточняется'
      return input.kind === 'financial_aid'
        ? `Заявка согласована. Принесите оригиналы документов до ${due}`
        : `Пока ничего. Срок — до ${due}`
    }
    case 'ready': {
      if (input.kind === 'financial_aid') {
        return `Комиссия рассмотрела заявление. Узнайте решение в деканате, кабинет ${info.room}`
      }
      const until = input.pickupUntil ? formatDate(input.pickupUntil) : 'уточняется'
      return `Получите и заверьте в деканате, кабинет ${info.room}, до ${until}. Возьмите студенческий билет`
    }
    case 'issued': {
      const on = input.issuedOn ? formatDate(input.issuedOn) : ''
      return input.kind === 'financial_aid' ? `Заявление закрыто ${on}`.trim() : `Вы получили документ ${on}`.trim()
    }
    case 'rejected': {
      if (input.rejectReason === 'other') return 'Заявка отклонена. Причину уточните в деканате. Можно подать снова'
      const reason = isRejectReason(input.rejectReason) ? REJECT_REASON_LABELS[input.rejectReason] : 'не указана'
      return `Заявка отклонена. Причина: ${reason}. Можно подать снова`
    }
  }
}

// ---------- Шаги заявки (D-2.2-system, 5.8) ----------

export type StepState = 'done' | 'now' | 'next' | 'next_you' | 'rejected'

/** Слова состояния шага. Прописными в разметке, а не через стиль: так их читает экранный чтец. */
export const STEP_STATE_WORDS: Record<StepState, string> = {
  done: 'СДЕЛАНО',
  now: 'СЕЙЧАС',
  next: 'ДАЛЬШЕ',
  next_you: 'ДАЛЬШЕ — ВАМ',
  rejected: 'ОТКЛОНЕНО',
}

export interface RequestStep {
  /** Статус, которому соответствует шаг; у шага «Отклонена» — rejected. */
  key: RequestStatus
  title: string
  state: StepState
  /** Пояснение под названием; null — пояснения нет. */
  note: string | null
  /** Блок «Куда / До какого дня»: только у шага «Готова» при статусе «Готова». `until` у материальной помощи — null. */
  where: { room: string; until: string | null } | null
  /** Шаг, на который ставится `aria-current="step"`: «сейчас» и «отклонено». У выданной заявки такого шага нет. */
  current: boolean
}

export interface BuildStepsInput {
  kind: RequestKind
  status: RequestStatus
  /** История статусов заявки; порядок не важен, берётся самая ранняя запись статуса. */
  events: readonly { status: string; createdAt: Date }[]
  /** Момент подачи: на него опирается шаг «Подана», если записи о подаче в истории нет. */
  createdAt: Date
  dueDate: string | null
  pickupUntil: string | null
  issuedOn: string | null
  timezone: string
}

const FLOW_STEPS = ['submitted', 'in_progress', 'ready', 'issued'] as const satisfies readonly RequestStatus[]

/**
 * Шаги заявки с состоянием и пояснением. Правила и тексты — D-2.2-system, 5.8: таблицы «Шаги по статусам» и «Откуда берутся
 * поля шага». Пояснение, для которого нет данных, не выдумывается. Выдана: все четыре шага «сделано», «сейчас» нет.
 * Отклонена: пройденные шаги (подача — всегда, остальные — если в истории есть их запись) и один шаг «Отклонена».
 */
export function buildRequestSteps(input: BuildStepsInput): RequestStep[] {
  const { kind, status, timezone } = input
  const info = REQUEST_KIND_INFO[kind]
  const eventAt = (step: RequestStatus): Date | null => {
    const found = input.events
      .filter((e) => e.status === step)
      .map((e) => e.createdAt)
      .sort((a, b) => a.getTime() - b.getTime())[0]
    return found ?? null
  }
  const when = (at: Date | null): string | null =>
    at ? `${formatDate(todayIn(timezone, at))}, ${nowTimeIn(timezone, at)}` : null
  const withSentence = (text: string | null, tail: string): string | null => (text ? `${text}.${tail}` : null)

  const submittedWhen = when(eventAt('submitted') ?? input.createdAt)
  const doneNote = (step: RequestStatus): string | null => {
    if (step === 'submitted') return withSentence(submittedWhen, ' Деканат её получил.')
    if (step === 'issued') {
      if (!input.issuedOn) return null
      const on = formatDate(input.issuedOn)
      return kind === 'financial_aid' ? `Заявление закрыто ${on}.` : `Вы получили документ ${on}.`
    }
    return withSentence(when(eventAt(step)), '')
  }

  if (status === 'rejected') {
    const steps: RequestStep[] = FLOW_STEPS.filter(
      (step) => step === 'submitted' || (step !== 'issued' && eventAt(step) !== null),
    ).map((step) => ({
      key: step,
      title: STATUS_LABELS[step],
      state: 'done' as const,
      note: doneNote(step),
      where: null,
      current: false,
    }))
    steps.push({
      key: 'rejected',
      title: STATUS_LABELS.rejected,
      state: 'rejected',
      note: withSentence(when(eventAt('rejected')), ''),
      where: null,
      current: true,
    })
    return steps
  }

  const currentIndex = FLOW_STEPS.indexOf(status)
  return FLOW_STEPS.map((step, index): RequestStep => {
    const title = STATUS_LABELS[step]
    if (index < currentIndex || status === 'issued') {
      return { key: step, title, state: 'done', note: doneNote(step), where: null, current: false }
    }
    if (index === currentIndex) {
      if (step === 'submitted') {
        return { key: step, title, state: 'now', note: doneNote(step), where: null, current: true }
      }
      if (step === 'in_progress') {
        const note = input.dueDate ? `Срок — до ${formatDate(input.dueDate)}.` : null
        return { key: step, title, state: 'now', note, where: null, current: true }
      }
      // Готова: блок «Куда / До какого дня». У материальной помощи срока получения на экране нет, только «Куда».
      const until = kind !== 'financial_aid' && input.pickupUntil ? formatDate(input.pickupUntil) : null
      return { key: step, title, state: 'now', note: null, where: { room: info.room, until }, current: true }
    }
    // Впереди. «Вам» — только шаг «Готова» при «В работе»: студент придёт за документом. Строка про получение — у справок.
    const pickupNote = step === 'ready' && kind !== 'financial_aid' ? info.pickup : null
    const state: StepState = step === 'ready' && status === 'in_progress' ? 'next_you' : 'next'
    return { key: step, title, state, note: pickupNote, where: null, current: false }
  })
}
