// Даты как строки «ГГГГ-ММ-ДД»: без часовых поясов браузера, без сдвигов на границе суток.

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string): boolean {
  if (!ISO.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Сегодняшний день в часовом поясе вуза. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  // Локаль en-CA даёт формат ГГГГ-ММ-ДД.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Прибавляет рабочие дни: суббота и воскресенье не считаются. Праздники не учитываются (вымышленные данные). */
export function addWorkingDays(iso: string, days: number): string {
  let current = iso
  let left = days
  while (left > 0) {
    current = addDays(current, 1)
    const dow = new Date(`${current}T00:00:00Z`).getUTCDay()
    if (dow !== 0 && dow !== 6) left -= 1
  }
  return current
}

/** «2026-11-12» -> «12.11.2026». */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

/** «2026-11-12» -> «12 ноября». */
export function formatDayMonth(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MONTHS_GENITIVE[Number(m) - 1] ?? ''}`.trim()
}

/** «2026-11-12» -> «чт». */
export function weekdayShort(iso: string): string {
  return WEEKDAYS_SHORT[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? ''
}

/** Текущее время «ЧЧ:ММ» в часовом поясе вуза. */
export function nowTimeIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
}

/** Ближайшее воскресенье (конец учебной недели); если день — воскресенье, он сам. */
export function endOfWeek(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return addDays(iso, dow === 0 ? 0 : 7 - dow)
}

/** Начало вымышленного семестра: от него считается номер учебной недели. Вымышленное значение (ТР-5). */
export const SEMESTER_START = '2026-09-01'

/** Понедельник недели, в которую попадает день. */
function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return addDays(iso, dow === 0 ? -6 : 1 - dow)
}

/** Номер учебной недели и её вид: нечётные недели — верхние, чётные — нижние. До начала семестра — null. */
export function weekInfo(iso: string): { number: number; kind: 'верхняя' | 'нижняя' } | null {
  const days = (Date.parse(`${mondayOf(iso)}T00:00:00Z`) - Date.parse(`${mondayOf(SEMESTER_START)}T00:00:00Z`)) / 86_400_000
  if (days < 0) return null
  const number = Math.floor(days / 7) + 1
  return { number, kind: number % 2 === 1 ? 'верхняя' : 'нижняя' }
}
