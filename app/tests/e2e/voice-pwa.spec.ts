// Голосовой ввод и установка на телефон (20.11, идеи №17 и №81), экран 360×800.
// Манифест и иконки отдаются без входа; на страницах есть <link rel="manifest">; кнопка «Сказать» появляется только там,
// где есть распознавание речи (в тесте — заглушка через addInitScript), и вставляет в поле текст заглушки.
// Файл ничего не создаёт в базе. Данные — основной набор вымышленных аккаунтов.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе должен быть студент')

test.describe.configure({ mode: 'serial' })

let server: RunningServer | null = null

test.beforeAll(async () => {
  server = await startServer()
})

test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
})

const PHRASE_URL = '/requests/new?type=dean_certificate'

/** Заглушка распознавания: `start()` через 50 мс отдаёт заданный текст, `stop()` и конец записи вызывают `onend`. */
function stubScript(mode: 'ok' | 'denied'): string {
  return `(() => {
    class Stub {
      constructor() { this.lang = ''; this.onresult = null; this.onerror = null; this.onend = null; this.timer = null }
      start() {
        window.__speechLang = this.lang
        this.timer = setTimeout(() => {
          if (${JSON.stringify(mode)} === 'denied') {
            this.onerror && this.onerror({ error: 'not-allowed' })
          } else {
            const r = [{ transcript: 'справка в налоговую' }]
            r.isFinal = true
            this.onresult && this.onresult({ resultIndex: 0, results: [r] })
          }
          if (${JSON.stringify(mode)} === 'denied') this.finish()
        }, 50)
      }
      stop() { this.finish() }
      abort() { this.finish() }
      finish() { clearTimeout(this.timer); const f = this.onend; this.onend = null; f && setTimeout(f, 0) }
    }
    // Настоящий Chrome уже отдаёт стандартный SpeechRecognition, а он главнее webkit-имени: подменяются оба.
    Object.defineProperty(window, 'SpeechRecognition', { value: Stub, configurable: true })
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: Stub, configurable: true })
  })()`
}

/** Скрипт, который убирает распознавание речи, даже если оно есть в настоящем Chrome. */
const NO_SPEECH_SCRIPT = `(() => {
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true })
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true })
})()`

async function signedIn(browser: Browser, init: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: addressHeaders(),
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  })
  await context.addInitScript(init)
  const page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, student1!.login, student1!.password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}/`)
  return { context, page }
}

test('манифест: JSON с именем, цветами и иконками; иконки отвечают 200 и image/png нужного размера', async ({ request }) => {
  const res = await request.get(`${BASE_URL}/manifest.webmanifest`, { headers: addressHeaders() })
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toMatch(/json/)
  const manifest = (await res.json()) as {
    name: string
    short_name: string
    start_url: string
    display: string
    theme_color: string
    background_color: string
    icons: { src: string; sizes: string; type: string; purpose?: string }[]
  }
  expect(manifest.name).toBe('Деканат в кармане')
  expect(manifest.short_name).toBe('Деканат')
  expect(manifest.start_url).toBe('/')
  expect(manifest.display).toBe('standalone')
  expect(manifest.theme_color).toBe('#194CA6')
  expect(manifest.background_color).toMatch(/^#[0-9A-Fa-f]{6}$/)
  const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`)
  expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']))
  for (const icon of manifest.icons) {
    const png = await request.get(`${BASE_URL}${icon.src}`, { headers: addressHeaders() })
    expect(png.status(), icon.src).toBe(200)
    expect(png.headers()['content-type'], icon.src).toBe('image/png')
    const body = await png.body()
    // Подпись PNG и размер из заголовка IHDR (байты 16–23).
    expect(body.subarray(1, 4).toString('latin1'), icon.src).toBe('PNG')
    const [w, h] = [body.readUInt32BE(16), body.readUInt32BE(20)]
    expect(`${w}x${h}`, icon.src).toBe(icon.sizes)
  }
  const apple = await request.get(`${BASE_URL}/apple-touch-icon.png`, { headers: addressHeaders() })
  expect(apple.status()).toBe(200)
  expect(apple.headers()['content-type']).toBe('image/png')
})

test('на странице входа и на главной есть ссылка на манифест, значок для iPhone и цвет темы', async ({ browser }) => {
  const { context, page } = await signedIn(browser, NO_SPEECH_SCRIPT)
  try {
    for (const path of ['/login', '/']) {
      await page.goto(path)
      await expect(page.locator('link[rel="manifest"]'), path).toHaveAttribute('href', '/manifest.webmanifest')
      await expect(page.locator('link[rel="apple-touch-icon"]'), path).toHaveAttribute('href', /apple-touch-icon\.png/)
      await expect(page.locator('meta[name="theme-color"]'), path).toHaveAttribute('content', '#194CA6')
    }
  } finally {
    await context.close()
  }
})

test('без распознавания речи в браузере кнопки «Сказать» нет, поле работает как обычно', async ({ browser }) => {
  const { context, page } = await signedIn(browser, NO_SPEECH_SCRIPT)
  try {
    await page.goto(PHRASE_URL)
    const field = page.getByLabel('Опишите, что нужно')
    await expect(field).toBeVisible()
    await field.fill('справка')
    await expect(page.getByTestId('voice-button')).toHaveCount(0)
    await expect(field).toHaveValue('справка')
  } finally {
    await context.close()
  }
})

test('с распознаванием речи: кнопка есть, язык ru-RU, текст заглушки попадает в поле, повторное нажатие останавливает', async ({ browser }) => {
  const { context, page } = await signedIn(browser, stubScript('ok'))
  try {
    await page.goto(PHRASE_URL)
    const field = page.getByLabel('Опишите, что нужно')
    const button = page.getByTestId('voice-button')
    await expect(button).toBeVisible()
    await expect(button).toHaveText('Сказать')
    const box = await button.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    // Поле уже содержит текст: сказанное дописывается после него.
    await field.fill('Нужна')
    await button.click()
    await expect(field).toHaveValue('Нужна справка в налоговую')
    expect(await page.evaluate(() => (window as unknown as { __speechLang: string }).__speechLang)).toBe('ru-RU')
    // Запись ещё идёт (заглушка конец не присылает): кнопка «Слушаю…», повторное нажатие — стоп.
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(button).toContainText('Слушаю…')
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await expect(button).toHaveText('Сказать')
    // Ширина экрана 360 без прокрутки вбок.
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
    expect(clientWidth).toBe(360)
    // Продиктованный текст уходит в адрес обычной формой «Заполнить» (работает без скриптов).
    await page.getByRole('button', { name: 'Заполнить' }).click()
    await expect(page).toHaveURL(/[?&]q=/)
    await expect(page.getByLabel('Опишите, что нужно')).toHaveValue('Нужна справка в налоговую')
  } finally {
    await context.close()
  }
})

test('нет разрешения на микрофон: короткая строка об этом, кнопка снова «Сказать»', async ({ browser }) => {
  const { context, page } = await signedIn(browser, stubScript('denied'))
  try {
    await page.goto(PHRASE_URL)
    const button = page.getByTestId('voice-button')
    await expect(button).toBeVisible()
    await button.click()
    await expect(page.getByTestId('voice-status')).toContainText('Нет доступа к микрофону')
    await expect(button).toHaveText('Сказать')
    await expect(page.getByLabel('Опишите, что нужно')).toHaveValue('')
  } finally {
    await context.close()
  }
})

test('помощник: кнопка «Сказать» вставляет текст заглушки в поле вопроса, без распознавания её нет', async ({ browser }) => {
  const withSpeech = await signedIn(browser, stubScript('ok'))
  try {
    await withSpeech.page.goto('/assistant')
    await withSpeech.page.getByTestId('voice-button').click()
    await expect(withSpeech.page.getByLabel('Ваш вопрос')).toHaveValue('справка в налоговую')
  } finally {
    await withSpeech.context.close()
  }
  const without = await signedIn(browser, NO_SPEECH_SCRIPT)
  try {
    await without.page.goto('/assistant')
    await expect(without.page.getByLabel('Ваш вопрос')).toBeVisible()
    await expect(without.page.getByTestId('voice-button')).toHaveCount(0)
  } finally {
    await without.context.close()
  }
})
