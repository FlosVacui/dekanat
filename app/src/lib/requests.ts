// Виды заявок, статусы, допустимые переходы и тексты статусов: S-2.1, раздел 5. Чистая логика, без базы.
// Все номера кабинетов и сроки вымышленные (ТР-5). Сроки и кабинет в текстах подставляет сервер.
import { addDays, addWorkingDays, formatDate } from './dates'

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

/** Что видит студент: не «статус», а «что дальше» (решение по Р-2). */
export function statusText(input: StatusTextInput): string {
  const info = REQUEST_KIND_INFO[input.kind]
  switch (input.status) {
    case 'submitted':
      return 'Заявка у деканата. Сообщим, когда её возьмут в работу'
    case 'in_progress': {
      const due = input.dueDate ? formatDate(input.dueDate) : 'уточняется'
      return input.kind === 'financial_aid'
        ? `Заявка согласована. Принесите оригиналы документов до ${due}`
        : `Готовим. Срок — до ${due}`
    }
    case 'ready': {
      const until = input.pickupUntil ? formatDate(input.pickupUntil) : 'уточняется'
      return `Получите и заверьте в деканате, кабинет ${info.room}, до ${until}. Возьмите студенческий билет`
    }
    case 'issued': {
      const on = input.issuedOn ? formatDate(input.issuedOn) : ''
      return `Вы получили документ ${on}`.trim()
    }
    case 'rejected': {
      const reason = isRejectReason(input.rejectReason) ? REJECT_REASON_LABELS[input.rejectReason] : 'не указана'
      return `Заявка отклонена. Причина: ${reason}. Можно подать снова`
    }
  }
}
