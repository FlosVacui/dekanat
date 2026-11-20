// Режим жюри (идея №89) и страница «Как это сделано» (идея №90). Данные — основной набор вымышленных аккаунтов.
// Файл написан исполнителем B-ideas-C и при его работе не запускался: сервер и общая тестовая база были заняты другой работой.
// Проверка прокрутки вбок сначала убеждается, что окно нужной ширины (ошибка ИИ 115).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { resetFeedToSeed } from './helpers/db'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')
const staff = MAIN_COHORT.staff

// 20.11.2026 по отзыву капитана: один шаг за раз с кнопкой «Далее», «Как это сделано» в сценарии нет.
const STEPS = [
  { label: 'Сегодня: что ждёт студента', href: '/' },
  { label: 'Успеваемость: долг и допуск', href: '/grades' },
  { label: 'Справка одной фразой и с QR', href: '/requests/new?type=dean_certificate' },
  { label: 'Заявки: что требует ответа', href: '/requests' },
  { label: 'Сотрудник: заявки и вопросы', href: '/staff/requests' },
] as const

let server: RunningServer | null = null

test.beforeAll(async () => {
  await resetFeedToSeed(student1.login)
  server = await startServer({ juryMode: true })
})
test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
})

async function newContext(browser: Browser, width: number): Promise<BrowserContext> {
  const mobile = width < 600
  return browser.newContext({
    viewport: { width, height: 800 },
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

async function expectNoHorizontalScroll(page: Page, width: number, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(clientWidth, `${where}: ширина окна`).toBe(width)
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Сценарий для жюри' })
const chip = (page: Page) => page.getByRole('button', { name: 'Сценарий для жюри', exact: true })

const heading = (page: Page) => panel(page).getByRole('heading', { level: 2 })
const progress = (page: Page) => panel(page).getByTestId('jury-progress')

// ---------- панель ----------

test('360, студент: по умолчанию свёрнута в кнопку; открытая — шаг 1 из 5 с подсказкой и «Далее», панель над нижней панелью вкладок, без прокрутки вбок', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await expect(chip(page)).toBeVisible()
    await expect(panel(page)).toHaveCount(0)
    await expectNoHorizontalScroll(page, 360, '360 «Сегодня» со свёрнутой панелью')
    await chip(page).click()
    await expect(panel(page)).toBeVisible()
    await expect(progress(page)).toContainText('шаг 1 из 5')
    await expect(heading(page)).toHaveText(STEPS[0].label)
    // На первом шаге «Назад» нет, «Далее» ведёт на шаг 2.
    await expect(panel(page).getByRole('link', { name: 'Назад' })).toHaveCount(0)
    const next = panel(page).getByRole('link', { name: 'Далее' })
    await expect(next).toHaveAttribute('href', STEPS[1].href)
    expect((await next.boundingBox())!.height, '«Далее»: зона касания').toBeGreaterThanOrEqual(44)

    // Панель не закрывает нижнюю панель вкладок.
    const tabbar = (await page.locator('[data-tabbar]').boundingBox())!
    const box = (await panel(page).boundingBox())!
    expect(box.y + box.height, 'панель сценария над панелью вкладок').toBeLessThanOrEqual(tabbar.y + 1)
    // Ни паролей, ни полей ввода в панели нет.
    await expect(panel(page).locator('input, textarea')).toHaveCount(0)
    await expectNoHorizontalScroll(page, 360, '360 «Сегодня» с панелью')
  } finally {
    await context.close()
  }
})

test('от 1024 px панель по умолчанию открыта, до 1024 px — свёрнута; выбор в localStorage главнее ширины', async ({ browser }) => {
  for (const [width, opened] of [
    [1280, true],
    [1024, true],
    [1023, false],
    [360, false],
  ] as const) {
    const context = await newContext(browser, width)
    try {
      const page = await context.newPage()
      await signIn(page, student1!.login, student1!.password, '/')
      if (opened) await expect(panel(page), `${width} px: панель открыта`).toBeVisible()
      else await expect(chip(page), `${width} px: кнопка «Сценарий для жюри»`).toBeVisible()
      expect(await page.evaluate(() => window.localStorage.getItem('dekanat-jury-panel')), `${width} px: выбора ещё нет`).toBeNull()
    } finally {
      await context.close()
    }
  }
  // Сохранённый выбор главнее ширины: «closed» на 1280 — кнопка; «open» на 360 — панель.
  for (const [width, saved] of [
    [1280, 'closed'],
    [360, 'open'],
  ] as const) {
    const context = await newContext(browser, width)
    try {
      const page = await context.newPage()
      await page.goto('/login')
      await page.evaluate((value) => window.localStorage.setItem('dekanat-jury-panel', value), saved)
      await signIn(page, student1!.login, student1!.password, '/')
      if (saved === 'open') await expect(panel(page)).toBeVisible()
      else await expect(chip(page)).toBeVisible()
    } finally {
      await context.close()
    }
  }
})

test('«Скрыть» сворачивает панель в кнопку; выбор переживает перезагрузку; кнопка открывает панель обратно', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await expect(chip(page)).toBeVisible()
    expect((await chip(page).boundingBox())!.height, 'зона касания кнопки').toBeGreaterThanOrEqual(44)

    await chip(page).click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByRole('button', { name: 'Скрыть' })).toBeFocused()
    expect(await page.evaluate(() => window.localStorage.getItem('dekanat-jury-panel'))).toBe('open')
    await page.reload()
    await expect(panel(page)).toBeVisible()
    await expectNoHorizontalScroll(page, 360, '360 открытая панель')

    await panel(page).getByRole('button', { name: 'Скрыть' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(chip(page)).toBeVisible()
    await expect(chip(page)).toBeFocused()
    expect(await page.evaluate(() => window.localStorage.getItem('dekanat-jury-panel'))).toBe('closed')
    await page.reload()
    await expect(chip(page)).toBeVisible()
    await expect(panel(page)).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('Escape в панели сворачивает её', async ({ browser }) => {
  const context = await newContext(browser, 1280)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await panel(page).getByRole('link').first().focus()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(chip(page)).toBeFocused()
  } finally {
    await context.close()
  }
})

test('«Далее» и «Назад» ведут по шагам 1–4 под студентом; страница вне сценария предлагает «Начать»', async ({ browser }) => {
  const context = await newContext(browser, 1280)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    for (let i = 1; i <= 3; i += 1) {
      await panel(page).getByRole('link', { name: 'Далее' }).click()
      await expect(page).toHaveURL(`${BASE_URL}${STEPS[i]!.href}`)
      await expect(progress(page)).toContainText(`шаг ${i + 1} из 5`)
      await expect(heading(page)).toHaveText(STEPS[i]!.label)
    }
    // Шаг 4: «Далее» ведёт к сотруднику (шаг 5 проверяет следующий тест), «Назад» — на шаг 3.
    await expect(panel(page).getByRole('link', { name: 'Далее' })).toHaveAttribute('href', STEPS[4].href)
    await panel(page).getByRole('link', { name: 'Назад' }).click()
    await expect(page).toHaveURL(`${BASE_URL}${STEPS[2].href}`)
    await expect(progress(page)).toContainText('шаг 3 из 5')
    // Страница вне сценария: «Начать» ведёт на шаг 1.
    await page.goto('/schedule')
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByRole('link', { name: 'Начать' })).toHaveAttribute('href', '/')
    await expect(panel(page).getByRole('link', { name: 'Назад' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('сотрудник: шаг 5 из 5 на заявках и на вопросах, паролей в панели нет; «Готово» сворачивает панель', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, staff.login, staff.password, '/staff/requests')
    // На 360 px панель по умолчанию свёрнута: открываем кнопкой.
    await chip(page).click()
    await expect(panel(page)).toBeVisible()
    await expect(progress(page)).toContainText('шаг 5 из 5')
    await expect(panel(page)).not.toContainText(/demo-|парол/i)
    await expect(panel(page).locator('input, textarea')).toHaveCount(0)
    // У сотрудника нижней панели вкладок нет: панель сценария прижата к низу окна.
    await expect(page.locator('[data-tabbar]')).toHaveCount(0)
    await expectNoHorizontalScroll(page, 360, '360 сотрудник с панелью')
    await expect(panel(page).getByRole('link', { name: 'Далее' })).toHaveCount(0)
    await panel(page).getByRole('button', { name: 'Готово' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(chip(page)).toBeVisible()
  } finally {
    await context.close()
  }
})

// ---------- «Как это сделано» ----------

test('/process: гость видит страницу без входа — заголовок, пометка про репозиторий, числа на 19.11.2026, ссылки на файлы', async ({ browser }) => {
  for (const width of [360, 1280]) {
    const context = await newContext(browser, width)
    try {
      const page = await context.newPage()
      const response = await page.goto('/process')
      expect(response!.status(), `/process на ${width}`).toBe(200)
      await expect(page).toHaveURL(`${BASE_URL}/process`)
      await expect(page.getByRole('heading', { name: 'Как это сделано', level: 1 })).toBeVisible()
      await expect(page.getByTestId('repo-note')).toContainText('Репозиторий откроется 21.11')
      for (const [id, text] of [
        ['fact-journal', '69 записей'],
        ['fact-errors', '200 записей'],
        ['fact-prompts', '136 записей'],
        ['fact-tools', '66 строк'],
      ] as const) {
        await expect(page.getByTestId(id)).toContainText(text)
        await expect(page.getByTestId(id)).toContainText('19.11.2026')
      }
      await expect(page.getByTestId('fact-journal')).toContainText('43 разные смены')
      // Три примера ошибок ИИ, у каждого «Как поймали».
      await expect(page.getByText('Как поймали.')).toHaveCount(3)
      // Ссылки на файлы: GitHub, новая вкладка, без передачи адреса страницы.
      const files = page.locator('a[href^="https://github.com/FlosVacui/dekanat/blob/main/"]')
      await expect(files).toHaveCount(5)
      for (const path of ['docs/PROCESS.md', 'docs/history/JOURNAL.md', 'docs/evidence/ai-errors.md', 'prompts/INDEX.md', 'docs/evidence/tools.md']) {
        const link = page.locator(`a[href="https://github.com/FlosVacui/dekanat/blob/main/${path}"]`)
        await expect(link).toHaveCount(1)
        await expect(link).toHaveAttribute('target', '_blank')
        await expect(link).toHaveAttribute('rel', /noopener/)
      }
      // Гость: ссылка «Войти». Страница вне сценария: панель предлагает «Начать».
      await expect(page.getByRole('link', { name: 'Войти', exact: true })).toHaveAttribute('href', '/login')
      // До 1024 px панель по умолчанию свёрнута в кнопку.
      if (width < 1024) await chip(page).click()
      await expect(panel(page).getByRole('link', { name: 'Начать' })).toBeVisible()
      await expectNoHorizontalScroll(page, width, `/process на ${width}`)
    } finally {
      await context.close()
    }
  }
})

test('студент на /process: своя оболочка, вкладка не выбрана; ссылка «Как это сделано» внизу страницы студента ведёт сюда', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    const bottomLink = page.getByRole('link', { name: 'Как это сделано', exact: true }).first()
    await expect(bottomLink).toHaveAttribute('href', '/process')
    await page.goto('/process')
    await expect(page.getByRole('heading', { name: 'Как это сделано', level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Разделы' })).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: 'Разделы' }).locator('[aria-current="page"]')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Профиль' })).toBeVisible()
    await expectNoHorizontalScroll(page, 360, '/process студент 360')
  } finally {
    await context.close()
  }
})
