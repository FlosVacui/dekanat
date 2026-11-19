// «Спросить деканат» на экране 360×800 (пакет 4.1): студент belozerov задаёт вопрос, сотрудник dekanat отвечает, студент видит
// ответ на экране вопроса и в ленте уведомлений; чужое не открыть; текст выводится как текст; форма работает без скриптов.
// Данные — основной набор вымышленных аккаунтов. Файл создаёт свои вопросы и в конце удаляет их сам, ленту возвращает к прежнему
// виду: другие файлы от него не зависят. Снимки 360 и 1280 пишутся в SCREENSHOT_DIR (нет — во временную папку dekanat-runs).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { MAIN_COHORT } from '../../db/seed-data'
import { formatDate, todayIn } from '../../src/lib/dates'
import { QUESTION_TOPICS, QUESTION_TOPIC_LABELS } from '../../src/lib/questions'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { restoreFeedState, snapshotFeedState, type FeedState } from './helpers/db'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
const staff = MAIN_COHORT.staff
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')
if (!student1.markers.questions) throw new Error('У студента нет метки вопросов')

const SHOT_DIR = process.env.SCREENSHOT_DIR ?? join(process.env.LOCALAPPDATA ?? fileURLToPath(new URL('../../', import.meta.url)), 'dekanat-runs', '4.1-shots')
const TOPIC = QUESTION_TOPIC_LABELS.resits
const ANSWER = 'Заявление не нужно: кафедра пришлёт дату пересдачи в уведомлении'
const UNIQUE = `Тест-вопрос-${Date.now()}`
const QUESTION = `Когда можно пересдать эконометрику? ${UNIQUE}`
const today = formatDate(todayIn('Europe/Moscow'))

test.describe.configure({ mode: 'serial' })

let server: RunningServer | null = null
let feedBefore: FeedState
/** Номера вопросов, которые создал этот файл. */
const made: string[] = []
/** Основной вопрос сценария: задан студентом, на него отвечает сотрудник. */
let questionId = ''

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
  feedBefore = await snapshotFeedState([student1.login, student2.login])
  server = await startServer()
})

test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
  // Свои вопросы и уведомления о них — прочь; прочитанность ленты — как была до файла.
  await withOwner(async (c) => {
    await c.query('delete from notifications where link = any($1)', [made.map((id) => `/questions/${id}`)])
    await c.query('delete from questions where id = any($1::uuid[])', [made])
  })
  await restoreFeedState(feedBefore, [student1.login, student2.login])
})

async function expectNoHorizontalScroll(page: Page, where: string, width = 360): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth, `${where}: ширина окна`).toBe(width)
}

async function expectTap(page: Page, locator: ReturnType<Page['locator']>, what: string): Promise<void> {
  await expect(locator, what).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, what).not.toBeNull()
  expect(box!.height, `${what}: высота`).toBeGreaterThanOrEqual(44)
  expect(box!.width, `${what}: ширина`).toBeGreaterThanOrEqual(44)
  void page
}

async function shot(page: Page, name: string, width: 360 | 1280): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: join(SHOT_DIR, `${name}-${width}.png`), fullPage: true })
}

/** Вход со своим адресом посетителя; `width` 1280 — окно компьютера, иначе телефон 360×800. */
async function signIn(browser: Browser, login: string, password: string, home: string, width: 360 | 1280 = 360): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(
    width === 360
      ? { baseURL: BASE_URL, extraHTTPHeaders: addressHeaders(), viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' }
      : { baseURL: BASE_URL, extraHTTPHeaders: addressHeaders(), viewport: { width: 1280, height: 800 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' },
  )
  const page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}${home}`)
  return { context, page }
}

const asStudent = (browser: Browser, who: typeof student1, width: 360 | 1280 = 360) => signIn(browser, who.login, who.password, '/', width)
const asStaff = (browser: Browser, width: 360 | 1280 = 360) => signIn(browser, staff.login, staff.password, '/staff/requests', width)

const idFromUrl = (page: Page): string => new URL(page.url()).pathname.split('/').pop() ?? ''

test('форма «Вопрос в деканат»: вход из «Заявок» и «Сегодня», пять тем, подсказка, предел 1000, зоны касания, без прокрутки вбок', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    // «Сегодня»: ссылка в блоке «Мои заявки».
    const block = page.locator('#today-requests').locator('xpath=..')
    await expect(block.getByRole('link', { name: 'Спросить деканат' })).toHaveAttribute('href', '/questions/new')

    // «Заявки»: кнопка сразу под тремя видами; раздел «Мои вопросы» с вопросами набора.
    await page.goto('/requests')
    const order = page.getByRole('region', { name: 'Заказать' }).getByRole('link')
    await expect(order).toHaveCount(4)
    await expect(order.last()).toHaveText('Спросить деканат')
    await expect(page.getByRole('heading', { name: 'Мои вопросы', level: 2 })).toBeVisible()
    await expectNoHorizontalScroll(page, '«Заявки»')
    await expectTap(page, order.last(), 'кнопка «Спросить деканат»')
    await shot(page, 'requests-questions', 360)

    await order.last().click()
    await expect(page).toHaveURL(`${BASE_URL}/questions/new`)
    await expect(page.getByRole('heading', { name: 'Вопрос в деканат', level: 1 })).toBeVisible()
    const select = page.getByLabel('Тема')
    expect(await select.evaluate((el) => el.tagName)).toBe('SELECT')
    await expect(select.locator('option')).toHaveText(QUESTION_TOPICS.map((t) => QUESTION_TOPIC_LABELS[t]))
    const text = page.getByLabel('Ваш вопрос')
    expect(await text.evaluate((el) => el.tagName)).toBe('TEXTAREA')
    await expect(text).toHaveAttribute('maxlength', '1000')
    await expect(page.getByText('До 1000 знаков. Ответ появится здесь и в уведомлениях', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeVisible()
    // Подсказка связана с полем.
    await expect(text).toHaveAccessibleDescription('До 1000 знаков. Ответ появится здесь и в уведомлениях')
    await expectTap(page, select, 'поле «Тема»')
    await expectTap(page, text, 'поле «Ваш вопрос»')
    await expectTap(page, page.getByRole('button', { name: 'Отправить', exact: true }), 'кнопка «Отправить»')
    await expectNoHorizontalScroll(page, 'форма вопроса')
    await shot(page, 'question-form', 360)

    // Пока ничего не введено, тексты отказа по пределу не видны; страница сама их не придумывает.
    await expect(page.getByTestId('question-limit')).toHaveCount(0)
    await page.goto('/questions/new?limit=pair')
    // Свой блок отказа: у Next.js есть ещё объявление смены страницы с той же ролью.
    const refusal = page.getByTestId('question-limit')
    await expect(refusal).toHaveAttribute('role', 'alert')
    await expect(refusal).toHaveText('С вашего адреса сегодня отправлено слишком много вопросов. Попробуйте завтра')
    await page.goto('/questions/new?limit=account')
    await expect(refusal).toHaveText('Сегодня с этого аккаунта отправлено слишком много вопросов. Попробуйте завтра')
    await page.goto('/questions/new?limit=99')
    await expect(refusal).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('belozerov задаёт вопрос: экран вопроса со статусом «Отправлен»; вопрос — в «Моих вопросах»', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    await page.goto('/questions/new')
    await page.getByLabel('Тема').selectOption({ label: TOPIC })
    await page.getByLabel('Ваш вопрос').fill(QUESTION)
    await page.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(page).toHaveURL(/\/questions\/[0-9a-f-]{36}$/)
    questionId = idFromUrl(page)
    made.push(questionId)

    await expect(page.getByRole('link', { name: 'Все заявки' })).toHaveAttribute('href', '/requests')
    await expect(page.getByRole('heading', { name: TOPIC, level: 1 })).toBeVisible()
    await expect(page.getByText(`Отправлен ${today}`, { exact: true })).toBeVisible()
    await expect(page.getByTestId('question-status')).toHaveText('Отправлен')
    await expect(page.getByTestId('question-body')).toHaveText(QUESTION)
    await expect(page.getByRole('heading', { name: 'Ответ деканата' })).toHaveCount(0)
    await expectNoHorizontalScroll(page, 'экран вопроса без ответа')

    await page.goto('/requests')
    const card = page.locator(`a[href="/questions/${questionId}"]`)
    await expect(card).toContainText('Отправлен')
    await expect(card).toContainText(TOPIC)
    await expect(card).toContainText(`Отправлен ${today}`)
    await expectTap(page, card, 'карточка вопроса')
    await expectNoHorizontalScroll(page, '«Мои вопросы»')
  } finally {
    await context.close()
  }
})

test('dekanat находит вопрос фишкой «Вопросы», поиск по ФИО работает, ответ — один раз', async ({ browser }) => {
  const { context, page } = await asStaff(browser)
  try {
    const nav = page.getByRole('navigation', { name: 'Фильтр по статусу' })
    await expect(nav.getByRole('link', { name: /^Вопросы\s*\d+$/ })).toBeVisible()
    await nav.getByRole('link', { name: /^Вопросы/ }).click()
    await expect(page).toHaveURL(`${BASE_URL}/staff/requests?view=questions`)
    await expect(nav.getByRole('link', { name: /^Вопросы/ })).toHaveAttribute('aria-current', 'page')
    // Прежние фишки и их адреса не меняются.
    await expect(nav.getByRole('link', { name: /^Подана/ })).toHaveAttribute('href', '/staff/requests?status=submitted')

    const card = page.locator(`a[href="/staff/questions/${questionId}"]`)
    await expect(card).toContainText(student1.fullName)
    await expect(card).toContainText(TOPIC)
    await expect(card).toContainText('Отправлен')
    await expectNoHorizontalScroll(page, 'список вопросов сотрудника')
    await expectTap(page, card, 'карточка вопроса сотрудника')
    await shot(page, 'staff-questions-list', 360)

    // Поиск по ФИО в виде «Вопросы»: чужое ФИО вопрос не показывает, своё — показывает.
    await page.getByLabel('Поиск по ФИО студента').fill(student2.fullName.split(' ')[0]!)
    await page.getByRole('button', { name: 'Найти' }).click()
    await expect(page).toHaveURL(/view=questions/)
    await expect(page).toHaveURL(/q=/)
    await expect(card).toHaveCount(0)
    await page.getByLabel('Поиск по ФИО студента').fill(student1.fullName.split(' ')[0]!)
    await page.getByRole('button', { name: 'Найти' }).click()
    await expect(card).toHaveCount(1)

    await card.click()
    await expect(page).toHaveURL(`${BASE_URL}/staff/questions/${questionId}`)
    await expect(page.getByRole('heading', { name: TOPIC, level: 1 })).toBeVisible()
    await expect(page.getByText(student1.fullName, { exact: true })).toBeVisible()
    await expect(page.getByTestId('staff-question-body')).toHaveText(QUESTION)
    await expect(page.getByTestId('staff-question-status')).toHaveText('Отправлен')
    const answer = page.getByLabel('Ответ студенту')
    await expect(answer).toHaveAttribute('maxlength', '1000')
    await expectTap(page, answer, 'поле «Ответ студенту»')
    await expectNoHorizontalScroll(page, 'экран вопроса сотрудника')
    await shot(page, 'staff-question', 360)

    await answer.fill(ANSWER)
    await page.getByRole('button', { name: 'Отправить ответ' }).click()
    await expect(page.getByTestId('staff-question-status')).toHaveText('Есть ответ')
    await expect(page.getByRole('heading', { name: 'Ответ деканата' })).toBeVisible()
    await expect(page.getByTestId('staff-question-answer')).toHaveText(ANSWER)
    // Ответ один: формы больше нет.
    await expect(page.getByLabel('Ответ студенту')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Отправить ответ' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('студент видит «Есть ответ», блок «Ответ деканата» и уведомление; переход по уведомлению ведёт на вопрос', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    await page.goto(`/questions/${questionId}`)
    await expect(page.getByTestId('question-status')).toHaveText('Есть ответ')
    const block = page.locator('section', { has: page.getByRole('heading', { name: 'Ответ деканата' }) })
    await expect(block).toContainText(today)
    await expect(page.getByTestId('question-answer')).toHaveText(ANSWER)
    await expectNoHorizontalScroll(page, 'экран вопроса с ответом')
    await shot(page, 'question-answered', 360)

    await page.goto('/requests')
    await expect(page.locator(`a[href="/questions/${questionId}"]`)).toContainText('Есть ответ')

    // Лента: одно непрочитанное уведомление об ответе на этот вопрос — «Деканат ответил на вопрос», текст — тема.
    await page.goto('/notifications')
    const item = page.getByRole('button', { name: /Деканат ответил на вопрос/ })
    await expect(item).toHaveCount(1)
    await expect(item).toContainText(TOPIC)
    await item.click()
    await expect(page).toHaveURL(`${BASE_URL}/questions/${questionId}`)
    await expect(page.getByTestId('question-body')).toHaveText(QUESTION)

    // Вопрос набора с ответом тоже читается: у студента два вопроса набора.
    await page.goto('/requests')
    await expect(page.locator('a[href^="/questions/"]:not([href="/questions/new"])')).toHaveCount(3)
  } finally {
    await context.close()
  }
})

test('чужое: у nesterova нет метки belozerov, адрес чужого вопроса — 404; сотрудник не открывает несуществующий', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student2)
  try {
    const marker = student1.markers.questions!
    for (const path of ['/', '/requests', '/notifications']) {
      await page.goto(path)
      await expect(page.locator('body'), path).not.toContainText(marker)
      await expect(page.locator('body'), path).not.toContainText(UNIQUE)
      await expect(page.locator('body'), path).not.toContainText(ANSWER)
    }
    const foreign = await page.goto(`/questions/${questionId}`)
    expect(foreign!.status(), 'чужой вопрос').toBe(404)
    await expect(page.locator('body')).not.toContainText(UNIQUE)
    const missing = await page.goto('/questions/00000000-0000-4000-8000-000000000000')
    expect(missing!.status(), 'несуществующий вопрос').toBe(404)
    const junk = await page.goto('/questions/не-номер')
    expect(junk!.status(), 'мусор вместо номера').toBe(404)
    // Проверка не пуста: свой вопрос nesterova открывается, и в нём её метка, а не чужая.
    await page.goto('/requests')
    const mine = await page.locator('a[href^="/questions/"]:not([href="/questions/new"])').count()
    expect(mine, 'у nesterova есть свои вопросы').toBeGreaterThan(0)
    const own = student2.markers.questions!
    expect(own, 'у второго студента своя метка').not.toBe(marker)
    const firstOwn = await page.locator('a[href^="/questions/"]:not([href="/questions/new"])').evaluateAll((els) => els.map((el) => el.getAttribute('href')))
    let seenOwnMarker = false
    for (const href of firstOwn) {
      await page.goto(href!)
      if ((await page.locator('body').innerText()).includes(own)) seenOwnMarker = true
      await expect(page.locator('body')).not.toContainText(marker)
    }
    expect(seenOwnMarker, `её метка «${own}» найдена на её вопросах`).toBe(true)
  } finally {
    await context.close()
  }
  const other = await asStaff(browser)
  try {
    const missing = await other.page.goto('/staff/questions/00000000-0000-4000-8000-000000000000')
    expect(missing!.status()).toBe(404)
    // Студент на странице сотрудника — отказ.
  } finally {
    await other.context.close()
  }
  const student = await asStudent(browser, student1)
  try {
    const res = await student.page.goto(`/staff/questions/${questionId}`)
    expect(res!.status(), 'студент на экране вопроса сотрудника').toBe(403)
  } finally {
    await student.context.close()
  }
})

test('текст <script> и <b> выводится как текст у студента и у сотрудника', async ({ browser }) => {
  const evil = `<script>window.__pwned = 1</script> <b>жирный</b>\nвторая строка ${'длинноеслово'.repeat(12)}`
  const { context, page } = await asStudent(browser, student1)
  let id = ''
  try {
    await page.goto('/questions/new')
    await page.getByLabel('Тема').selectOption({ label: QUESTION_TOPIC_LABELS.other })
    await page.getByLabel('Ваш вопрос').fill(evil)
    await page.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(page).toHaveURL(/\/questions\/[0-9a-f-]{36}$/)
    id = idFromUrl(page)
    made.push(id)
    await expect(page.getByTestId('question-body')).toHaveText(evil)
    await expect(page.getByTestId('question-body').locator('b, script')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
    // Переносы строк сохраняются, длинное слово переносится: прокрутки вбок нет.
    expect(await page.getByTestId('question-body').evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap')
    await expectNoHorizontalScroll(page, 'вопрос с длинным словом')
  } finally {
    await context.close()
  }
  const sp = await asStaff(browser)
  try {
    await sp.page.goto(`/staff/questions/${id}`)
    await expect(sp.page.getByTestId('staff-question-body')).toHaveText(evil)
    await expect(sp.page.getByTestId('staff-question-body').locator('b, script')).toHaveCount(0)
    expect(await sp.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
    await expectNoHorizontalScroll(sp.page, 'вопрос с длинным словом у сотрудника')
    // Ответ с разметкой — тоже текст у студента.
    const reply = '<b>ответ</b> <script>window.__pwned = 2</script>'
    await sp.page.getByLabel('Ответ студенту').fill(reply)
    await sp.page.getByRole('button', { name: 'Отправить ответ' }).click()
    await expect(sp.page.getByTestId('staff-question-answer')).toHaveText(reply)
    await expect(sp.page.getByTestId('staff-question-answer').locator('b, script')).toHaveCount(0)
  } finally {
    await sp.context.close()
  }
  const again = await asStudent(browser, student1)
  try {
    await again.page.goto(`/questions/${id}`)
    await expect(again.page.getByTestId('question-answer')).toHaveText('<b>ответ</b> <script>window.__pwned = 2</script>')
    await expect(again.page.getByTestId('question-answer').locator('b, script')).toHaveCount(0)
  } finally {
    await again.context.close()
  }
})

test('без скриптов форма вопроса отправляется', async ({ browser }) => {
  const login = await asStudent(browser, student1)
  const state = await login.context.storageState()
  await login.context.close()
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: state,
    javaScriptEnabled: false,
    extraHTTPHeaders: addressHeaders(),
    viewport: { width: 360, height: 800 },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  })
  const page = await context.newPage()
  try {
    await page.goto('/questions/new')
    await page.getByLabel('Тема').selectOption({ label: QUESTION_TOPIC_LABELS.stipend })
    await page.getByLabel('Ваш вопрос').fill('Вопрос без скриптов')
    await page.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(page).toHaveURL(/\/questions\/[0-9a-f-]{36}$/)
    made.push(idFromUrl(page))
    await expect(page.getByRole('heading', { name: QUESTION_TOPIC_LABELS.stipend, level: 1 })).toBeVisible()
    await expect(page.getByTestId('question-body')).toHaveText('Вопрос без скриптов')
  } finally {
    await context.close()
  }
})

test('пустой вопрос не уходит: форма возвращает на «Вопрос в деканат», вопрос не создан', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    const before = await withOwner((c) => c.query('select count(*)::int as n from questions'))
    await page.goto('/questions/new')
    // Обход `required` в браузере: серверная проверка всё равно отказывает.
    await page.getByLabel('Ваш вопрос').evaluate((el) => (el as HTMLTextAreaElement).removeAttribute('required'))
    await page.getByLabel('Ваш вопрос').fill('   ')
    await page.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(page).toHaveURL(`${BASE_URL}/questions/new`)
    await expect(page.getByRole('heading', { name: 'Вопрос в деканат', level: 1 })).toBeVisible()
    const after = await withOwner((c) => c.query('select count(*)::int as n from questions'))
    expect(after.rows[0].n, 'вопрос не создан').toBe(before.rows[0].n)
  } finally {
    await context.close()
  }
})

test('снимки 1280: форма, вопрос с ответом, «Заявки», «Сегодня», экран сотрудника', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1, 1280)
  try {
    await page.goto('/requests')
    await expect(page.getByRole('heading', { name: 'Мои вопросы', level: 2 })).toBeVisible()
    await expectNoHorizontalScroll(page, '1280 «Заявки»', 1280)
    await shot(page, 'requests-questions', 1280)
    await page.goto('/questions/new')
    await expectNoHorizontalScroll(page, '1280 форма', 1280)
    await shot(page, 'question-form', 1280)
    await page.goto(`/questions/${questionId}`)
    await expect(page.getByTestId('question-status')).toHaveText('Есть ответ')
    await shot(page, 'question-answered', 1280)
    await page.goto('/')
    await expect(page.locator('#today-requests').locator('xpath=..').getByRole('link', { name: 'Спросить деканат' })).toBeVisible()
    await shot(page, 'today', 1280)
  } finally {
    await context.close()
  }
  const sp = await asStaff(browser, 1280)
  try {
    await sp.page.goto('/staff/requests?view=questions')
    await expect(sp.page.locator(`a[href="/staff/questions/${questionId}"]`)).toBeVisible()
    await expectNoHorizontalScroll(sp.page, '1280 список вопросов', 1280)
    await shot(sp.page, 'staff-questions-list', 1280)
    await sp.page.goto(`/staff/questions/${questionId}`)
    await expect(sp.page.getByTestId('staff-question-status')).toHaveText('Есть ответ')
    await shot(sp.page, 'staff-question', 1280)
  } finally {
    await sp.context.close()
  }
})
