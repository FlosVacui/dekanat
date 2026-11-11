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
