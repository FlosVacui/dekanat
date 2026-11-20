// Помощник по правилам (20.11, идея №21) на экране 360×800: пример-вопрос → ответ со ссылкой на пункт, переход на `/rules#p-…`,
// «Не помогло — спросить деканат» → форма вопроса с подставленным текстом (вопрос не отправляется), форма без скриптов, доступ.
// Ключ модели сервер стенда не получает: переменные пустыми задаются здесь, значения из .env их не перекрывают. Поэтому путь один —
// «Вот что нашлось в положении» (подбор по ключевым словам). Ответ модели проверяют модульные тесты с подменой сети.
// Файл только читает: ничего не подаёт и не создаёт в базе. Данные — основной набор вымышленных аккаунтов.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { ASSISTANT_EXAMPLES, ASSISTANT_QUESTION_MAX } from '../../src/lib/regulations/question'
import { REG_ITEMS } from '../../src/lib/regulations/data'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')
const staff = MAIN_COHORT.staff

const AI_NAMES = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_FOLDER_ID'] as const
const savedEnv = new Map<string, string | undefined>()
let server: RunningServer | null = null

test.beforeAll(async () => {
  for (const name of AI_NAMES) {
    savedEnv.set(name, process.env[name])
    process.env[name] = ''
  }
  server = await startServer()
})
test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
  for (const name of AI_NAMES) {
    const value = savedEnv.get(name)
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

async function newContext(browser: Browser, width: number, javaScriptEnabled = true): Promise<BrowserContext> {
  const mobile = width < 600
  return browser.newContext({
    viewport: { width, height: 800 },
    isMobile: mobile,
    hasTouch: mobile,
    javaScriptEnabled,
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

test.describe.configure({ mode: 'serial' })

for (const width of [360, 1280]) {
  test(`${width}: пример-вопрос → «Вот что нашлось» с пунктом 4.3 → /rules#p-4-3; без прокрутки вбок`, async ({ browser }) => {
    const context = await newContext(browser, width)
    try {
      const page = await context.newPage()
      await signIn(page, student1!.login, student1!.password, '/')
      await page.goto('/assistant')
      await expect(page.getByRole('heading', { name: 'Помощник по правилам', level: 1 })).toBeVisible()
      // Четыре примера, поле вопроса с пределом в 300 знаков.
      const examples = page.locator('[data-example]')
      await expect(examples).toHaveCount(4)
      expect(await examples.allTextContents()).toEqual([...ASSISTANT_EXAMPLES])
      await expect(page.getByLabel('Ваш вопрос')).toHaveAttribute('maxlength', String(ASSISTANT_QUESTION_MAX))
      await expectNoHorizontalScroll(page, width, `${width} помощник, пусто`)

      await examples.nth(1).click()
      await expect(page).toHaveURL(/\/assistant\?q=/)
      const result = page.getByTestId('assistant-result')
      await expect(result).toBeVisible()
      await expect(result).toHaveAttribute('data-kind', 'found')
      await expect(result.getByRole('heading', { name: 'Вот что нашлось в положении' })).toBeVisible()
      await expect(page.getByTestId('assistant-note')).toHaveText('Подбор по ключевым словам')
      await expect(page.getByLabel('Ваш вопрос')).toHaveValue('Как получить справку в военкомат?')
      const link = result.getByRole('link', { name: /^п\. 4\.3\. Справка в военкомат/ })
      await expect(link).toHaveAttribute('href', '/rules#p-4-3')
      expect((await link.boundingBox())!.height, 'зона касания ссылки на пункт').toBeGreaterThanOrEqual(44)
      await expectNoHorizontalScroll(page, width, `${width} помощник, «Вот что нашлось»`)

      await link.click()
      await expect(page).toHaveURL(`${BASE_URL}/rules#p-4-3`)
      await expect(page.getByRole('heading', { name: 'Положение о студентах факультета', level: 1 })).toBeVisible()
      await expect(page.getByTestId('rules-notice')).toHaveText('Учебный пример для прототипа, не настоящий документ вуза')
      const point = page.locator('#p-4-3')
      await expect(point).toBeVisible()
      await expect(point).toContainText('Справка в военкомат')
      await expect(point).toBeInViewport()
      await expectNoHorizontalScroll(page, width, `${width} положение`)
    } finally {
      await context.close()
    }
  })
}

test('360: «Не помогло — спросить деканат» открывает форму вопроса с подставленным текстом; ничего не отправляется', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await page.goto('/assistant')
    await page.getByLabel('Ваш вопрос').fill('Как оформить академический отпуск?')
    await page.getByRole('button', { name: 'Спросить' }).click()
    await expect(page).toHaveURL(/\/assistant\?q=/)
    await expect(page.getByTestId('assistant-result')).toHaveAttribute('data-kind', 'found')
    await expect(page.getByTestId('assistant-result').locator('[data-point="5.2"]')).toBeVisible()

    await page.getByRole('link', { name: 'Не помогло — спросить деканат' }).click()
    await expect(page).toHaveURL(/\/questions\/new\?text=/)
    await expect(page.getByRole('heading', { name: 'Вопрос в деканат', level: 1 })).toBeVisible()
    const text = page.getByLabel('Ваш вопрос')
    await expect(text).toHaveValue(/^Как оформить академический отпуск\?\n\nЯ спросил\(а\) помощника по положению/)
    await expectNoHorizontalScroll(page, 360, '360 вопрос с подставленным текстом')

    // Обратно со страницы вопроса: ссылка на помощника.
    await page.getByTestId('question-assistant-link').click()
    await expect(page).toHaveURL(`${BASE_URL}/assistant`)
  } finally {
    await context.close()
  }
})

test('без скриптов: форма «Спросить» отправляется обычным запросом, вопрос из «Не помогло» попадает в поле', async ({ browser }) => {
  const context = await newContext(browser, 360, false)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await page.goto('/assistant')
    await page.getByLabel('Ваш вопрос').fill('Можно ли пересдать экзамен дважды?')
    await page.getByRole('button', { name: 'Спросить' }).click()
    await expect(page).toHaveURL(/\/assistant\?q=/)
    await expect(page.getByTestId('assistant-result').locator('[data-point="2.4"]')).toBeVisible()
    await page.getByRole('link', { name: 'Не помогло — спросить деканат' }).click()
    await expect(page.getByLabel('Ваш вопрос')).toHaveValue(/^Можно ли пересдать экзамен дважды\?/)
  } finally {
    await context.close()
  }
})

test('вопрос не по теме → «В положении ответа не нашёл»; вопрос из чужого текста выводится как текст', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await page.goto('/assistant?q=' + encodeURIComponent('Какая завтра погода в Сочи?'))
    await expect(page.getByTestId('assistant-result')).toHaveAttribute('data-kind', 'none')
    await expect(page.getByRole('heading', { name: 'В положении ответа не нашёл' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Не помогло — спросить деканат' })).toBeVisible()

    const markup = '<img src=x onerror=alert(1)> справка'
    await page.goto('/assistant?q=' + encodeURIComponent(markup))
    await expect(page.getByLabel('Ваш вопрос')).toHaveValue(markup)
    await expect(page.locator('main img[src="x"]')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('/rules: все пункты положения, якоря; студент и сотрудник видят, гость уходит на вход; /assistant сотруднику — 403', async ({ browser }) => {
  const guest = await newContext(browser, 360)
  try {
    const page = await guest.newPage()
    await page.goto('/rules')
    await expect(page).toHaveURL(`${BASE_URL}/login`)
    await page.goto('/assistant')
    await expect(page).toHaveURL(`${BASE_URL}/login`)
  } finally {
    await guest.close()
  }

  const studentContext = await newContext(browser, 360)
  try {
    const page = await studentContext.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await page.goto('/rules')
    await expect(page.locator('article[data-point]')).toHaveCount(REG_ITEMS.length)
    await expect(page.getByRole('link', { name: 'Помощник по правилам' }).first()).toBeVisible()
    await expectNoHorizontalScroll(page, 360, '360 положение целиком')
  } finally {
    await studentContext.close()
  }

  const staffContext = await newContext(browser, 360)
  try {
    const page = await staffContext.newPage()
    await signIn(page, staff.login, staff.password, '/staff/requests')
    const rules = await page.goto('/rules')
    expect(rules?.status()).toBe(200)
    await expect(page.locator('article[data-point]')).toHaveCount(REG_ITEMS.length)
    await expect(page.getByTestId('rules-notice')).toBeVisible()
    const assistant = await page.goto('/assistant?q=' + encodeURIComponent('справка'))
    expect(assistant?.status()).toBe(403)
  } finally {
    await staffContext.close()
  }
})

test('нижняя панель — по-прежнему четыре вкладки; ссылка «Помощник по правилам» стоит под содержимым и ведёт на /assistant', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await expect(page.locator('[data-tabbar] [data-tab]')).toHaveCount(4)
    const link = page.locator('[data-assistant-link]')
    await expect(link).toHaveAttribute('href', '/assistant')
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await link.click()
    await expect(page).toHaveURL(`${BASE_URL}/assistant`)
    await expect(page.locator('[data-assistant-link]')).toHaveAttribute('aria-current', 'page')
  } finally {
    await context.close()
  }
})
