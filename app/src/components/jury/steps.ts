// Сценарий для жюри: пять шагов и чистая логика вокруг них (без React и без браузера — её проверяет модульный тест).
// Панель (jury-panel.tsx) показывает один шаг за раз — что смотреть на этой странице — и кнопки «Назад» и «Далее».
// 20.11.2026 по отзыву капитана: шаги по одному с кнопкой «Далее», страница «Как это сделано» из сценария убрана.

export interface JuryStep {
  /** Номер шага для людей, с 1. */
  n: number
  label: string
  /** Что посмотреть на этой странице — одна-две короткие фразы. */
  hint: string
  href: string
  /** Ещё адреса, которые относятся к этому шагу (вместе с вложенными). */
  also?: readonly string[]
}

export const JURY_STEPS: readonly JuryStep[] = [
  {
    n: 1,
    label: 'Сегодня: что ждёт студента',
    hint: 'Сверху — «Ждёт вас»: долг, нехватка баллов до допуска, готовая справка. У каждой строки — одно действие.',
    href: '/',
  },
  {
    n: 2,
    label: 'Успеваемость: долг и допуск',
    hint: 'Сводка «Как у меня дела» и предметы строками. Раскройте «Все работы» у любого предмета.',
    href: '/grades',
  },
  {
    n: 3,
    label: 'Справка одной фразой и с QR',
    hint: 'Напишите «справка в военкомат к пятнице» и нажмите «Заполнить». Или «Получить сразу» — справка с QR-кодом для проверки.',
    // Без вида адрес /requests/new отправляет на список заявок, поэтому шаг ведёт сразу на справку из деканата.
    href: '/requests/new?type=dean_certificate',
  },
  {
    n: 4,
    label: 'Заявки: что требует ответа',
    hint: 'Фильтр «Требуют ответа» — где ход за студентом. Внутри заявки — путь по шагам с датами.',
    href: '/requests',
  },
  {
    n: 5,
    label: 'Сотрудник: заявки и вопросы',
    hint: 'Нужен вход сотрудником, логин — в README. Просроченные заявки — наверху, у вопроса студента — черновик ответа.',
    href: '/staff/requests',
    also: ['/staff/questions'],
  },
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
    for (const raw of [step.href, ...(step.also ?? [])]) {
      const stepPath = normalizePath(raw)
      const matches = stepPath === '/' ? path === '/' : path === stepPath || path.startsWith(`${stepPath}/`)
      if (matches && stepPath.length > bestLength) {
        best = index
        bestLength = stepPath.length
      }
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

/**
 * Соседи для кнопок «Назад» и «Далее». Страница вне сценария (`current === null`) — назад нельзя, «Далее» ведёт на шаг 1.
 * На последнем шаге «Далее» нет: панель предлагает закончить.
 */
export function juryNeighbours(current: number | null): { prev: JuryStep | null; next: JuryStep | null } {
  if (current === null) return { prev: null, next: JURY_STEPS[0] ?? null }
  return { prev: JURY_STEPS[current - 1] ?? null, next: JURY_STEPS[current + 1] ?? null }
}
