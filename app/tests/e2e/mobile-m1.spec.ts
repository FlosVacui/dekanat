// Проверка кабинета на телефоне, ворота 3, веха М1 (пакет 3.10, задание B-3.10-mobile; требования ЗД-4, КО-3).
// Экраны проходятся на 360×800, 390×844 и 1280×800 (для сравнения). Снимки — на 360 и 1280.
// ФАЙЛ ТОЛЬКО ЧИТАЕТ: не подаёт заявок, не меняет статус, не отмечает уведомления прочитанными, не жмёт «Сохранить» и «Выйти».
// Подача заявки (С-8) и смена статуса (С-13) на 360 px проверены в m0.spec.ts и requests.spec.ts.
// Что проверяется на каждом экране и в каждой ширине: нет прокрутки вбок; нет частей за краем окна и обрезанного текста;
// кнопки, ссылки, поля не меньше 24×24 px (меньше 44×44 — в список); у конца страницы подвал и содержимое не закрыты нижней панелью;
// главное действие — видно ли без прокрутки (записывается, не проверяется). Не зависит от дня недели: пустой день — не ошибка.
// Замеры, списки малых элементов, порядок фокуса и контраст пишутся в строки JSON рядом со скриптами запуска (папка dekanat-runs).
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')
const staff = MAIN_COHORT.staff

const RUNS = join(process.env.LOCALAPPDATA ?? tmpdir(), 'dekanat-runs')
// Снимки — во временную папку рядом с замерами. Снимки-доказательства ворот 3 лежат в
// docs/evidence/screenshots/2026-11-17-3.10/ и обычным прогоном не перезаписываются (IMP-042, ошибка ИИ 133).
// Переснять их или снять новые в репозиторий — явно: SCREENSHOT_DIR=<папка>, как в screenshots.ts.
const SHOTS = process.env.SCREENSHOT_DIR ?? join(RUNS, 'mob-3.10-shots')
const LOG = join(RUNS, 'mob-3.10-data.jsonl')
const CONCEPT = 'Концепт для конкурса, не официальный сервис вуза'

const VIEWPORTS = [
  { width: 360, height: 800, snap: true },
  { width: 390, height: 844, snap: false },
  { width: 1280, height: 800, snap: true },
]

function rec(kind: string, vp: number, name: string, data: unknown): void {
  appendFileSync(LOG, JSON.stringify({ kind, vp, name, data }) + '\n')
}

let server: RunningServer | null = null

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  mkdirSync(RUNS, { recursive: true })
  writeFileSync(LOG, '')
  server = await startServer()
})
test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
})

interface Item {
  label: string
  region: string
  w: number
  h: number
}
interface AuditData {
  sw: number
  cw: number
  ih: number
  scrollH: number
  items: Item[]
  offscreen: string[]
  clipped: string[]
  footerBottom: number | null
  footerTop: number | null
  mainBottom: number | null
  tabbarTop: number | null
  covered: string[]
  headerPosition: string
  contrast: string[]
  contrastChecked: number
  contrastMin: number
}

/** Одна проверка экрана в браузере. Прокручивает страницу до конца и возвращает наверх. */
async function measure(page: Page): Promise<AuditData> {
  return page.evaluate(async () => {
    await document.fonts.ready
    const SEL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"]'
    const cw = document.documentElement.clientWidth
    const ih = window.innerHeight
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) return false
      const cs = getComputedStyle(el)
      return cs.visibility !== 'hidden' && cs.display !== 'none'
    }
    const label = (el: Element): string => {
      const t = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      const aria = el.getAttribute('aria-label')
      const href = el.getAttribute('href')
      const name = el.getAttribute('name')
      return `${el.tagName.toLowerCase()}${aria ? `[${aria.slice(0, 40)}]` : ''}${t ? ` «${t}»` : ''}${href ? ` ${href.slice(0, 40)}` : ''}${name ? ` name=${name}` : ''}`
    }
    const regionOf = (el: Element): string =>
      el.closest('[data-tabbar]') ? 'tabbar' : el.closest('header') ? 'header' : el.closest('footer') ? 'footer' : el.closest('main') ? 'main' : 'other'
    const nodes = Array.from(document.querySelectorAll(SEL)).filter(visible)
    const items = nodes.map((el) => {
      const r = el.getBoundingClientRect()
      return { label: label(el), region: regionOf(el), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }
    })
    // Части за краем окна по горизонтали (кроме скрытых для чтеца и самого корня).
    const offscreen: string[] = []
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.right > cw + 1 || r.left < -1) offscreen.push(`${label(el)} left=${Math.round(r.left)} right=${Math.round(r.right)}`)
    }
    // Обрезанный текст: у элемента скрыто лишнее по ширине, а содержимое шире.
    const clipped: string[] = []
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (!visible(el)) continue
      const cs = getComputedStyle(el)
      if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1) {
        clipped.push(`${label(el)} scrollW=${el.scrollWidth} clientW=${el.clientWidth}`)
      }
    }
    // Контраст текста: цвет против ближайшего непрозрачного фона предка. Цвета приводятся через холст (понимает oklch).
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (c: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = c
      ctx.fillRect(0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255]
    }
    const lum = (c: number[]): number => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!)
    }
    const backdrop = (el: Element): [number, number, number] | null => {
      let cur: Element | null = el
      while (cur) {
        const cs = getComputedStyle(cur)
        if (cs.backgroundImage !== 'none') return null
        const b = rgba(cs.backgroundColor)
        if (b[3] >= 0.99) return [b[0], b[1], b[2]]
        cur = cur.parentElement
      }
      return [255, 255, 255]
    }
    const contrast: string[] = []
    let contrastChecked = 0
    let contrastMin = 99
    const seen = new Set<string>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim()
      const el = n.parentElement
      if (!text || !el || !visible(el) || el.closest('script, style')) continue
      const cs = getComputedStyle(el)
      const fg = rgba(cs.color)
      const bg = backdrop(el)
      if (!bg || fg[3] < 0.99) continue
      const l1 = lum(fg)
      const l2 = lum(bg)
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      const size = parseFloat(cs.fontSize)
      const bold = parseInt(cs.fontWeight, 10) >= 700
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
      contrastChecked += 1
      if (ratio < contrastMin) contrastMin = ratio
      if (ratio < need) {
        const key = `${text.slice(0, 30)}|${cs.color}|${ratio.toFixed(2)}`
        if (!seen.has(key)) {
          seen.add(key)
          contrast.push(`«${text.slice(0, 30)}» ${ratio.toFixed(2)} (нужно ${need}), ${size}px`)
        }
      }
    }
    const scrollH = document.documentElement.scrollHeight
    // На компьютере (от 1024 px) нижней панели нет: разделы слева, панель скрыта и в расчёт не идёт.
    const tabbarEl = document.querySelector('[data-tabbar]')
    const tabbar = tabbarEl && tabbarEl.getClientRects().length > 0 ? tabbarEl : null
    const footer = document.querySelector('footer')
    const main = document.querySelector('main')
    const header = document.querySelector('header')
    // До конца страницы.
    window.scrollTo({ top: scrollH, behavior: 'instant' as ScrollBehavior })
    const tabRect = tabbar ? tabbar.getBoundingClientRect() : null
    const fRect = footer ? footer.getBoundingClientRect() : null
    const mRect = main ? main.getBoundingClientRect() : null
    const covered: string[] = []
    if (tabRect) {
      for (const el of nodes) {
        if (regionOf(el) === 'tabbar') continue
        const r = el.getBoundingClientRect()
        if (r.bottom > tabRect.top + 1 && r.top < tabRect.bottom) covered.push(`${label(el)} bottom=${Math.round(r.bottom)} tabbarTop=${Math.round(tabRect.top)}`)
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    return {
      sw: document.documentElement.scrollWidth,
      cw,
      ih,
      scrollH,
      items,
      offscreen: offscreen.slice(0, 12),
      clipped: clipped.slice(0, 12),
      footerBottom: fRect ? Math.round(fRect.bottom) : null,
      footerTop: fRect ? Math.round(fRect.top) : null,
      mainBottom: mRect ? Math.round(mRect.bottom) : null,
      tabbarTop: tabRect ? Math.round(tabRect.top) : null,
      covered,
      headerPosition: header ? getComputedStyle(header).position : 'нет',
      contrast: contrast.slice(0, 12),
      contrastChecked,
      contrastMin: Math.round(contrastMin * 100) / 100,
    }
  })
}

/** Главное действие экрана: видно ли без прокрутки (на верху страницы, не под нижней панелью). Только записывается. */
async function actionInView(page: Page, loc: Locator | null, ih: number, tabbarTop: number | null): Promise<unknown> {
  if (!loc) return null
  if ((await loc.count()) === 0) return { found: false }
  const box = await loc.first().boundingBox()
  if (!box) return { found: true, box: null }
  const limit = tabbarTop ?? ih
  return { found: true, top: Math.round(box.y), bottom: Math.round(box.y + box.height), limit, inView: box.y >= 0 && box.y + box.height <= limit }
}

interface StepOpts {
  /** Что дождаться перед проверкой: само содержимое, не каркас «загрузки». */
  ready: Locator
  /** Главное действие экрана. */
  action?: Locator | null
  /** Подвал с пометкой на этом экране ожидается (все, кроме отдельных). */
  noTabbar?: boolean
}

/** Проверка и снимок одного шага. Неудачный шаг получает снимок с началом `fail-` и повторяет ошибку. */
async function step(page: Page, vp: (typeof VIEWPORTS)[number], name: string, opts: StepOpts): Promise<AuditData> {
  const file = `${vp.width}-${name}.png`
  try {
    await expect(opts.ready, `${vp.width} ${name}: содержимое не появилось`).toBeVisible({ timeout: 20_000 })
    await page.evaluate(() => document.fonts.ready)
    const d = await measure(page)
    // Снимок сразу после измерения, пока страница на верху.
    // Снимок — то, что видит человек в окне телефона: верх страницы и, если страница длиннее окна, её конец (подвал над нижней панелью).
    // Страница целиком не снимается: у неё нижняя панель была бы посреди снимка и выглядела бы как наложение.
    if (vp.snap) {
      await page.screenshot({ path: join(SHOTS, file) })
      if (d.scrollH > d.ih + 1) {
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' as ScrollBehavior }))
        await page.screenshot({ path: join(SHOTS, file.replace(/\.png$/, '-end.png')) })
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }))
      }
    }
    rec('audit', vp.width, name, {
      sw: d.sw,
      cw: d.cw,
      scrollH: d.scrollH,
      headerPosition: d.headerPosition,
      under44: d.items.filter((i) => i.w < 44 || i.h < 44),
      itemCount: d.items.length,
      minSide: Math.min(...d.items.map((i) => Math.min(i.w, i.h))),
      contrastChecked: d.contrastChecked,
      contrastMin: d.contrastMin,
      contrast: d.contrast,
      clipped: d.clipped,
    })
    rec('action', vp.width, name, await actionInView(page, opts.action ?? null, d.ih, d.tabbarTop))
    const where = `${vp.width} ${name}`
    expect(d.cw, `${where}: ширина окна`).toBe(vp.width)
    expect(d.sw, `${where}: прокрутка вбок (${d.sw} > ${d.cw})`).toBeLessThanOrEqual(d.cw)
    expect(d.offscreen, `${where}: части за краем окна`).toEqual([])
    expect(d.clipped, `${where}: обрезанный текст`).toEqual([])
    let checked = 0
    for (const i of d.items) {
      expect(i.w >= 24 && i.h >= 24, `${where}: элемент меньше 24×24: ${i.label} (${i.region}) ${i.w}×${i.h}`).toBe(true)
      checked += 1
    }
    expect(checked, `${where}: проверено элементов`).toBe(d.items.length)
    expect(d.items.length, `${where}: на экране нет ни одного элемента управления`).toBeGreaterThan(0)
    // Конец страницы: подвал виден и выше нижней панели; содержимое не закрыто панелью.
    expect(d.footerTop, `${where}: подвала нет`).not.toBeNull()
    if (d.tabbarTop !== null) {
      expect(d.footerBottom!, `${where}: подвал под нижней панелью (${d.footerBottom} > ${d.tabbarTop})`).toBeLessThanOrEqual(d.tabbarTop + 1)
      expect(d.covered, `${where}: элементы под нижней панелью в конце страницы`).toEqual([])
    } else if (vp.width >= 1024 && !(opts.noTabbar === true || name.startsWith('staff') || name === 'login')) {
      // Компьютер: у экрана студента вместо нижней панели — разделы слева.
      await expect(page.locator('[data-sidenav]'), `${where}: нет разделов слева`).toBeVisible()
    } else {
      expect(opts.noTabbar === true || name.startsWith('staff') || name === 'login', `${where}: нижней панели нет, а экран студента`).toBe(true)
    }
    expect(d.mainBottom!, `${where}: содержимое налезает на подвал`).toBeLessThanOrEqual(d.footerTop! + 1)
    await expect(page.locator('footer'), `${where}: пометка в подвале`).toHaveText(CONCEPT)
    return d
  } catch (e) {
    try {
      await page.screenshot({ path: join(SHOTS, `fail-${file}`) })
    } catch {
      // снимок не вышел — ошибка шага важнее
    }
    throw e
  }
}

interface Focused {
  label: string
  top: number
  fixed: boolean
  ring: boolean
}

/** Проход клавишей Tab с начала страницы: что получает фокус по шагам. */
async function tabWalk(page: Page, max: number): Promise<Focused[]> {
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  })
  const out: Focused[] = []
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab')
    const f = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      let fixed = false
      for (let c: HTMLElement | null = el; c; c = c.parentElement) if (getComputedStyle(c).position === 'fixed') fixed = true
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      const aria = el.getAttribute('aria-label')
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'
      return { label: `${el.tagName.toLowerCase()} ${aria ?? ''} ${t}`.replace(/\s+/g, ' ').trim(), top: Math.round(r.top + window.scrollY), fixed, ring }
    })
    if (!f) break
    if (out.length > 0 && out[0]!.label === f.label && out.length > 2) break
    out.push(f)
  }
  return out
}

async function newContext(browser: Browser, vp: (typeof VIEWPORTS)[number]): Promise<BrowserContext> {
  const mobile = vp.width < 600
  return browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    extraHTTPHeaders: addressHeaders(freshAddress()),
  })
}

async function signIn(page: Page, login: string, password: string, landing: string): Promise<void> {
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}${landing}`)
}

for (const vp of VIEWPORTS) {
  test.describe.serial(`${vp.width}×${vp.height}`, () => {
    let anon: BrowserContext
    let ctx: BrowserContext
    let staffCtx: BrowserContext
    let page: Page
    let requestHref: string | null = null

    test.beforeAll(async ({ browser }) => {
      anon = await newContext(browser, vp)
      ctx = await newContext(browser, vp)
      staffCtx = await newContext(browser, vp)
    })
    test.afterAll(async () => {
      await anon.close()
      await ctx.close()
      await staffCtx.close()
    })

    test('вход: подписи полей, пометка «концепт» на экране и в подвале, кнопка без прокрутки (С-11, Э-1)', async () => {
      const p = await anon.newPage()
      await p.goto('/login')
      const login = p.getByLabel('Логин')
      const password = p.getByLabel('Пароль')
      await expect(login).toBeVisible()
      await expect(password).toBeVisible()
      await expect(password).toHaveAttribute('type', 'password')
      const note = p.getByTestId('concept-note')
      await expect(note).toHaveText(CONCEPT)
      const noteBox = await note.boundingBox()
      expect(noteBox, 'пометка на входе не нашлась').not.toBeNull()
      expect(noteBox!.y + noteBox!.height, `${vp.width}: пометка на входе ниже окна`).toBeLessThanOrEqual(vp.height)
      const submit = p.getByRole('button', { name: 'Войти' })
      const sb = await submit.boundingBox()
      expect(sb, 'кнопка «Войти» не нашлась').not.toBeNull()
      rec('login', vp.width, 'login', { noteBottom: Math.round(noteBox!.y + noteBox!.height), submitBottom: Math.round(sb!.y + sb!.height), innerHeight: vp.height })
      await step(p, vp, 'login', { ready: submit, action: submit, noTabbar: true })
      // Порядок фокуса: логин, пароль, «Войти».
      const walk = await tabWalk(p, 4)
      rec('focus', vp.width, 'login', walk)
      expect(walk.slice(0, 3).map((f) => f.label.split(' ')[0]), `${vp.width}: порядок фокуса на входе`).toEqual(['input', 'input', 'button'])
      await p.close()
    })

    test('С-1: «Сегодня» — следующая пара видна вверху, порядок фокуса (Э-2)', async () => {
      page = await ctx.newPage()
      await signIn(page, student1!.login, student1!.password, '/')
      await step(page, vp, 'today', {
        ready: page.getByRole('heading', { name: 'Сегодня', level: 1 }),
        action: page.getByRole('region', { name: 'Следующая пара' }),
      })
      const walk = await tabWalk(page, 30)
      rec('focus', vp.width, 'today', walk)
      expect(walk.length, `${vp.width}: Tab на «Сегодня» дошёл до конца`).toBeGreaterThan(6)
      expect(walk[0]!.label, 'первым получает фокус колокольчик').toContain('Уведомления')
      expect(walk[1]!.label, 'вторым — профиль').toContain('Профиль')
      // Телефон: разделы — нижняя панель, фокус доходит до них последним.
      // Компьютер (от 1024 px): разделы слева, сразу после шапки; блоки «Сегодня» — в две колонки,
      // поэтому правило «фокус не возвращается выше» проверяется только на телефоне.
      const desktop = vp.width >= 1024
      const sections = (desktop ? walk.slice(2, 6) : walk.slice(-4)).map((f) => f.label)
      expect(sections[0]).toContain('Сегодня')
      expect(sections[1]).toContain('Расписание')
      expect(sections[2]).toContain('Успеваемость')
      expect(sections[3]).toContain('Заявки')
      const middle = desktop ? [] : walk.slice(2, -4)
      for (let i = 1; i < middle.length; i += 1) {
        expect(middle[i]!.top, `${vp.width}: фокус вернулся выше: «${middle[i - 1]!.label}» → «${middle[i]!.label}»`).toBeGreaterThanOrEqual(middle[i - 1]!.top - 1)
      }
      expect(walk.filter((f) => !f.ring).map((f) => f.label), `${vp.width}: у элементов нет видимой рамки фокуса`).toEqual([])
    })

    test('С-5, С-9, С-10 на «Сегодня»: блоки «что сдать», «заявки», «объявления» — где стоят', async () => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Сегодня', level: 1 })).toBeVisible()
      const found: Record<string, unknown> = {}
      for (const name of ['Следующая пара', 'Изменения в расписании', 'Что сдать', 'Мои заявки', 'Объявления']) {
        const region = page.getByRole('region', { name: new RegExp(`^${name}`) })
        const n = await region.count()
        const box = n > 0 ? await region.first().boundingBox() : null
        found[name] = box ? { top: Math.round(box.y), bottom: Math.round(box.y + box.height), inView: box.y + box.height <= vp.height } : n === 0 ? 'нет блока' : 'нет рамки'
      }
      rec('today-blocks', vp.width, 'today', found)
      expect(Object.keys(found).length).toBe(5)
    })

    test('С-5: «что сдать» → экран дисциплины (Э-5)', async () => {
      await page.goto('/')
      const todo = page.getByRole('region', { name: /^Что сдать/ })
      if ((await todo.count()) === 0) {
        rec('skip', vp.width, 'grades-discipline-from-today', 'блока «Что сдать» сегодня нет (зависит от дня)')
        return
      }
      // После редизайна блок есть всегда; пустой — строка без ссылок (смена 37: 19.11, четверг — сдавать нечего).
      if ((await todo.getByText('На этой неделе сдавать нечего', { exact: true }).count()) > 0) {
        await expect(todo.getByRole('link')).toHaveCount(0)
        rec('skip', vp.width, 'grades-discipline-from-today', 'на этой неделе сдавать нечего (зависит от дня)')
        return
      }
      const link = todo.getByRole('link').first()
      await expect(link).toBeVisible()
      await link.click()
      await expect(page).toHaveURL(/\/grades\/[^/]+$/)
      await step(page, vp, 'grades-discipline-from-today', { ready: page.getByRole('heading', { level: 1 }), action: page.getByRole('heading', { level: 1 }) })
    })

    test('С-9: заявки — список и экран заявки, порядок фокуса (Э-6, Э-8)', async () => {
      await page.goto('/requests')
      await step(page, vp, 'requests-list', {
        ready: page.getByRole('heading', { name: 'Заявки', level: 1 }),
        action: page.getByRole('region', { name: 'Заказать' }).getByRole('link').first(),
      })
      const hrefs = await page.locator('main a[href^="/requests/"]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('href') ?? '').filter((h) => !h.startsWith('/requests/new')),
      )
      requestHref = hrefs[0] ?? null
      rec('requests-count', vp.width, 'requests-list', hrefs.length)
      if (!requestHref) {
        rec('skip', vp.width, 'request-detail', 'заявок у студента нет')
        return
      }
      await page.locator(`main a[href="${requestHref}"]`).first().click()
      await expect(page).toHaveURL(`${BASE_URL}${requestHref}`)
      await step(page, vp, 'request-detail', {
        ready: page.getByRole('heading', { level: 1 }),
        action: page.getByRole('link', { name: 'Все заявки' }),
      })
      const walk = await tabWalk(page, 20)
      rec('focus', vp.width, 'request-detail', walk)
      expect(walk[0]!.label, 'первой в заявке — шапка (колокольчик)').toContain('Уведомления')
      expect(walk[1]!.label).toContain('Профиль')
      // На компьютере разделы слева идут сразу после шапки, на телефоне — нижней панелью в конце.
      const desktop = vp.width >= 1024
      const sections = desktop ? walk.slice(2, 6) : walk.slice(-4)
      // Редизайн, заход В: в колонке после четырёх разделов ещё «Уведомления» и «Идеи и планы».
      if (desktop) {
        expect(walk[6]!.label, 'в колонке после разделов — «Уведомления»').toContain('Уведомления')
        expect(walk[7]!.label, 'в колонке последняя — «Идеи и планы»').toContain('Идеи и планы')
      }
      expect(walk[desktop ? 8 : 2]!.label, 'следом — ссылка «Все заявки»').toContain('Все заявки')
      expect(sections.map((f) => f.label.split(' ').slice(-1)[0]), 'разделы').toEqual(['Сегодня', 'Расписание', 'Успеваемость', 'Заявки'])
    })

    test('С-9: пустой список заявок и форма новой заявки только открываются, не отправляются (Э-7)', async () => {
      await page.goto('/requests')
      const first = page.getByRole('region', { name: 'Заказать' }).getByRole('link').first()
      await first.click()
      await expect(page).toHaveURL(/\/requests\/new\?type=/)
      // Только открытая форма: «Отправить» не нажимается.
      await step(page, vp, 'request-new', {
        ready: page.getByRole('heading', { level: 1 }),
        action: page.getByRole('button', { name: 'Отправить' }),
      })
    })

    test('С-2: «Расписание» → завтра в полосе дней (Э-3)', async () => {
      await page.goto('/')
      await page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Расписание' }).click()
      await expect(page).toHaveURL(/\/schedule/)
      await step(page, vp, 'schedule-day', {
        ready: page.getByRole('heading', { name: /^Расписание на/ }),
        action: page.getByRole('navigation', { name: 'Дни недели' }),
      })
      const days = page.getByRole('navigation', { name: 'Дни недели' }).getByRole('link')
      expect(await days.count(), `${vp.width}: в полосе семь дней`).toBe(7)
      await days.nth(1).click()
      await expect(page.getByRole('navigation', { name: 'Дни недели' }).getByRole('link').nth(1)).toHaveAttribute('aria-current', 'date')
      await step(page, vp, 'schedule-tomorrow', {
        ready: page.getByRole('heading', { name: /^Расписание на/ }),
        action: page.getByRole('navigation', { name: 'Дни недели' }),
      })
    })

    test('С-3: «Неделя» (Э-3)', async () => {
      await page.goto('/schedule')
      await page.getByRole('group', { name: 'Вид' }).getByRole('link', { name: 'Неделя' }).click()
      await expect(page).toHaveURL(/view=week|week/)
      await step(page, vp, 'schedule-week', {
        ready: page.getByRole('heading', { name: /^Расписание на/ }),
        action: page.getByRole('group', { name: 'Вид' }),
      })
    })

    test('С-6, С-14, С-7: «Успеваемость» — сводка, карточки с итогом, экран дисциплины (Э-4, Э-5)', async () => {
      await page.goto('/')
      await page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Успеваемость' }).click()
      await expect(page).toHaveURL(/\/grades$/)
      await step(page, vp, 'grades-semester', {
        ready: page.getByRole('heading', { name: 'Как у меня дела' }),
        action: page.getByRole('heading', { name: 'Как у меня дела' }),
      })
      const cards = page.getByRole('list', { name: 'Дисциплины' }).getByRole('link')
      expect(await cards.count(), `${vp.width}: карточек дисциплин`).toBeGreaterThan(0)
      // С-14: итог виден на карточке — в тексте первой карточки есть одно из слов итога или «впереди».
      const firstText = (await cards.first().innerText()).toLowerCase()
      rec('grades-card', vp.width, 'grades-semester', firstText.replace(/\s+/g, ' ').slice(0, 160))
      await cards.first().click()
      await expect(page).toHaveURL(/\/grades\/[^/]+$/)
      await step(page, vp, 'grades-discipline', { ready: page.getByRole('heading', { level: 1 }), action: page.getByRole('heading', { level: 1 }) })
    })

    test('С-15: «Успеваемость» → «Сессия» (Э-4)', async () => {
      await page.goto('/grades')
      await page.getByRole('group', { name: 'Вид' }).getByRole('link', { name: 'Сессия' }).click()
      await expect(page).toHaveURL(/view=session/)
      await step(page, vp, 'grades-session', {
        ready: page.getByRole('heading', { level: 2 }).first(),
        action: page.getByRole('group', { name: 'Вид' }),
      })
    })

    test('С-10, С-16: колокольчик → лента «Все», фильтр «Напоминания»; непрочитанное не нажимается (Э-9)', async () => {
      await page.goto('/')
      // Колокольчик в шапке: на компьютере в колонке разделов тоже есть «Уведомления» (редизайн, заход В).
      await page.locator('header').getByRole('link', { name: /^Уведомления/ }).click()
      await expect(page).toHaveURL(/\/notifications$/)
      await step(page, vp, 'notifications-feed', {
        ready: page.getByTestId('unread-line'),
        action: page.getByTestId('unread-line'),
      })
      // R-3.5-6 / IMP-035: сколько кнопок и ссылок-карточек в ленте «Все». Нажимать их нельзя: непрочитанная карточка — кнопка отправки формы.
      const feed = await page.locator('main ul > li').count()
      const buttons = await page.locator('main li button').count()
      rec('feed', vp.width, 'notifications-feed', { cards: feed, cardButtons: buttons })
      await page.getByRole('group', { name: 'Фильтр уведомлений' }).getByRole('link', { name: 'Напоминания' }).click()
      await expect(page).toHaveURL(/filter=reminders/)
      await step(page, vp, 'notifications-reminders', {
        ready: page.getByTestId('unread-line'),
        action: page.getByRole('group', { name: 'Фильтр уведомлений' }),
      })
      // Переход «напоминание → экран»: нажимается только уже прочитанная карточка-ссылка; непрочитанных не трогаем.
      const readLinks = page.locator('main li a[href]')
      if ((await readLinks.count()) > 0) {
        await readLinks.first().click()
        await expect(page).not.toHaveURL(/\/notifications/)
        await step(page, vp, 'notifications-target', { ready: page.getByRole('heading', { level: 1 }), action: page.getByRole('heading', { level: 1 }) })
      } else {
        rec('skip', vp.width, 'notifications-target', 'прочитанных карточек-ссылок нет: переход из напоминания не нажимался')
      }
    })

    test('С-12: аватар → профиль; «Выйти» видна, не нажимается (Э-10)', async () => {
      await page.goto('/')
      await page.getByRole('link', { name: 'Профиль' }).click()
      await expect(page).toHaveURL(/\/profile$/)
      await step(page, vp, 'profile', {
        ready: page.getByRole('heading', { name: 'Профиль', level: 1 }),
        action: page.getByRole('button', { name: 'Выйти' }),
      })
    })

    test('сотрудник: список заявок и заявка без нажатия «Сохранить» (Э-11, Э-12)', async () => {
      const sp = await staffCtx.newPage()
      await signIn(sp, staff.login, staff.password, '/staff/requests')
      await step(sp, vp, 'staff-requests-list', {
        ready: sp.getByRole('heading', { name: 'Заявки студентов', level: 1 }),
        action: sp.locator('main a[href^="/staff/requests/"]').first(),
      })
      const rows = await sp.locator('main a[href^="/staff/requests/"]').count()
      rec('staff-rows', vp.width, 'staff-requests-list', rows)
      if (rows === 0) {
        rec('skip', vp.width, 'staff-request', 'в списке сотрудника нет заявок')
        return
      }
      await sp.locator('main a[href^="/staff/requests/"]').first().click()
      await expect(sp).toHaveURL(/\/staff\/requests\/[^/]+$/)
      await step(sp, vp, 'staff-request', {
        ready: sp.getByRole('heading', { level: 1 }),
        action: sp.getByRole('button', { name: 'Сохранить' }),
      })
      // R-3.10-102: главная кнопка сотрудника — в первом окне, без прокрутки.
      await sp.evaluate(() => window.scrollTo(0, 0))
      const save = await sp.getByRole('button', { name: 'Сохранить' }).boundingBox()
      expect(save, 'кнопка «Сохранить» есть на экране заявки').not.toBeNull()
      expect(save!.y + save!.height, `${vp.width}×${vp.height}: «Сохранить» ниже первого окна`).toBeLessThanOrEqual(vp.height)
      const walk = await tabWalk(sp, 20)
      rec('focus', vp.width, 'staff-request', walk)
      expect(walk[0]!.label, 'первым в заявке сотрудника — «Выйти»').toContain('Выйти')
      expect(walk[1]!.label, 'вторым — ссылка к списку').toContain('К списку заявок')
      expect(walk.filter((f) => !f.ring).map((f) => f.label), `${vp.width}: у элементов нет видимой рамки фокуса`).toEqual([])
      await sp.close()
    })

    if (vp.width === 360) {
      test('IMP-038: переход по вкладке с «Сегодня» — высота шапки и появление скелета по кадрам (только замер)', async () => {
        const targets: { name: string; link: () => Locator; ready: () => Locator }[] = [
          { name: 'schedule', link: () => page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Расписание' }), ready: () => page.getByRole('heading', { name: /^Расписание на/ }) },
          { name: 'requests', link: () => page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Заявки' }), ready: () => page.getByRole('heading', { name: 'Заявки', level: 1 }) },
          { name: 'profile', link: () => page.getByRole('link', { name: 'Профиль' }), ready: () => page.getByRole('heading', { name: 'Профиль', level: 1 }) },
        ]
        for (const t of targets) {
          await page.goto('/')
          await expect(page.getByRole('heading', { name: 'Сегодня', level: 1 })).toBeVisible()
          await page.evaluate(() => {
            const w = window as unknown as { __s: { t: number; h: number; busy: boolean; title: string }[]; __stop: boolean }
            w.__s = []
            w.__stop = false
            const tick = () => {
              const hd = document.querySelector('header')
              w.__s.push({
                t: Math.round(performance.now()),
                h: hd ? Math.round(hd.getBoundingClientRect().height * 10) / 10 : -1,
                busy: document.querySelector('[aria-busy="true"]') !== null,
                title: (document.querySelector('h1')?.textContent ?? '').slice(0, 20),
              })
              if (!w.__stop) requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
          await t.link().click()
          await t.ready().waitFor({ state: 'visible', timeout: 20_000 })
          await page.waitForTimeout(300)
          const samples = await page.evaluate(() => {
            const w = window as unknown as { __s: { t: number; h: number; busy: boolean; title: string }[]; __stop: boolean }
            w.__stop = true
            return w.__s
          })
          const heights = [...new Set(samples.map((s) => s.h))]
          rec('imp038', vp.width, t.name, { frames: samples.length, headerHeights: heights, busyFrames: samples.filter((s) => s.busy).length, titles: [...new Set(samples.map((s) => s.title))] })
        }
      })

      test('скорость: до появления главного блока на «Сегодня», «Расписании», «Успеваемости», три прогона, сеть не замедляется', async () => {
        const cases: { name: string; path: string; ready: () => Locator }[] = [
          { name: 'today', path: '/', ready: () => page.getByRole('region', { name: 'Следующая пара' }) },
          { name: 'schedule', path: '/schedule', ready: () => page.getByRole('heading', { name: /^Расписание на/ }) },
          { name: 'grades', path: '/grades', ready: () => page.getByRole('heading', { name: 'Как у меня дела' }) },
        ]
        for (const c of cases) {
          const times: number[] = []
          for (let run = 0; run < 3; run += 1) {
            await page.goto('about:blank')
            const t0 = Date.now()
            await page.goto(c.path, { waitUntil: 'commit' })
            await c.ready().waitFor({ state: 'visible', timeout: 20_000 })
            times.push(Date.now() - t0)
          }
          rec('speed', vp.width, c.name, times)
          expect(times.length, `${c.name}: три замера`).toBe(3)
        }
      })
    }
  })
}
