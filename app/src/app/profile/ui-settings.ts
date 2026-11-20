// Настройки отображения (20.11, блиц): тема и размер текста. Хранятся в куке `ui` вида «тема.размер», например «dark.large».
// Чистые функции: кука не секретная, читается и сервером (layout.tsx), и браузером; значение разбирается строго по списку.

export const UI_COOKIE = 'ui'
/** Срок куки — год. */
export const UI_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]
export const TEXT_SIZES = ['normal', 'large', 'xlarge'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export interface UiSettings {
  theme: Theme
  size: TextSize
}

/**
 * Без куки всё как было до настроек: светлая тема и обычный размер. «Как в системе» — только если посетитель выбрал его сам:
 * без выбора тёмная тема у посетителей с тёмной системой сама не включается.
 */
export const DEFAULT_UI: UiSettings = { theme: 'light', size: 'normal' }

export const THEME_LABELS: Record<Theme, string> = { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' }
export const SIZE_LABELS: Record<TextSize, string> = { normal: 'Обычный', large: 'Крупный', xlarge: 'Очень крупный' }

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && (TEXT_SIZES as readonly string[]).includes(value)
}

/** Значение куки -> настройки. Нет куки, мусор, лишние части — значения по умолчанию целиком, а не по частям. */
export function parseUi(value: string | undefined | null): UiSettings {
  if (typeof value !== 'string' || value.length > 40) return DEFAULT_UI
  const parts = value.split('.')
  const [theme, size] = parts
  if (parts.length !== 2 || !isTheme(theme) || !isTextSize(size)) return DEFAULT_UI
  return { theme, size }
}

export function serializeUi(settings: UiSettings): string {
  return `${settings.theme}.${settings.size}`
}

/** Класс на `<html>`: тёмная тема и размер текста. «Как в системе» класс не ставит: его добавляет скрипт по настройке браузера. */
export function htmlClassName(settings: UiSettings): string {
  const classes: string[] = []
  if (settings.theme === 'dark') classes.push('dark')
  if (settings.size !== 'normal') classes.push(`ui-${settings.size}`)
  return classes.join(' ')
}

// Размеры текста. Размеры экрана заданы переменными --fs-* в пикселях (tokens.css), поэтому корневой font-size на них не
// действует: масштабируются сами переменные. Самый мелкий текст (--fs-xs: подписи вкладок, плашки) не растёт: подпись
// «Успеваемость» на 360 px при 12 px занимает всю 90-пиксельную ячейку, при 12,5 px уже не помещается (замер 20.11).
// Правило стоит после tokens.css по порядку и перебивает :root специфичностью (html.класс).
const SCALES: Record<Exclude<TextSize, 'normal'>, { factor: number; xs: number }> = {
  large: { factor: 1.125, xs: 1.0 },
  xlarge: { factor: 1.25, xs: 1.0 },
}
const BASE_PX = { xs: 12, sm: 14, md: 16, lg: 19, xl: 28, num: 30 } as const

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`
}

export const TEXT_SIZE_CSS: string = (Object.keys(SCALES) as (keyof typeof SCALES)[])
  .map((key) => {
    const { factor, xs } = SCALES[key]
    const vars = (Object.keys(BASE_PX) as (keyof typeof BASE_PX)[])
      .map((name) => `--fs-${name}:${px(BASE_PX[name] * (name === 'xs' ? xs : factor))}`)
      .join(';')
    return `html.ui-${key}{${vars}}`
  })
  .join('\n')

/**
 * Скрипт до первой отрисовки: при выбранном «Как в системе» и тёмной системе ставит класс `dark` сразу, без мигания.
 * Выбор приходит атрибутом `data-theme` на `<html>`, который ставит сервер. Без скриптов браузера остаётся светлая тема.
 */
export const THEME_SCRIPT =
  "(function(){try{var d=document.documentElement;if(d.dataset.theme==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches)d.classList.add('dark')}catch(e){}})()"
