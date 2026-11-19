// Заявка одной фразой: подбор вида справки, назначения, года оплаты, срока и числа экземпляров по ключевым словам и датам.
// Чистая функция, без базы, сети и языковой модели. Результат только предзаполняет форму: подаёт заявку студент сам.
import { addDays, formatDate, isIsoDate } from './dates'
import { isDeanPurpose, isPaymentYear, isRequestKind, type DeanPurpose, type RequestKind } from './requests'

export interface Intent {
  /** Вид заявки; null — не распознан. */
  kind: RequestKind | null
  /** Назначение справки из деканата; только при kind = dean_certificate. */
  purpose: DeanPurpose | null
  /** Год оплаты; только при kind = tuition_certificate. */
  paymentYear: number | null
  /** Желаемый срок «ГГГГ-ММ-ДД»; в заявку не записывается (у заявки нет такого поля), показывается студенту. */
  dueDate: string | null
  /** Число экземпляров; так же только показывается. */
  copies: number | null
  /** Распознан ли вид. Нет — форме остаётся выбор вручную. */
  recognized: boolean
}

/** Самая длинная фраза студента, в знаках: и для ключевых слов, и для модели. */
export const MAX_TEXT = 300

/** Нижний регистр, «ё» как «е», лишние пробелы сжаты. */
function normalize(text: string): string {
  return text.slice(0, MAX_TEXT).toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim()
}

// Назначения справки из деканата. Порядок важен: частное раньше общего («работы родителей» раньше «по месту работы»).
const PURPOSE_RULES: readonly { key: DeanPurpose; pattern: RegExp }[] = [
  { key: 'summons', pattern: /вызов/ },
  { key: 'parents_workplace', pattern: /работ[а-я]*\s+родител|родител[а-я]*.*работ/ },
  { key: 'student_workplace', pattern: /по\s+месту\s+работы|на\s+работу|работодател/ },
  { key: 'pension_fund', pattern: /пенсион|(?<![а-я])пфр(?![а-я])/ },
  { key: 'passport_office', pattern: /паспортн/ },
  { key: 'tax_office', pattern: /налогов|(?<![а-я])ифнс(?![а-я])/ },
  { key: 'social_security', pattern: /соцзащит|соц[а-я]*\s+защит|социальн[а-я]*\s+(?:обеспечен|защит)|(?<![а-я])собес/ },
  { key: 'insurance', pattern: /страхов/ },
  { key: 'library', pattern: /библиотек/ },
  { key: 'embassy', pattern: /посольств|консульств|(?<![а-я])виз[аыуе](?![а-я])/ },
  { key: 'mosgortrans', pattern: /мосгортранс|проездн|транспортн[а-я]*\s+карт/ },
  { key: 'traffic_police', pattern: /гибдд|водительск|(?<![а-я])права(?![а-я])/ },
  { key: 'railway_tickets', pattern: /(?<![а-я])ржд|железнодорож|(?<![а-я])жд[-\s]?билет|билет[а-я]*\s+на\s+поезд/ },
  { key: 'study_period', pattern: /период[а-я]*\s+обучен|с\s+оценками/ },
  { key: 'residence', pattern: /по\s+месту\s+жительств|месту\s+жительств/ },
  { key: 'university', pattern: /в\s+(?:другой\s+)?вуз(?![а-я])|в\s+университет/ },
  // В списке назначений военкомата нет: ближайшее по смыслу — «По месту требования».
  { key: 'on_demand', pattern: /военкомат|воинск[а-я]*\s+учет|призыв|отсрочк|по\s+месту\s+требовани/ },
]

const AID_PATTERN = /материальн[а-я]*\s+помощ|(?<![а-я])мат\.?\s*помощ|матпомощ/
const TUITION_PATTERN = /оплат|вычет|стоимост[а-я]*\s+обучен/
const DEAN_PATTERN = /справк|деканат/

const WEEKDAY_FORMS: readonly string[] = [
  'воскресенье|воскресенью|воскресенья', // 0
  'понедельник|понедельнику|понедельника', // 1
  'вторник|вторнику|вторника', // 2
  'среда|среде|среду|среды', // 3
  'четверг|четвергу|четверга', // 4
  'пятница|пятнице|пятницу|пятницы', // 5
  'суббота|субботе|субботу|субботы', // 6
]

const MONTH_STEMS: readonly string[] = [
  'январ',
  'феврал',
  'март',
  'апрел',
  'ма[яй]',
  'июн',
  'июл',
  'август',
  'сентябр',
  'октябр',
  'ноябр',
  'декабр',
]

const NUMBER_WORDS: Record<string, number> = {
  один: 1, одна: 1, одну: 1, одном: 1,
  два: 2, две: 2, двух: 2,
  три: 3, трех: 3,
  четыре: 4, четырех: 4,
  пять: 5, пяти: 5,
}

function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** День и месяц без года: этот год, а если день уже прошёл — следующий. */
function dateWithoutYear(day: number, month: number, today: string): string | null {
  const thisYear = Number(today.slice(0, 4))
  const candidate = `${thisYear}-${pad(month)}-${pad(day)}`
  if (!isIsoDate(candidate)) return null
  if (candidate >= today) return candidate
  const next = `${thisYear + 1}-${pad(month)}-${pad(day)}`
  return isIsoDate(next) ? next : null
}

interface Extracted<T> {
  value: T | null
  /** Текст без распознанного куска: чтобы число в дате не принималось за год или число экземпляров. */
  rest: string
}

function cut(text: string, match: RegExpExecArray): string {
  return `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
}

function extractDate(text: string, today: string): Extracted<string> {
  let m: RegExpExecArray | null

  m = /(?<![а-я\d])послезавтра(?![а-я])/.exec(text)
  if (m) return { value: addDays(today, 2), rest: cut(text, m) }
  m = /(?<![а-я\d])завтра(?![а-я])/.exec(text)
  if (m) return { value: addDays(today, 1), rest: cut(text, m) }
  m = /(?<![а-я\d])сегодня(?![а-я])/.exec(text)
  if (m) return { value: today, rest: cut(text, m) }

  m = /через\s+(\d{1,2}|неделю|недельку)\s*(дня|дней|день|недели|недель|неделю)?/.exec(text)
  if (m) {
    const weeks = /недел/.test(m[1] ?? '') || /недел/.test(m[2] ?? '')
    const n = /^\d/.test(m[1] ?? '') ? Number(m[1]) : 1
    if (n >= 1 && n <= 60) return { value: addDays(today, weeks ? n * 7 : n), rest: cut(text, m) }
  }

  // 25.11, 25.11.26, 25.11.2026
  m = /(?<![\d.])(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2}))?(?![\d])/.exec(text)
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2])
    const rawYear = m[3]
    let value: string | null
    if (rawYear) {
      const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)
      const iso = `${year}-${pad(month)}-${pad(day)}`
      value = isIsoDate(iso) ? iso : null
    } else {
      value = dateWithoutYear(day, month, today)
    }
    if (value) return { value, rest: cut(text, m) }
  }

  // 25 ноября, 25 ноября 2026
  const monthPattern = MONTH_STEMS.map((s) => `${s}[а-я]*`).join('|')
  m = new RegExp(`(?<![\\d.])(\\d{1,2})\\s+(${monthPattern})(?:\\s+(\\d{4}))?(?![а-я])`).exec(text)
  if (m) {
    const word = m[2] ?? ''
    const month = MONTH_STEMS.findIndex((stem) => new RegExp(`^${stem}`).test(word)) + 1
    const day = Number(m[1])
    let value: string | null = null
    if (month > 0) {
      if (m[3]) {
        const iso = `${m[3]}-${pad(month)}-${pad(day)}`
        value = isIsoDate(iso) ? iso : null
      } else {
        value = dateWithoutYear(day, month, today)
      }
    }
    if (value) return { value, rest: cut(text, m) }
  }

  // К пятнице, до среды, в понедельник: ближайший такой день строго после сегодняшнего.
  for (let dow = 0; dow < 7; dow += 1) {
    m = new RegExp(`(?<![а-я])(?:к|ко|до|в|во|на)\\s+(?:ближайш[а-я]+\\s+)?(?:${WEEKDAY_FORMS[dow]})(?![а-я])`).exec(text)
    if (m) {
      let delta = (dow - weekdayOf(today) + 7) % 7
      if (delta === 0) delta = 7
      return { value: addDays(today, delta), rest: cut(text, m) }
    }
  }
  return { value: null, rest: text }
}

function extractCopies(text: string): Extracted<number> {
  let m = /(?<![\d.])(\d{1,2})\s*(?:экз|экземпляр|копи)/.exec(text)
  if (m) {
    const n = Number(m[1])
    return { value: n >= 1 && n <= 10 ? n : null, rest: cut(text, m) }
  }
  m = /(?<![а-я])(один|одна|одну|одном|два|две|двух|три|трех|четыре|четырех|пять|пяти)\s+(?:экземпляр|копи)/.exec(text)
  if (m) return { value: NUMBER_WORDS[m[1] ?? ''] ?? null, rest: cut(text, m) }
  return { value: null, rest: text }
}

function extractPaymentYear(text: string, currentYear: number): number | null {
  const explicit = /(?<![\d.])(20\d{2})(?![\d])/.exec(text)
  if (explicit) {
    const year = Number(explicit[1])
    return isPaymentYear(year, currentYear) ? year : null
  }
  if (/прошл[а-я]+\s+год|за\s+прошлый/.test(text)) {
    const year = currentYear - 1
    return isPaymentYear(year, currentYear) ? year : null
  }
  if (/(?:этот|текущ[а-я]+)\s+год/.test(text)) return isPaymentYear(currentYear, currentYear) ? currentYear : null
  return null
}

/**
 * Разбор фразы вроде «справка в налоговую к пятнице, 2 экземпляра». `today` — сегодняшний день вуза «ГГГГ-ММ-ДД».
 * Ничего не выдумывает: что не нашлось по ключевым словам, остаётся null.
 */
export function parseIntent(input: string, today: string): Intent {
  const empty: Intent = { kind: null, purpose: null, paymentYear: null, dueDate: null, copies: null, recognized: false }
  if (typeof input !== 'string' || !isIsoDate(today)) return empty
  const text = normalize(input)
  if (!text) return empty

  const dated = extractDate(text, today)
  const copied = extractCopies(dated.rest)
  const rest = copied.rest
  const currentYear = Number(today.slice(0, 4))

  let kind: RequestKind | null = null
  let purpose: DeanPurpose | null = null
  if (AID_PATTERN.test(rest)) {
    kind = 'financial_aid'
  } else if (TUITION_PATTERN.test(rest)) {
    kind = 'tuition_certificate'
  } else {
    purpose = PURPOSE_RULES.find((rule) => rule.pattern.test(rest))?.key ?? null
    if (purpose || DEAN_PATTERN.test(rest)) kind = 'dean_certificate'
  }
  if (!kind) return { ...empty, dueDate: dated.value, copies: copied.value }

  return {
    kind,
    purpose: kind === 'dean_certificate' ? purpose : null,
    paymentYear: kind === 'tuition_certificate' ? extractPaymentYear(rest, currentYear) : null,
    dueDate: dated.value,
    copies: copied.value,
    recognized: true,
  }
}

/** Что понято, для строки над формой: «Срок: до 21.11.2026», «Экземпляров: 2». Вид и поле формы показывает сама форма. */
export function intentExtras(intent: Intent): string[] {
  const lines: string[] = []
  if (intent.dueDate) lines.push(`Срок: до ${formatDate(intent.dueDate)}`)
  if (intent.copies) lines.push(`Экземпляров: ${intent.copies}`)
  return lines
}

// ---------- Разбор моделью (19.11, ИИ-функции): проверка ответа ----------
// Сам запрос к модели — в server/ai.ts. Здесь только чистая проверка: ответ модели — ввод извне, как поле формы.

export type IntentSource = 'ai' | 'keywords'

/** Подпись над результатом: честно говорит, кто разобрал фразу. */
export const INTENT_SOURCE_LABELS: Record<IntentSource, string> = {
  ai: 'Разобрано ИИ — проверьте поля',
  keywords: 'Подбор по ключевым словам',
}

const MAX_COPIES = 10
/** Срок дальше года вперёд — скорее ошибка модели, чем желание студента. */
const MAX_DUE_DAYS = 366

/**
 * Достаёт JSON-объект из текста ответа модели: чистый JSON или JSON в ограде ```json … ```, либо с текстом вокруг.
 * Не объект (массив, число, мусор) — null.
 */
export function extractJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  // Массив с объектом внутри — не тот ответ, о котором просили: объект не вынимается.
  const bracket = text.indexOf('[')
  if (bracket >= 0 && bracket < start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Проверка разобранного моделью объекта `{kind, purpose, dueDate, copies}` теми же правилами, что у формы:
 * вид — из `REQUEST_KINDS`, назначение — из списка назначений, срок — настоящая дата не раньше сегодняшнего дня и не позже
 * чем через год, число экземпляров — целое от 1 до 10. Что-то названо, но не проходит проверку, или вид не назван — null:
 * вызывающий переходит к разбору по ключевым словам. Год оплаты модель не просят: он берётся из `keywords`.
 */
export function validateModelIntent(raw: unknown, today: string, keywords: Intent): Intent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !isIsoDate(today)) return null
  const obj = raw as Record<string, unknown>
  if (!isRequestKind(obj.kind)) return null
  const kind = obj.kind

  let purpose: DeanPurpose | null = null
  if (obj.purpose !== null && obj.purpose !== undefined) {
    if (!isDeanPurpose(obj.purpose)) return null
    purpose = kind === 'dean_certificate' ? obj.purpose : null
  }

  let dueDate: string | null = null
  if (obj.dueDate !== null && obj.dueDate !== undefined) {
    if (typeof obj.dueDate !== 'string' || !isIsoDate(obj.dueDate)) return null
    if (obj.dueDate < today || obj.dueDate > addDays(today, MAX_DUE_DAYS)) return null
    dueDate = obj.dueDate
  }

  let copies: number | null = null
  if (obj.copies !== null && obj.copies !== undefined) {
    if (typeof obj.copies !== 'number' || !Number.isInteger(obj.copies) || obj.copies < 1 || obj.copies > MAX_COPIES) return null
    copies = obj.copies
  }

  return {
    kind,
    purpose,
    paymentYear: kind === 'tuition_certificate' && keywords.kind === 'tuition_certificate' ? keywords.paymentYear : null,
    dueDate,
    copies,
    recognized: true,
  }
}
