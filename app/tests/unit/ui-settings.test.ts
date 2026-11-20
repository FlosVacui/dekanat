// 20.11, блиц: настройки отображения в куке `ui`. Чистые функции.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UI,
  TEXT_SIZES,
  TEXT_SIZE_CSS,
  THEMES,
  THEME_SCRIPT,
  htmlClassName,
  parseUi,
  serializeUi,
} from '../../src/app/profile/ui-settings'

describe('кука ui', () => {
  it('все девять сочетаний записываются и читаются обратно', () => {
    for (const theme of THEMES) {
      for (const size of TEXT_SIZES) expect(parseUi(serializeUi({ theme, size }))).toEqual({ theme, size })
    }
  })

  it('нет куки, мусор, лишние части и длинная строка — значения по умолчанию целиком', () => {
    for (const bad of [undefined, null, '', 'dark', 'dark.', '.large', 'dark.large.extra', 'blue.large', 'dark.huge', 'DARK.large', 'x'.repeat(100)]) {
      expect(parseUi(bad)).toEqual(DEFAULT_UI)
    }
  })

  it('по умолчанию — как до настроек: светлая тема и обычный размер, класса на <html> нет', () => {
    expect(DEFAULT_UI).toEqual({ theme: 'light', size: 'normal' })
    expect(htmlClassName(DEFAULT_UI)).toBe('')
  })
})

describe('класс на <html>', () => {
  it('тёмная тема — dark; размер — ui-large и ui-xlarge; «как в системе» и светлая класса темы не ставят', () => {
    expect(htmlClassName({ theme: 'dark', size: 'normal' })).toBe('dark')
    expect(htmlClassName({ theme: 'dark', size: 'xlarge' })).toBe('dark ui-xlarge')
    expect(htmlClassName({ theme: 'light', size: 'large' })).toBe('ui-large')
    expect(htmlClassName({ theme: 'system', size: 'normal' })).toBe('')
  })
})

describe('размер текста', () => {
  it('правила есть для двух крупных размеров и меняют все шесть переменных --fs-*', () => {
    for (const cls of ['html.ui-large{', 'html.ui-xlarge{']) {
      const rule = TEXT_SIZE_CSS.split('\n').find((line) => line.startsWith(cls))
      expect(rule, cls).toBeDefined()
      expect([...rule!.matchAll(/--fs-(xs|sm|md|lg|xl|num):/g)].map((m) => m[1])).toEqual(['xs', 'sm', 'md', 'lg', 'xl', 'num'])
    }
  })

  it('основной текст растёт на 12,5 % и на 25 %; мелкий (--fs-xs) остаётся 12 px: подписи нижних вкладок на 360 px иначе не помещаются', () => {
    expect(TEXT_SIZE_CSS).toContain('html.ui-large{--fs-xs:12px;--fs-sm:15.75px;--fs-md:18px;')
    expect(TEXT_SIZE_CSS).toContain('html.ui-xlarge{--fs-xs:12px;--fs-sm:17.5px;--fs-md:20px;')
  })

  it('скрипт темы ставит dark только при выбранном «как в системе»', () => {
    expect(THEME_SCRIPT).toContain("dataset.theme==='system'")
    expect(THEME_SCRIPT).toContain('prefers-color-scheme: dark')
  })
})
