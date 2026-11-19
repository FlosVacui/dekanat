// Сценарий для жюри на 60 секунд: шесть шагов и чистая логика вокруг них (без React и без браузера — её проверяет модульный тест).
// Панель (jury-panel.tsx) берёт отсюда шаги, определение текущего шага по адресу и разбор сохранённого состояния.

export interface JuryStep {
  /** Номер шага для людей, с 1. */
  n: number
  label: string
  href: string
}

export const JURY_STEPS: readonly JuryStep[] = [
  { n: 1, label: 'Студент → Сегодня: что ждёт студента', href: '/' },
  { n: 2, label: 'Успеваемость: долг и допуск', href: '/grades' },
  // Без вида адрес /requests/new отправляет на список заявок, поэтому шаг ведёт сразу на справку об обучении.
  { n: 3, label: 'Справка за секунду с QR', href: '/requests/new?type=dean_certificate' },
  { n: 4, label: 'Заявки: что требует ответа', href: '/requests' },
  { n: 5, label: 'Сотрудник: заявки, просроченные наверху', href: '/staff/requests' },
  { n: 6, label: 'Как это сделано', href: '/process' },
]

/** Адрес без строки запроса, якоря и хвостового «/»: `/requests/?a=1#b` → `/requests`. Корень остаётся `/`. */
export function normalizePath(pathname: string): string {
  const bare = (pathname.split('#')[0] ?? '').split('?')[0] ?? ''
  const trimmed = bare.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * Какой шаг подсвечен на этой странице: индекс в `JURY_STEPS` или `null`, если страница вне сценария.
 * Страница шага и её вложенные адреса (`/grades/<id>`, `/staff/requests/<id>`) относятся к шагу. Побеждает самый длинный совпавший адрес:
 * `/requests/new` — шаг 3, а не 4. Корень `/` совпадает только сам с собой, иначе подсвечивалось бы всё.
 */
export function currentJuryStep(pathname: string | null | undefined): number | null {
  if (!pathname) return null
  const path = normalizePath(pathname)
  let best: number | null = null
  let bestLength = -1
  JURY_STEPS.forEach((step, index) => {
    // Сравнивается адрес шага без строки запроса: у шага 3 в ссылке есть `?type=…`, у страницы в `usePathname` его нет.
    const stepPath = normalizePath(step.href)
    const matches = stepPath === '/' ? path === '/' : path === stepPath || path.startsWith(`${stepPath}/`)
    if (matches && stepPath.length > bestLength) {
      best = index
      bestLength = stepPath.length
    }
  })
  return best
}

export type JuryPanelState = 'open' | 'closed'

/** Ключ в `localStorage`. В значении только слово `open` или `closed`, ничего личного. */
export const JURY_STORAGE_KEY = 'dekanat-jury-panel'

/** Ширина окна, от которой панель по умолчанию открыта (десктоп). Уже — по умолчанию свёрнута, чтобы не закрывать страницу. */
export const JURY_WIDE_MIN_PX = 1024

/** Сохранённый выбор: `open`, `closed` или `null` — выбора нет (нет значения или мусор). */
export function parseStoredChoice(raw: string | null | undefined): JuryPanelState | null {
  return raw === 'closed' || raw === 'open' ? raw : null
}

/** Состояние панели: сохранённый выбор главнее; выбора нет — открыта от 1024 px и свёрнута уже. */
export function resolvePanelState(stored: JuryPanelState | null, viewportWidth: number): JuryPanelState {
  return stored ?? (viewportWidth >= JURY_WIDE_MIN_PX ? 'open' : 'closed')
}
