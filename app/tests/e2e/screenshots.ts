// Снимки экранов на 360 и на 1280 пикселей. Запуск: npm run screenshots.
// Пакет 2.4: каждый экран М0. Пакет 3.1: экран входа с отказами «неверная пара» и «подождите» (login-invalid, login-wait).
// Снимки кладутся в docs/evidence/screenshots/<дата прогона>-3.1/; прежние папки (например, 2026-11-11-2.4) не трогаются.
// Имя говорит, что на снимке: 360-schedule-day.png. Неудачный снимок не удаляется: его имя начинается с fail-.
// Данные — вымышленный основной набор (ТР-5, ТР-11). Адрес посетителя шлётся заголовком, как это делает прокси.
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAIN_COHORT } from '../../db/seed-data'
import { todayIn } from '../../src/lib/dates'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer } from './helpers/server'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const date = process.env.SCREENSHOT_DATE ?? todayIn('Europe/Moscow')
const outDir = process.env.SCREENSHOT_DIR ?? join(REPO_ROOT, 'docs', 'evidence', 'screenshots', `${date}-3.1`)

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')
const { login: studentLogin, password: studentPassword } = student1

type Width = 360 | 1280
const WIDTHS: Width[] = [360, 1280]

async function newContext(browser: Browser, width: Width): Promise<BrowserContext> {
  // У каждого контекста свой адрес посетителя: лимиты входа не меняются, а снимки не мешают друг другу.
  const extraHTTPHeaders = addressHeaders()
  return browser.newContext(
    width === 360
      ? { baseURL: BASE_URL, extraHTTPHeaders, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' }
      : { baseURL: BASE_URL, extraHTTPHeaders, viewport: { width: 1280, height: 800 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' },
  )
}

let failed = 0

/**
 * Снимок всей страницы. Окно на время снимка растягивается до высоты страницы: так нижняя панель вкладок остаётся
 * внизу, а не повисает посреди снимка, как при fullPage.
 */
async function captureWholePage(page: Page, path: string): Promise<void> {
  const original = page.viewportSize()
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  if (original && height > original.height) await page.setViewportSize({ width: original.width, height })
  try {
    await page.screenshot({ path })
  } finally {
    if (original) await page.setViewportSize(original)
  }
}

async function shoot(page: Page, width: Width, name: string, path: string): Promise<void> {
  try {
    const response = await page.goto(path)
    if (!response || response.status() >= 400) throw new Error(`ответ ${response?.status()} на ${path}`)
    await page.waitForLoadState('networkidle')
    // Горизонтальной прокрутки быть не должно: снимок с ней — неудачный.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) throw new Error(`горизонтальная прокрутка на ${overflow} px`)
    await captureWholePage(page, join(outDir, `${width}-${name}.png`))
    console.log(`ok   ${width}-${name}.png`)
  } catch (error) {
    failed += 1
    await captureWholePage(page, join(outDir, `fail-${width}-${name}.png`)).catch(() => undefined)
    console.error(`FAIL ${width}-${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Снимок страницы в том виде, как она сейчас стоит в браузере (без перехода): экран входа после отказа. */
async function shootCurrent(page: Page, width: Width, name: string, expectedText: RegExp): Promise<void> {
  try {
    const alert = page.locator('form').getByRole('alert')
    await alert.waitFor({ state: 'visible' })
    const text = (await alert.textContent()) ?? ''
    if (!expectedText.test(text)) throw new Error(`на экране «${text}», ждали ${expectedText}`)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) throw new Error(`горизонтальная прокрутка на ${overflow} px`)
    await captureWholePage(page, join(outDir, `${width}-${name}.png`))
    console.log(`ok   ${width}-${name}.png`)
  } catch (error) {
    failed += 1
    await captureWholePage(page, join(outDir, `fail-${width}-${name}.png`)).catch(() => undefined)
    console.error(`FAIL ${width}-${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function submitWrongLogin(page: Page, password: string): Promise<void> {
  await fillLogin(page, studentLogin, password)
  const answered = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/login')
  await page.getByRole('button', { name: 'Войти' }).click()
  await answered
  await page.getByRole('button', { name: 'Войти' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => !(document.querySelector('button[type=submit]') as HTMLButtonElement | null)?.disabled)
}

async function loginVia(page: Page, login: string, password: string): Promise<void> {
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForURL((url) => url.pathname !== '/login')
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const server = await startServer()
  const browser = await chromium.launch()
  try {
    for (const width of WIDTHS) {
      // Экран входа — без сессии.
      const anon = await newContext(browser, width)
      const anonPage = await anon.newPage()
      await anonPage.goto(`${BASE_URL}/login`)
      await shoot(anonPage, width, 'login', `${BASE_URL}/login`)
      await anon.close()

      // Экран входа с отказами (пакет 3.1): «неверная пара», затем пять неверных подряд и «подождите».
      const refused = await newContext(browser, width)
      const refusedPage = await refused.newPage()
      await refusedPage.goto(`${BASE_URL}/login`)
      await submitWrongLogin(refusedPage, 'неверный-пароль-1')
      await shootCurrent(refusedPage, width, 'login-invalid', /^Неверный логин или пароль$/)
      for (let attempt = 2; attempt <= 6; attempt += 1) await submitWrongLogin(refusedPage, `неверный-пароль-${attempt}`)
      await shootCurrent(refusedPage, width, 'login-wait', /^Слишком много попыток\. Повторите через \d+ с$/)
      await refused.close()

      // Студент.
      const studentContext = await newContext(browser, width)
      const page = await studentContext.newPage()
      await loginVia(page, studentLogin, studentPassword)
      await page.goto(`${BASE_URL}/requests`)
      const firstRequest = await page.locator('a[href^="/requests/"]:not([href^="/requests/new"])').first().getAttribute('href')
      await shoot(page, width, 'today', `${BASE_URL}/`)
      await shoot(page, width, 'schedule-day', `${BASE_URL}/schedule`)
      await shoot(page, width, 'grades-semester', `${BASE_URL}/grades`)
      await shoot(page, width, 'grades-session', `${BASE_URL}/grades?view=session`)
      await shoot(page, width, 'requests', `${BASE_URL}/requests`)
      await shoot(page, width, 'request-new', `${BASE_URL}/requests/new?type=dean_certificate`)
      if (firstRequest) await shoot(page, width, 'request-detail', `${BASE_URL}${firstRequest}`)
      else {
        failed += 1
        console.error('FAIL request-detail: у студента нет заявок')
      }
      await shoot(page, width, 'notifications', `${BASE_URL}/notifications`)
      await shoot(page, width, 'profile', `${BASE_URL}/profile`)
      await studentContext.close()

      // Сотрудник.
      const staffContext = await newContext(browser, width)
      const staffPage = await staffContext.newPage()
      await loginVia(staffPage, MAIN_COHORT.staff.login, MAIN_COHORT.staff.password)
      await shoot(staffPage, width, 'staff-requests', `${BASE_URL}/staff/requests`)
      const links = await staffPage.locator('a[href^="/staff/requests/"]').all()
      let target: string | null = null
      for (const link of links) {
        // Для снимка нужна заявка в статусе «Подана»: у неё видны кнопки перехода.
        if ((await link.innerText()).includes('Статус: Подана')) {
          target = await link.getAttribute('href')
          break
        }
      }
      target ??= (await links[0]?.getAttribute('href')) ?? null
      if (target) await shoot(staffPage, width, 'staff-request-detail', `${BASE_URL}${target}`)
      await staffContext.close()
    }
  } finally {
    await browser.close()
    await stopServer(server)
  }
  console.log(failed === 0 ? `Готово: ${outDir}` : `Неудачных снимков: ${failed}. Они сохранены с префиксом fail-.`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
