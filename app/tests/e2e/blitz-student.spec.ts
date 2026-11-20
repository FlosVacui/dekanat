// Блиц 20.11, студент: фото профиля, студенческий билет с QR, настройки отображения, расписание в календарь. Экран 360×800.
// Данные — основной набор вымышленных аккаунтов. Файл создаёт фото студентов и удаляет их сам; остального не трогает.
// Снимки 360 и 1280 пишутся в SCREENSHOT_DIR (нет — во временную папку dekanat-runs).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
const staff = MAIN_COHORT.staff
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')

const SHOT_DIR = process.env.SCREENSHOT_DIR ?? join(process.env.LOCALAPPDATA ?? fileURLToPath(new URL('../../', import.meta.url)), 'dekanat-runs', 'blitz-student-shots')

test.describe.configure({ mode: 'serial' })

let server: RunningServer | null = null

/** Настоящий PNG 40×30 из одного цвета: собирается здесь, чтобы браузер мог его разобрать и уменьшить. */
function makePng(width = 40, height = 30): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const out = Buffer.alloc(8 + data.length + 4)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), 8 + data.length)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8 бит, RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x66)])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const PNG = makePng()

function ownerUrl(): string {
  if (!process.env.DATABASE_OWNER_URL) process.loadEnvFile(process.env.ENV_FILE || fileURLToPath(new URL('../../../.env', import.meta.url)))
  const url = process.env.DATABASE_OWNER_URL
  if (!url) throw new Error('Нет DATABASE_OWNER_URL')
  return url
}

async function withOwner<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ownerUrl() })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function dropAvatars(): Promise<void> {
  await withOwner((c) => c.query('delete from user_avatars where user_id in (select id from users where login = any($1))', [[student1!.login, student2!.login]]))
}

test.beforeAll(async () => {
  await dropAvatars()
  server = await startServer()
})

test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
  await dropAvatars()
})

async function expectNoHorizontalScroll(page: Page, where: string, width = 360): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth, `${where}: ширина окна`).toBe(width)
}

async function shot(page: Page, name: string, width: 360 | 1280): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: join(SHOT_DIR, `${name}-${width}.png`), fullPage: true })
}

async function signIn(browser: Browser, login: string, password: string, home: string, width: 360 | 1280 = 360, javaScriptEnabled = true): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(
    width === 360
      ? { baseURL: BASE_URL, extraHTTPHeaders: addressHeaders(), viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow', javaScriptEnabled }
      : { baseURL: BASE_URL, extraHTTPHeaders: addressHeaders(), viewport: { width: 1280, height: 800 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow', javaScriptEnabled },
  )
  const page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}${home}`)
  return { context, page }
}

const asStudent = (browser: Browser, who: typeof student1, width: 360 | 1280 = 360, js = true) => signIn(browser, who.login, who.password, '/', width, js)

test('студенческий билет: ФИО, курс, группа, QR; проверка по ссылке открыта без входа и показывает сокращённое ФИО', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    await page.goto('/profile')
    const ticket = page.getByTestId('student-ticket')
    await expect(ticket).toBeVisible()
    await expect(page.getByTestId('ticket-name')).toHaveText(student1.fullName)
    await expect(ticket).toContainText(`${student1.course}`)
    await expect(ticket).toContainText(student1.groupName)
    await expect(page.getByTestId('ticket-qr')).toBeVisible()
    await expect(page.getByTestId('ticket-no-qr')).toHaveCount(0)
    // Данные студента показаны один раз: отдельного блока данных нет, ФИО только в билете.
    await expect(page.getByText(student1.fullName)).toHaveCount(1)
    // Фото меняется по своей русской кнопке; кнопки «Choose File» нет. «Сохранить фото» появляется, когда файл выбран.
    await expect(page.getByText('Загрузить фото', { exact: true })).toBeVisible()
    await expect(page.getByText('Choose File')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Сохранить фото' })).toBeHidden()
    // Вместо длинной ссылки — кнопка-ссылка «Открыть проверку» с зоной касания не меньше 44 px.
    const verifyLink = page.getByRole('link', { name: 'Открыть проверку' })
    await expect(verifyLink).toBeVisible()
    await expect(verifyLink).toHaveAttribute('href', await page.getByTestId('ticket-verify-link').getAttribute('href') ?? '')
    expect((await verifyLink.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(page.getByText(/\/verify\/student\//)).toHaveCount(0)
    await expectNoHorizontalScroll(page, 'профиль')
    await shot(page, 'profile', 360)

    const href = await page.getByTestId('ticket-verify-link').getAttribute('href')
    expect(href).toMatch(/\/verify\/student\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

    // Проверка — в новом окне без входа.
    const guest = await browser.newContext({ viewport: { width: 360, height: 800 } })
    try {
      const check = await guest.newPage()
      const response = await check.goto(href!)
      expect(response?.status()).toBe(200)
      await expect(check.getByTestId('verify-result')).toHaveText('Студент обучается')
      const text = (await check.locator('main').innerText()).replace(/\s+/g, ' ')
      const [surname] = student1.fullName.split(' ')
      expect(text).toContain(surname)
      // Полное ФИО, логин и фото на странице проверки не показываются.
      expect(text).not.toContain(student1.fullName)
      expect(text).not.toContain(student1.login)
      await expectNoHorizontalScroll(check, 'проверка билета')
      await shot(check, 'verify-student', 360)

      // Изменённый код — 404 и «не найден».
      const forged = href!.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))
      const bad = await check.goto(forged)
      expect(bad?.status()).toBe(404)
      await expect(check.getByTestId('verify-result')).toHaveText('Студенческий билет не найден')
    } finally {
      await guest.close()
    }
  } finally {
    await context.close()
  }
})

test('фото профиля: загрузка, отдача только владельцу, чужому и гостю — отказ, удаление возвращает инициалы', async ({ browser }) => {
  const one = await asStudent(browser, student1)
  const two = await asStudent(browser, student2)
  try {
    const { page } = one
    await page.goto('/profile')
    await expect(page.getByTestId('profile-initials')).toBeVisible()
    expect((await page.request.get('/profile/avatar')).status()).toBe(404)

    // Не картинка под видом PNG — отказ с понятным текстом, ничего не сохранено.
    await page.getByLabel('Загрузить фото').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('это не картинка') })
    await page.getByRole('button', { name: 'Сохранить фото' }).click()
    await expect(page.getByTestId('profile-notice')).toHaveText('Подходят только JPEG, PNG и WebP.')
    await expect(page.getByTestId('profile-initials')).toBeVisible()

    // Верная картинка: браузер уменьшает её до JPEG 256×256 и отправляет.
    await page.getByLabel('Загрузить фото').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
    await page.getByRole('button', { name: 'Сохранить фото' }).click()
    await expect(page.getByTestId('profile-notice')).toHaveText('Фото сохранено.')
    await expect(page.getByTestId('profile-avatar')).toBeVisible()
    // Фото есть: подпись над полем файла меняется на «Сменить фото», рядом — «Удалить фото».
    await expect(page.getByText('Сменить фото', { exact: true })).toBeVisible()
    await expectNoHorizontalScroll(page, 'профиль с фото')
    await shot(page, 'profile-avatar', 360)

    const mine = await page.request.get('/profile/avatar')
    expect(mine.status()).toBe(200)
    expect(mine.headers()['content-type']).toBe('image/jpeg')
    expect(mine.headers()['cache-control']).toBe('private, no-store')
    expect(mine.headers()['x-content-type-options']).toBe('nosniff')
    const bytes = await mine.body()
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect(bytes.length).toBeLessThanOrEqual(150 * 1024)

    // Другой студент своего фото не имеет и чужого не получает; гость — 401.
    expect((await two.page.request.get('/profile/avatar')).status()).toBe(404)
    const guest = await browser.newContext({ baseURL: BASE_URL })
    try {
      expect((await guest.request.get('/profile/avatar')).status()).toBe(401)
    } finally {
      await guest.close()
    }

    await page.getByRole('button', { name: 'Удалить фото' }).click()
    await expect(page.getByTestId('profile-notice')).toHaveText('Фото удалено.')
    await expect(page.getByTestId('profile-initials')).toBeVisible()
    expect((await page.request.get('/profile/avatar')).status()).toBe(404)
  } finally {
    await one.context.close()
    await two.context.close()
  }
})

test('сотрудник не получает ни фото, ни расписания студента', async ({ browser }) => {
  const { context, page } = await signIn(browser, staff.login, staff.password, '/staff/requests')
  try {
    expect((await page.request.get('/profile/avatar')).status()).toBe(403)
    expect((await page.request.get('/schedule/calendar.ics')).status()).toBe(403)
  } finally {
    await context.close()
  }
})

test('настройки отображения: тёмная тема и очень крупный текст сохраняются, держатся на экранах и не ломают 360 px', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    await page.goto('/profile')
    const html = page.locator('html')
    await expect(html).not.toHaveClass(/dark|ui-/)
    await expect(page.getByLabel('Светлая')).toBeChecked()
    await expect(page.getByLabel('Обычный')).toBeChecked()

    await page.getByLabel('Тёмная').check()
    await page.getByLabel('Очень крупный').check()
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByTestId('profile-notice')).toHaveText('Настройки сохранены.')
    await expect(html).toHaveClass(/\bdark\b/)
    await expect(html).toHaveClass(/\bui-xlarge\b/)
    const cookie = (await context.cookies()).find((c) => c.name === 'ui')
    expect(cookie).toMatchObject({ value: 'dark.xlarge', httpOnly: false, sameSite: 'Lax' })
    await expect(page.getByLabel('Тёмная')).toBeChecked()

    for (const path of ['/profile', '/', '/schedule', '/grades', '/requests', '/notifications']) {
      await page.goto(path)
      await expect(html, path).toHaveClass(/\bdark\b/)
      await expectNoHorizontalScroll(page, `${path} в тёмной теме, очень крупный текст`)
    }
    await page.goto('/profile')
    await shot(page, 'profile-dark-xlarge', 360)
    // Подписи нижних вкладок помещаются в свои ячейки.
    const overflow = await page.locator('[data-tab-label]').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent))
    expect(overflow).toEqual([])

    // Мусор в куке — значения по умолчанию, страница не падает.
    await context.addCookies([{ name: 'ui', value: 'blue.huge', url: BASE_URL }])
    await page.goto('/profile')
    await expect(html).not.toHaveClass(/dark|ui-/)

    // Возврат к светлой теме и обычному размеру.
    await page.getByLabel('Светлая').check()
    await page.getByLabel('Обычный').check()
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(html).not.toHaveClass(/dark|ui-/)
  } finally {
    await context.close()
  }
})

test('«Как в системе» следует настройке браузера: тёмная система — тёмная тема без мигания', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL, extraHTTPHeaders: addressHeaders(), colorScheme: 'dark', viewport: { width: 360, height: 800 }, locale: 'ru-RU' })
  try {
    const page = await context.newPage()
    await page.goto('/login')
    // Без выбора — как раньше: светлая, хотя система тёмная.
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await fillLogin(page, student1.login, student1.password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/`)
    await page.goto('/profile')
    await page.getByLabel('Как в системе').check()
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByTestId('profile-notice')).toHaveText('Настройки сохранены.')
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    // Возврат к умолчанию.
    await page.getByLabel('Светлая').check()
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByTestId('profile-notice')).toHaveText('Настройки сохранены.')
  } finally {
    await context.close()
  }
})

test('расписание в календарь: ссылка на экране, файл .ics с парами группы; гость — 401', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    await page.goto('/schedule')
    const link = page.getByTestId('calendar-link')
    await expect(link).toHaveText('Добавить в календарь')
    await expect(link).toHaveAttribute('href', '/schedule/calendar.ics')
    // Страница дорисовывается потоком: ждём видимую ссылку, иначе boundingBox успевает вернуть null.
    await expect(link).toBeVisible()
    const box = await link.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await expectNoHorizontalScroll(page, 'расписание со ссылкой')
    await shot(page, 'schedule-calendar-link', 360)

    const response = await page.request.get('/schedule/calendar.ics')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('text/calendar; charset=utf-8')
    expect(response.headers()['content-disposition']).toMatch(/^attachment;/)
    expect(response.headers()['cache-control']).toBe('private, no-store')
    const body = await response.text()
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(body.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(body.match(/BEGIN:VEVENT/g)?.length ?? 0).toBeGreaterThan(0)
    expect(body).toContain(student1.markers.schedule)
    // Свой набор: пары другой группы набора в файле не появляются.
    expect(student2.markers.schedule).not.toBe(student1.markers.schedule)
    expect(body).not.toContain(student2.markers.schedule)

    const guest = await browser.newContext({ baseURL: BASE_URL })
    try {
      expect((await guest.request.get('/schedule/calendar.ics', { maxRedirects: 0 })).status()).toBe(401)
    } finally {
      await guest.close()
    }
  } finally {
    await context.close()
  }
})

test('экраны на 1280 px: профиль с билетом и настройками', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1, 1280)
  try {
    await page.goto('/profile')
    await expect(page.getByTestId('student-ticket')).toBeVisible()
    await expectNoHorizontalScroll(page, 'профиль 1280', 1280)
    await shot(page, 'profile', 1280)
  } finally {
    await context.close()
  }
})
