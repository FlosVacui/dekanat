// 20.11, блиц: кабинет сотрудника — меню, сводка, студенты, объявления. Сквозной файл: НЕ запускался автором (общая база одна),
// сквозные прогоны делает оркестратор. Вымышленные аккаунты основного набора; объявление теста удаляется в конце.
// Снимки 360 и 1280 пишутся в SCREENSHOT_DIR (нет — во временную папку dekanat-runs).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1] = MAIN_COHORT.students
const staff = MAIN_COHORT.staff
if (!student1) throw new Error('В основном наборе должен быть студент')

const SHOT_DIR = process.env.SCREENSHOT_DIR ?? join(process.env.LOCALAPPDATA ?? fileURLToPath(new URL('../../', import.meta.url)), 'dekanat-runs', 'blitz-staff-shots')
const TITLE = `Блиц-объявление ${Date.now()}`
const BODY = 'Пересдача по эконометрике переносится на четверг.\nАудитория прежняя.'

test.describe.configure({ mode: 'serial' })

let server: RunningServer | null = null

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

test.beforeAll(async () => {
  server = await startServer()
})

test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
  await withOwner((c) => c.query('delete from announcements where title like $1', ['Блиц-объявление %']))
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

async function signIn(
  browser: Browser,
  login: string,
  password: string,
  home: string,
  width: 360 | 1280 = 360,
  javaScriptEnabled = true,
): Promise<{ context: BrowserContext; page: Page }> {
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

const asStaff = (browser: Browser, width: 360 | 1280 = 360, js = true) => signIn(browser, staff.login, staff.password, '/staff/requests', width, js)

for (const width of [360, 1280] as const) {
  test(`меню и сводка на ${width} px: пять пунктов, активный по адресу, числа ведут в списки, без прокрутки вбок`, async ({ browser }) => {
    const { context, page } = await asStaff(browser, width)
    try {
      const menu = page.getByRole('navigation', { name: 'Меню сотрудника' })
      await expect(menu.getByRole('link')).toHaveText(['Сводка', 'Заявки', 'Вопросы', 'Студенты', 'Объявления'])
      // Вход, как прежде, на список заявок: активна «Заявки».
      await expect(menu.getByRole('link', { name: 'Заявки' })).toHaveAttribute('aria-current', 'page')
      // Нижней панели вкладок студента у сотрудника нет.
      await expect(page.getByRole('navigation', { name: 'Разделы' })).toHaveCount(0)

      await menu.getByRole('link', { name: 'Вопросы' }).click()
      await expect(page).toHaveURL(`${BASE_URL}/staff/requests?view=questions`)
      await expect(menu.getByRole('link', { name: 'Вопросы' })).toHaveAttribute('aria-current', 'page')
      await expect(menu.getByRole('link', { name: 'Заявки' })).not.toHaveAttribute('aria-current', 'page')

      await menu.getByRole('link', { name: 'Сводка' }).click()
      await expect(page).toHaveURL(`${BASE_URL}/staff`)
      await expect(page.getByRole('heading', { name: 'Сводка', level: 1 })).toBeVisible()
      await expect(menu.getByRole('link', { name: 'Сводка' })).toHaveAttribute('aria-current', 'page')
      for (const id of ['summary-submitted', 'summary-in_progress', 'summary-ready', 'summary-issued', 'summary-rejected', 'summary-overdue', 'summary-unanswered', 'summary-announcements']) {
        await expect(page.getByTestId(id)).toHaveText(/^\d+$/)
      }
      await expect(page.getByRole('link', { name: /^Подана/ })).toHaveAttribute('href', '/staff/requests?status=submitted')
      await expect(page.getByRole('link', { name: /^Вопросы без ответа/ })).toHaveAttribute('href', '/staff/requests?view=questions')
      await expect(page.getByRole('link', { name: /^Объявления за неделю/ })).toHaveAttribute('href', '/staff/announcements')
      // Шлифовка: «Последние заявки» (до 5) и «Вопросы без ответа» (до 5), каждая строка — ссылка на запись.
      await expect(page.getByRole('heading', { name: 'Последние заявки', level: 2 })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Вопросы без ответа', level: 2 })).toBeVisible()
      const recent = page.getByTestId('summary-recent-requests').getByRole('link')
      expect(await recent.count(), 'последних заявок').toBeGreaterThan(0)
      expect(await recent.count(), 'последних заявок не больше пяти').toBeLessThanOrEqual(5)
      for (const href of await recent.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) expect(href).toMatch(/^\/staff\/requests\/[0-9a-f-]{36}$/)
      const unanswered = page.getByTestId('summary-unanswered-questions').getByRole('link')
      expect(await unanswered.count(), 'вопросов без ответа не больше пяти').toBeLessThanOrEqual(5)
      for (const href of await unanswered.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) expect(href).toMatch(/^\/staff\/questions\/[0-9a-f-]{36}$/)
      // От 1024 px — две колонки: «Заявки по статусам» слева от «Что требует внимания», «Последние заявки» слева от «Вопросов без ответа».
      const box = async (name: string) => (await page.getByRole('heading', { name, level: 2 }).boundingBox())!
      const [byStatus, attention, lastRequests, lastQuestions] = [await box('Заявки по статусам'), await box('Что требует внимания'), await box('Последние заявки'), await box('Вопросы без ответа')]
      if (width >= 1024) {
        expect(attention.x, 'внимание правее статусов').toBeGreaterThan(byStatus.x + 100)
        expect(lastQuestions.x, 'вопросы правее заявок').toBeGreaterThan(lastRequests.x + 100)
        expect(lastRequests.y, 'ряд ниже первого').toBeGreaterThan(byStatus.y)
      } else {
        expect(lastQuestions.y, 'на телефоне столбцом').toBeGreaterThan(lastRequests.y)
        expect(attention.y, 'на телефоне столбцом').toBeGreaterThan(byStatus.y)
      }
      await expectNoHorizontalScroll(page, `сводка ${width}`, width)
      await shot(page, 'staff-summary', width)

      // Число ведёт в отфильтрованный список.
      await page.getByRole('link', { name: /^Подана/ }).click()
      await expect(page).toHaveURL(`${BASE_URL}/staff/requests?status=submitted`)
    } finally {
      await context.close()
    }
  })
}

test('студенты: список набора, поиск по ФИО и фильтр по группе — параметры адреса, карточка с успеваемостью, чужой номер — 404', async ({ browser }) => {
  const { context, page } = await asStaff(browser, 360)
  try {
    await page.goto('/staff/students')
    await expect(page.getByRole('heading', { name: 'Студенты', level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Меню сотрудника' }).getByRole('link', { name: 'Студенты' })).toHaveAttribute('aria-current', 'page')
    await expectNoHorizontalScroll(page, 'студенты 360')
    await shot(page, 'staff-students', 360)

    await page.getByLabel('Поиск по ФИО').fill('белозёров')
    await page.getByRole('button', { name: 'Показать' }).click()
    await expect(page).toHaveURL(/\/staff\/students\?q=/)
    const rows = page.locator('main a[href^="/staff/students/"]')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(student1.fullName)

    // Группа другого студента основного набора: белозёрова в списке нет.
    await page.goto('/staff/students')
    const groupSelect = page.getByLabel('Группа')
    const options = await groupSelect.locator('option').allTextContents()
    expect(options.length).toBeGreaterThan(2)
    await groupSelect.selectOption({ label: options[1]! })
    await page.getByRole('button', { name: 'Показать' }).click()
    await expect(page).toHaveURL(/group=/)
    expect(await rows.count()).toBeGreaterThan(0)

    // Карточка.
    await page.goto('/staff/students?q=%D0%B1%D0%B5%D0%BB%D0%BE%D0%B7')
    await rows.first().click()
    await expect(page).toHaveURL(/\/staff\/students\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: student1.fullName, level: 1 })).toBeVisible()
    await expect(page.getByTestId('student-debts')).toContainText('Эконометрика')
    await expect(page.getByTestId('student-admission')).toContainText('Корпоративные финансы')
    await expect(page.getByTestId('student-admission')).toContainText('не хватает')
    await expectNoHorizontalScroll(page, 'карточка студента 360')
    await shot(page, 'staff-student-card', 360)
    await expect(page.getByRole('link', { name: 'К списку студентов' })).toHaveAttribute('href', '/staff/students')

    // Несуществующий номер и мусор — «нет такого студента», код 404.
    for (const path of ['/staff/students/00000000-0000-4000-8000-000000000000', '/staff/students/не-номер']) {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(404)
      await expect(page.getByRole('heading', { name: 'Нет такого студента', level: 1 })).toBeVisible()
    }
  } finally {
    await context.close()
  }
})

test('студенты: поиск и фильтр работают без скриптов', async ({ browser }) => {
  const { context, page } = await asStaff(browser, 360, false)
  try {
    await page.goto('/staff/students')
    await page.getByLabel('Поиск по ФИО').fill('белозёров')
    await page.getByRole('button', { name: 'Показать' }).click()
    await expect(page).toHaveURL(/\/staff\/students\?q=/)
    await expect(page.locator('main a[href^="/staff/students/"]')).toHaveCount(1)
  } finally {
    await context.close()
  }
})

test('объявление группе: сотрудник отправляет, оно в списке «за 30 дней», студент группы видит его в ленте; пустое не уходит', async ({ browser }) => {
  const { context, page } = await asStaff(browser, 360)
  try {
    await page.goto('/staff/announcements')
    await expect(page.getByRole('heading', { name: 'Объявления', level: 1 })).toBeVisible()
    await expectNoHorizontalScroll(page, 'объявления 360')

    // Без заголовка форма не уходит (required); с заголовком из пробелов слой вернёт «проверьте поля».
    await page.getByLabel('Заголовок').fill('   ')
    await page.getByLabel('Текст').fill(BODY)
    await page.getByRole('button', { name: 'Отправить объявление' }).click()
    await expect(page.getByTestId('announcement-result')).toContainText('Проверьте поля')

    // Адресат — группа студента.
    await page.getByLabel('Кому').selectOption({ label: student1.groupName })
    await page.getByLabel('Заголовок').fill(TITLE)
    await page.getByLabel('Текст').fill(BODY)
    await shot(page, 'staff-announcements-form', 360)
    await page.getByRole('button', { name: 'Отправить объявление' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/staff/announcements?result=ok`)
    await expect(page.getByTestId('announcement-result')).toContainText('Объявление отправлено')
    const item = page.getByTestId('announcement-list').locator('li', { hasText: TITLE })
    await expect(item).toContainText(`Группа ${student1.groupName}`)
    await expect(item).toContainText('Аудитория прежняя.')
    await expectNoHorizontalScroll(page, 'объявления после отправки 360')
    await shot(page, 'staff-announcements', 360)
  } finally {
    await context.close()
  }

  // Студент видит объявление в ленте.
  const { context: studentContext, page: studentPage } = await signIn(browser, student1.login, student1.password, '/')
  try {
    await studentPage.goto('/notifications')
    await expect(studentPage.getByText(TITLE)).toBeVisible()
  } finally {
    await studentContext.close()
  }
})

test('объявление: подделанный адресат не проходит, сообщение «Выберите группу или поток»', async ({ browser }) => {
  const { context, page } = await asStaff(browser, 1280)
  try {
    await page.goto('/staff/announcements')
    await page.getByLabel('Заголовок').fill('Блиц-объявление чужое')
    await page.getByLabel('Текст').fill('x')
    // Значение списка подменяется в браузере, как это сделал бы посетитель.
    await page.getByLabel('Кому').evaluate((el) => {
      const select = el as HTMLSelectElement
      const option = document.createElement('option')
      option.value = 'group:00000000-0000-4000-8000-000000000000'
      option.textContent = 'подделка'
      select.append(option)
      select.value = option.value
    })
    await page.getByRole('button', { name: 'Отправить объявление' }).click()
    await expect(page.getByTestId('announcement-result')).toContainText('Выберите группу или поток')
    await expect(page.getByTestId('announcement-list').locator('li', { hasText: 'Блиц-объявление чужое' })).toHaveCount(0)
    await shot(page, 'staff-announcements', 1280)
  } finally {
    await context.close()
  }
})

test('студент не открывает экраны сотрудника: 403', async ({ browser }) => {
  const { context, page } = await signIn(browser, student1.login, student1.password, '/')
  try {
    for (const path of ['/staff', '/staff/students', '/staff/announcements']) {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(403)
    }
  } finally {
    await context.close()
  }
})
