// «Стипендия» (20.11): статус по итогам прошлой сессии, выплаты, повышенная, размеры по приказу. Данные — основной набор вымышленных аккаунтов.
// Студент 1 (долг по «Эконометрике» в прошлой сессии) — «Не назначена: есть долг»; студент 2 (все «отлично») — «Назначена академическая».
// Файл только читает: ничего не подаёт и не отмечает. Числа, зависящие от дня запуска, считаются теми же функциями, что страница,
// от сегодняшнего дня в часовом поясе вуза. Проверка прокрутки вбок сначала убеждается, что окно нужной ширины (ошибка ИИ 115).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { todayIn } from '../../src/lib/dates'
import {
  PREVIOUS_SESSION_END,
  SCHOLARSHIP_ORDER,
  TERM_END,
  buildPayouts,
  dayWithWeekday,
  firstOfNextMonth,
  formatRub,
} from '../../src/lib/scholarship'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе нет двух студентов')
const staff = MAIN_COHORT.staff

const TODAY = todayIn('Europe/Moscow')
const PLAN = buildPayouts({ payFrom: firstOfNextMonth(PREVIOUS_SESSION_END), termEnd: TERM_END, today: TODAY, amount: SCHOLARSHIP_ORDER.academic })

/** Текст без неразрывных пробелов: «4 500 ₽». */
const plain = (text: string | null): string => (text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

let server: RunningServer | null = null

test.beforeAll(async () => {
  server = await startServer()
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

async function open(browser: Browser, who: { login: string; password: string }, width: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newContext(browser, width)
  const page = await context.newPage()
  await signIn(page, who.login, who.password, '/')
  await page.goto('/scholarship')
  await expect(page.getByRole('heading', { name: 'Стипендия', level: 1 })).toBeVisible()
  return { context, page }
}

async function expectNoHorizontalScroll(page: Page, width: number, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(clientWidth, `${where}: ширина окна`).toBe(width)
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
}

// ---------- студент 1: долг ----------

test('студент 1, 360: «Не назначена: есть долг», ссылки на п. 3.2 и на дисциплину, выплат и истории нет, прокрутки вбок нет', async ({ browser }) => {
  const { context, page } = await open(browser, student1!, 360)
  try {
    await expect(page.getByTestId('scholarship-sample')).toHaveText('Суммы — пример для прототипа')
    const status = page.getByTestId('scholarship-status')
    await expect(status).toHaveAttribute('data-status', 'none')
    await expect(page.getByTestId('scholarship-title')).toHaveText('Не назначена: есть долг')
    await expect(status).toContainText('«Эконометрика»')
    await expect(status.getByRole('link', { name: /^п\. 3\.2/ })).toHaveAttribute('href', '/rules#p-3-2')

    // «Что сделать»: ссылка на дисциплину-долг и строка про следующую сессию.
    const todo = page.getByTestId('scholarship-todo')
    await expect(todo).toBeVisible()
    await expect(todo.getByRole('link', { name: /Закрыть долг по «Эконометрика»/ })).toHaveAttribute('href', /^\/grades\/[0-9a-f-]{36}$/)
    await expect(todo).toContainText('Сдать ближайшую сессию без троек и без долгов')

    // Не назначена: истории, суммы выплаты и «ближайшей выплаты» нет.
    await expect(page.getByTestId('scholarship-payments')).toHaveCount(0)
    await expect(page.getByTestId('scholarship-history')).toHaveCount(0)
    await expect(page.getByTestId('scholarship-next')).toHaveCount(0)

    // Повышенная и размеры на месте.
    await expect(page.getByRole('heading', { name: 'Как получить повышенную', level: 2 })).toBeVisible()
    await expect(page.getByTestId('scholarship-excellent')).toHaveCount(0)
    const sizes = page.getByTestId('scholarship-sizes')
    for (const amount of [SCHOLARSHIP_ORDER.academic, SCHOLARSHIP_ORDER.raised, SCHOLARSHIP_ORDER.social]) {
      await expect(sizes).toContainText(plain(formatRub(amount)))
    }
    await expectNoHorizontalScroll(page, 360, 'студент 1, /scholarship, 360')

    // Ссылка ведёт на настоящий пункт положения.
    await status.getByRole('link', { name: /^п\. 3\.2/ }).click()
    await expect(page).toHaveURL(`${BASE_URL}/rules#p-3-2`)
    await expect(page.locator('article[data-point="3.2"]')).toBeVisible()
  } finally {
    await context.close()
  }
})

test('студент 1: ссылка на долг открывает дисциплину студента', async ({ browser }) => {
  const { context, page } = await open(browser, student1!, 1280)
  try {
    await page.getByTestId('scholarship-todo').getByRole('link', { name: /Закрыть долг по «Эконометрика»/ }).click()
    await expect(page).toHaveURL(/\/grades\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: 'Эконометрика', level: 1 })).toBeVisible()
  } finally {
    await context.close()
  }
})

// ---------- студент 2: назначена ----------

test('студент 2, 360: «Назначена академическая», сумма в месяц, ближайшая выплата, история по месяцам; прокрутки вбок нет', async ({ browser }) => {
  const { context, page } = await open(browser, student2!, 360)
  try {
    await expect(page.getByTestId('scholarship-status')).toHaveAttribute('data-status', 'academic')
    await expect(page.getByTestId('scholarship-title')).toHaveText('Назначена академическая')
    await expect(page.getByTestId('scholarship-status').getByRole('link', { name: /^п\. 3\.2/ })).toHaveAttribute('href', '/rules#p-3-2')

    const payments = page.getByTestId('scholarship-payments')
    await expect(payments).toBeVisible()
    expect(plain(await page.getByTestId('scholarship-monthly').textContent())).toBe('4 500 ₽')
    if (PLAN.next) expect(plain(await page.getByTestId('scholarship-next').textContent())).toBe(dayWithWeekday(PLAN.next.date))
    expect(plain(await page.getByTestId('scholarship-total').textContent())).toBe(plain(formatRub(PLAN.paidTotal)))
    await expect(page.getByTestId('scholarship-todo')).toHaveCount(0)

    // История: по строке на месяц с начала выплаты до текущего, новые сверху; текущий месяц до 25 числа — «Ожидается».
    const rows = page.getByTestId('scholarship-history').locator('li')
    await expect(rows).toHaveCount(PLAN.history.length)
    expect(PLAN.history.length, 'в истории есть хотя бы сентябрь').toBeGreaterThan(0)
    for (const [i, p] of PLAN.history.entries()) {
      await expect(rows.nth(i), `строка ${i + 1}`).toContainText(p.label)
      await expect(rows.nth(i), `строка ${i + 1}: состояние`).toHaveAttribute('data-state', p.state)
      await expect(rows.nth(i), `строка ${i + 1}: сумма`).toContainText('4 500 ₽')
    }
    await expect(page.getByTestId('scholarship-payments').getByRole('link', { name: /^п\. 3\.7/ })).toHaveAttribute('href', '/rules#p-3-7')

    // Суммы с выровненными цифрами.
    await expect(page.getByTestId('scholarship-monthly').locator('xpath=..')).toHaveCSS('font-variant-numeric', /tabular-nums/)
    await expectNoHorizontalScroll(page, 360, 'студент 2, /scholarship, 360')
  } finally {
    await context.close()
  }
})

test('студент 2: все экзамены прошлой сессии «отлично» — на экране сказано; срок подачи на повышенную и кнопка в «Спросить деканат»', async ({ browser }) => {
  const { context, page } = await open(browser, student2!, 360)
  try {
    await expect(page.getByTestId('scholarship-excellent')).toContainText('«отлично»')
    const raised = page.getByTestId('scholarship-raised')
    await expect(raised).toContainText('10 рабочих дней')
    await expect(raised.getByRole('link', { name: /^п\. 3\.3/ })).toHaveAttribute('href', '/rules#p-3-3')
    // Срок называется датой, пока до него не прошло время (последний экзамен семестра — в январе 2027).
    if (TODAY <= '2027-01-27') await expect(page.getByTestId('scholarship-raised-deadline')).toContainText('Подать заявление — до')

    // Отдельного вида заявки нет: кнопка — форма вопроса в деканат с подставленным текстом.
    const apply = page.getByTestId('scholarship-raised-apply')
    await expect(apply).toHaveAttribute('href', /^\/questions\/new\?text=/)
    await apply.click()
    await expect(page).toHaveURL(/\/questions\/new\?text=/)
    await expect(page.getByLabel('Ваш вопрос')).toHaveValue(/повышенную академическую стипендию/)
    // Форма только открыта: вопрос не отправляется.
  } finally {
    await context.close()
  }
})

test('студент 2, 1280: две колонки — статус и выплаты слева, условия справа; колонка разделов с активной «Стипендией»; прокрутки вбок нет', async ({ browser }) => {
  const { context, page } = await open(browser, student2!, 1280)
  try {
    const status = (await page.getByTestId('scholarship-status').boundingBox())!
    const payments = (await page.getByTestId('scholarship-payments').boundingBox())!
    const raised = (await page.getByTestId('scholarship-raised').boundingBox())!
    const sizes = (await page.getByTestId('scholarship-sizes').boundingBox())!
    expect(raised.x, 'условия правее статуса').toBeGreaterThan(status.x + status.width - 1)
    expect(Math.abs(payments.x - status.x), 'статус и выплаты в одной колонке').toBeLessThanOrEqual(1)
    expect(Math.abs(sizes.x - raised.x), 'условия и размеры в одной колонке').toBeLessThanOrEqual(1)
    expect(payments.y, 'выплаты под статусом').toBeGreaterThanOrEqual(status.y + status.height - 1)

    const nav = page.getByRole('navigation', { name: 'Разделы' })
    const link = nav.getByRole('link', { name: 'Стипендия', exact: true })
    await expect(link).toHaveAttribute('href', '/scholarship')
    await expect(link).toHaveAttribute('aria-current', 'page')
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
    // «Стипендия» стоит сразу после «Заявок» в группе «Деканат».
    const names = (await nav.getByRole('link').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())
    expect(names.indexOf('Стипендия')).toBe(names.indexOf('Заявки') + 1)
    await expect(page.locator('[data-scholarship-link]')).toBeHidden()
    await expectNoHorizontalScroll(page, 1280, 'студент 2, /scholarship, 1280')
  } finally {
    await context.close()
  }
})

test('1280, студент 1: страница без прокрутки вбок', async ({ browser }) => {
  const { context, page } = await open(browser, student1!, 1280)
  try {
    await expectNoHorizontalScroll(page, 1280, 'студент 1, /scholarship, 1280')
  } finally {
    await context.close()
  }
})

// ---------- навигация и «Сегодня» ----------

test('360: нижняя панель — по-прежнему четыре вкладки; ссылка «Стипендия» под содержимым ведёт на /scholarship и становится активной', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student2!.login, student2!.password, '/')
    const nav = page.getByRole('navigation', { name: 'Разделы' })
    await expect(nav.getByRole('link')).toHaveCount(4)
    await expect(nav.getByRole('link', { name: 'Стипендия' })).toHaveCount(0)
    const link = page.locator('[data-scholarship-link]')
    await expect(link).toBeVisible()
    expect((await link.boundingBox())!.height, 'зона касания').toBeGreaterThanOrEqual(44)
    await link.click()
    await expect(page).toHaveURL(`${BASE_URL}/scholarship`)
    await expect(page.locator('[data-scholarship-link]')).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link')).toHaveCount(4)
  } finally {
    await context.close()
  }
})

test('«Сегодня» у студента с долгом: строка о стипендии у долга — ссылка на /scholarship, отдельной строки нет; у студента без долга её нет', async ({ browser }) => {
  for (const [who, hasDebt] of [
    [student1!, true],
    [student2!, false],
  ] as const) {
    const context = await newContext(browser, 1280)
    try {
      const page = await context.newPage()
      await signIn(page, who.login, who.password, '/')
      const stipend = page.getByTestId('waiting-stipend')
      if (!hasDebt) {
        await expect(stipend, `${who.login}: ссылки на стипендию в «Ждёт вас» нет`).toHaveCount(0)
        continue
      }
      await expect(stipend, `${who.login}: одна строка о стипендии`).toHaveCount(1)
      await expect(stipend).toHaveAttribute('href', '/scholarship')
      await expect(stipend).toContainText('стипендия не назначается')
      await stipend.click()
      await expect(page).toHaveURL(`${BASE_URL}/scholarship`)
      await expect(page.getByTestId('scholarship-title')).toHaveText('Не назначена: есть долг')
    } finally {
      await context.close()
    }
  }
})

// ---------- доступ ----------

test('гость на /scholarship — на /login; на входе ссылки «Стипендия» нет', async ({ browser }) => {
  for (const width of [360, 1280]) {
    const context = await newContext(browser, width)
    try {
      const page = await context.newPage()
      await page.goto('/scholarship')
      await expect(page).toHaveURL(`${BASE_URL}/login`)
      await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Стипендия' })).toHaveCount(0)
    } finally {
      await context.close()
    }
  }
})

test('сотрудник на /scholarship получает тот же ответ, что и на другой странице студента; ни оценок, ни сумм, ни ссылки «Стипендия»', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, staff.login, staff.password, '/staff/requests')
    await expect(page.getByRole('link', { name: 'Стипендия' })).toHaveCount(0)
    const other = await page.goto('/schedule')
    const scholarship = await page.goto('/scholarship')
    expect(other!.status(), 'другая страница студента').toBe(403)
    expect(scholarship!.status(), '/scholarship').toBe(other!.status())
    await expect(page.getByTestId('scholarship-status')).toHaveCount(0)
    await expect(page.getByText('4 500 ₽')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Стипендия' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('адрес не выбирает владельца: параметры ?student=, ?userId=, ?login= страницу не меняют — у студента 2 свои данные', async ({ browser }) => {
  const { context, page } = await open(browser, student2!, 360)
  try {
    await page.goto(`/scholarship?student=${student1!.login}&userId=1&login=${student1!.login}&semester=4`)
    await expect(page.getByTestId('scholarship-title')).toHaveText('Назначена академическая')
    await expect(page.getByTestId('scholarship-todo')).toHaveCount(0)
    await expect(page.getByText('Эконометрика')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
