// Меню сотрудника (20.11, блиц): пункты и правило «какой пункт активен по адресу». Чистая логика, без React.

export type StaffNavKey = 'summary' | 'requests' | 'questions' | 'students' | 'announcements'

export interface StaffNavItem {
  key: StaffNavKey
  label: string
  href: string
}

/** Список вопросов есть: это вид `?view=questions` на экране заявок, поэтому пункт «Вопросы» ведёт туда. */
export const STAFF_NAV: readonly StaffNavItem[] = [
  { key: 'summary', label: 'Сводка', href: '/staff' },
  { key: 'requests', label: 'Заявки', href: '/staff/requests' },
  { key: 'questions', label: 'Вопросы', href: '/staff/requests?view=questions' },
  { key: 'students', label: 'Студенты', href: '/staff/students' },
  { key: 'announcements', label: 'Объявления', href: '/staff/announcements' },
]

/** Адрес без строки запроса, якоря и хвостового «/». */
function barePath(pathname: string): string {
  const bare = ((pathname.split('#')[0] ?? '').split('?')[0] ?? '').replace(/\/+$/, '')
  return bare === '' ? '/' : bare
}

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

/**
 * Активный пункт по адресу. `view` — значение параметра `?view=` (на экране заявок `questions` — это вопросы).
 * Вне кабинета сотрудника и на незнакомом адресе — null: ни один пункт не подсвечивается.
 */
export function activeStaffNav(pathname: string | null | undefined, view?: string | null): StaffNavKey | null {
  if (!pathname) return null
  const path = barePath(pathname)
  if (path === '/staff') return 'summary'
  if (under(path, '/staff/requests')) return path === '/staff/requests' && view === 'questions' ? 'questions' : 'requests'
  if (under(path, '/staff/questions')) return 'questions'
  if (under(path, '/staff/students')) return 'students'
  if (under(path, '/staff/announcements')) return 'announcements'
  return null
}

/** Меню нужно только на экранах кабинета сотрудника: общий каркас рисует и страницы вне него. */
export function isStaffArea(pathname: string | null | undefined): boolean {
  return !!pathname && under(barePath(pathname), '/staff')
}
