// Снимки экранов заявок на 360 и на 1280 пикселей (пакет 3.4): Э-6 со списком, Э-7 для справки из деканата и справки об оплате,
// Э-8 в пяти видах — подана, в работе, готова, выдана, отклонена; Э-7 «Подать снова» с прежним значением.
// Запуск: npm run db:seed && npm run build && node ./node_modules/tsx/dist/cli.mjs tests/e2e/screenshots-requests.ts
// Способ — как в screenshots.ts: окно растягивается до высоты страницы, неудачный снимок сохраняется с префиксом fail-.
// Заявки в нужных статусах создаются тем же путём, что в жизни: студент подаёт, сотрудник ставит статус. Данные вымышленные.
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer } from './helpers/server'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const outDir = process.env.SCREENSHOT_DIR ?? join(REPO_ROOT, 'docs', 'evidence', 'screenshots', '2026-11-13-3.4')

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')
const staff = MAIN_COHORT.staff

type Width = 360 | 1280
const WIDTHS: Width[] = [360, 1280]

async function newContext(browser: Browser, width: Width): Promise<BrowserContext> {
  const extraHTTPHeaders = addressHeaders()
  return browser.newContext(
    width === 360
      ? { baseURL: BASE_URL, extraHTTPHeaders, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' }
      : { baseURL: BASE_URL, extraHTTPHeaders, viewport: { width: 1280, height: 800 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' },
  )
}

async function loginVia(page: Page, login: string, password: string): Promise<void> {
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForURL((url) => url.pathname !== '/login')
}

let failed = 0

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

/** Студент подаёт заявку через форму; возвращает номер. */
async function submit(page: Page, type: string, field?: { label: string; value: string }): Promise<string> {
  await page.goto(`/requests/new?type=${type}`)
  if (field) await page.getByLabel(field.label).selectOption(field.value)
  await page.getByRole('button', { name: 'Отправить' }).click()
  await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/)
  return new URL(page.url()).pathname.split('/').pop() ?? ''
}

/** Сотрудник ставит статус кнопкой, при отклонении выбирает причину. Кнопка нажимается, пока форма не оживёт. */
async function staffSets(browser: Browser, requestId: string, status: string, reasonLabel?: string): Promise<void> {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await loginVia(page, staff.login, staff.password)
    await page.goto(`/staff/requests/${requestId}`)
    const pick = page.getByRole('button', { name: status, exact: true })
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await pick.click()
      if ((await pick.getAttribute('aria-pressed')) === 'true') break
      await page.waitForTimeout(500)
    }
    if (reasonLabel) await page.getByLabel(reasonLabel).check()
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByTestId('staff-request-status').filter({ hasText: status }).waitFor()
  } finally {
    await context.close()
  }
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const server = await startServer()
  const browser = await chromium.launch()
  try {
    // Заявки в пяти статусах.
    const setup = await newContext(browser, 360)
    const page = await setup.newPage()
    await loginVia(page, student1!.login, student1!.password)
    const ids = {
      submitted: await submit(page, 'dean_certificate', {
        label: 'Куда справка',
        value: 'study_period',
      }),
      in_progress: await submit(page, 'tuition_certificate', { label: 'Год оплаты', value: '2025' }),
      ready: await submit(page, 'dean_certificate', { label: 'Куда справка', value: 'tax_office' }),
      issued: await submit(page, 'dean_certificate', { label: 'Куда справка', value: 'library' }),
      rejected: await submit(page, 'dean_certificate', { label: 'Куда справка', value: 'embassy' }),
    }
    await setup.close()
    await staffSets(browser, ids.in_progress, 'В работе')
    await staffSets(browser, ids.ready, 'В работе')
    await staffSets(browser, ids.ready, 'Готова')
    await staffSets(browser, ids.issued, 'В работе')
    await staffSets(browser, ids.issued, 'Готова')
    await staffSets(browser, ids.issued, 'Выдана')
    await staffSets(browser, ids.rejected, 'Отклонена', 'Другая причина, уточните в деканате')

    for (const width of WIDTHS) {
      const context = await newContext(browser, width)
      const student = await context.newPage()
      await loginVia(student, student1!.login, student1!.password)
      await shoot(student, width, 'requests-list', '/requests')
      await shoot(student, width, 'request-new-dean', '/requests/new?type=dean_certificate')
      await shoot(student, width, 'request-new-tuition', '/requests/new?type=tuition_certificate')
      await shoot(student, width, 'request-submitted', `/requests/${ids.submitted}`)
      await shoot(student, width, 'request-in-progress', `/requests/${ids.in_progress}`)
      await shoot(student, width, 'request-ready', `/requests/${ids.ready}`)
      await shoot(student, width, 'request-issued', `/requests/${ids.issued}`)
      await shoot(student, width, 'request-rejected', `/requests/${ids.rejected}`)
      await shoot(student, width, 'request-new-again', `/requests/new?type=dean_certificate&from=${ids.rejected}`)
      await context.close()
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
