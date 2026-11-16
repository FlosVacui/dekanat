import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Состояние «загрузка» (пакет 3.7, заход 2): граница ожидания `<Suspense>` стоит внутри страницы и только ниже проверки входа.
// Файл `loading.tsx` начинает ответ раньше охраны, и сервер отдаёт 200 вместо 307, 403 и 404 (тесты безопасности П-01, П-05, П-06),
// поэтому в `src/app` его нет и быть не должно. Внутри границы нет `redirect()`, `notFound()`, `forbidden()` и `denyRecord()`:
// после начала потока они дали бы код 200. Тест читает исходные файлы страниц; поведение — в tests/e2e/states.spec.ts.

const APP_DIR = fileURLToPath(new URL('../../src/app/', import.meta.url))

// Пять страниц с границей ожидания. `/`, `/grades` и `/notifications` возвращены к прежнему виду: граница ломала чужие сквозные тесты
// (tests/e2e/notifications.spec.ts), см. отчёт по пакету 3.7, заход 2. Вернут границу — добавить их сюда.
const PAGES = ['schedule/page.tsx', 'requests/page.tsx', 'requests/new/page.tsx', 'profile/page.tsx', 'staff/requests/page.tsx']

/** Страницы одной записи: скелета у них нет, граница ожидания не стоит. */
const RECORD_PAGES = ['grades/[id]/page.tsx', 'requests/[id]/page.tsx', 'staff/requests/[id]/page.tsx']

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

/** Исходный текст без строк-комментариев (`//` и однострочных блоков JSX): слова «redirect()» в пояснениях не считаются вызовами. */
function code(path: string): string {
  return readFileSync(join(APP_DIR, path), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\{\/\*)/.test(line))
    .join('\n')
}

const GUARD = /await\s+require(Student|Staff)Actor\(\)/
const INTERRUPTS = /\b(redirect|notFound|forbidden|denyRecord)\(/

describe('граница ожидания страниц', () => {
  it('файлов loading.tsx в src/app нет', () => {
    const loading = files(APP_DIR).filter((path) => /(^|[\\/])loading\.(tsx|ts|jsx|js)$/.test(path))
    expect(loading).toEqual([])
  })

  it('граница ожидания не стоит в layout.tsx', () => {
    expect(code('layout.tsx')).not.toContain('Suspense')
  })

  for (const page of PAGES) {
    describe(page, () => {
      const source = code(page)
      const guard = GUARD.exec(source)
      const boundary = source.indexOf('<Suspense')

      it('граница ожидания есть, и стоит она ниже вызова проверки входа', () => {
        expect(guard, 'вызова охраны нет').not.toBeNull()
        expect(boundary, '<Suspense не найден').toBeGreaterThan(-1)
        expect(boundary).toBeGreaterThan(guard!.index)
      })

      it('внутри границы нет redirect(), notFound(), forbidden() и denyRecord()', () => {
        const below = source.slice(boundary)
        expect(INTERRUPTS.exec(below)?.[0] ?? null).toBeNull()
      })

      it('со скелетом: карточка загрузки в запасном виде границы', () => {
        const fallback = /fallback=\{([\s\S]*?)<\/(?:StudentFrame|StaffShell)>/.exec(source)?.[1] ?? ''
        expect(fallback, 'в запасном виде нет каркаса').toMatch(/<(StudentFrame|StaffShell)\b/)
        expect(fallback).toContain('<LoadingCard label="Загружаем')
      })
    })
  }

  it('у «Новой заявки» оба redirect и чтение прежней заявки с denyRecord выше границы', () => {
    const source = code('requests/new/page.tsx')
    const boundary = source.indexOf('<Suspense')
    const redirects = [...source.matchAll(/redirect\('\/requests'\)/g)].map((m) => m.index)
    expect(redirects.length, 'redirect(\'/requests\') в файле').toBe(3)
    expect(redirects.every((index) => index < boundary), 'redirect ниже границы').toBe(true)
    expect(source.indexOf('denyRecord(actor)')).toBeGreaterThan(-1)
    expect(source.indexOf('denyRecord(actor)')).toBeLessThan(boundary)
  })

  for (const page of RECORD_PAGES) {
    it(`${page}: страница одной записи без границы ожидания`, () => {
      expect(code(page)).not.toContain('Suspense')
    })
  }
})
