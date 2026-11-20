// 20.11, студент: «Вам положено» на «Сегодня», отзыв заявки, «Заказать ещё раз», оценка выдачи. Данные — основной набор вымышленных аккаунтов.
// Студент 1 — долг в прошлой сессии (строки «долг» и «материальная помощь»); студент 2 — все «отлично» (строка «повышенная»).
// Подделку формы с чужим номером проверяет слой доступа (tests/unit/dal-request-withdraw-rate.test.ts), здесь — адреса.
// Состояние заявок (взята в работу, готова, выдана) ставится запросом под владельцем базы: путь деканата проверяют другие файлы.
// Отзыв и оценка проверяются и без скриптов (кукa входа переносится в контекст с выключенным JavaScript). Заявки, которые создал тест, удаляются.
// Ширина окна сверяется перед проверкой прокрутки вбок (ошибка ИИ 115).
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import pg from 'pg'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе нет двух студентов')

let server: RunningServer | null = null
const created: string[] = []

test.beforeAll(async () => {
  server = await startServer()
})
test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
  await withOwner(async (c) => {
    await c.query('delete from notifications where link = any($1)', [created.map((id) => `/requests/${id}`)])
    await c.query('delete from requests where id = any($1::uuid[])', [created])
  })
})

async function withOwner<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_OWNER_URL) process.loadEnvFile(process.env.ENV_FILE || fileURLToPath(new URL('../../../.env', import.meta.url)))
  const client = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function setStatus(id: string, status: 'in_progress' | 'ready' | 'issued'): Promise<void> {
  await withOwner((c) =>
    c.query(
      `update requests set status = $2, due_date = current_date, pickup_until = case when $2 in ('ready','issued') then current_date + 5 end,
         issued_on = case when $2 = 'issued' then current_date end where id = $1`,
      [id, status],
    ),
  )
}

async function dbRow(id: string) {
  return withOwner(async (c) => (await c.query('select status, reject_reason, rating from requests where id = $1', [id])).rows[0])
}

const plain = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim()

async function newContext(browser: Browser, width: number, extra: { storageState?: Awaited<ReturnType<BrowserContext['storageState']>>; js?: boolean; ip?: string } = {}) {
  const mobile = width < 600
  return browser.newContext({
    viewport: { width, height: 800 },
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    javaScriptEnabled: extra.js ?? true,
    storageState: extra.storageState,
    extraHTTPHeaders: addressHeaders(extra.ip ?? freshAddress()),
  })
}

async function open(browser: Browser, who: { login: string; password: string }, width = 360): Promise<{ context: BrowserContext; page: Page; ip: string }> {
  const ip = freshAddress()
  const context = await newContext(browser, width, { ip })
  const page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, who.login, who.password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}/`)
  return { context, page, ip }
}

/** Тот же вход, но в окне без JavaScript: проверяет, что формы работают сами. */
async function withoutScripts(browser: Browser, from: { context: BrowserContext; ip: string }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newContext(browser, 360, { storageState: await from.context.storageState(), js: false, ip: from.ip })
  return { context, page: await context.newPage() }
}

async function expectNoHorizontalScroll(page: Page, width: number, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(clientWidth, `${where}: ширина окна`).toBe(width)
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
}

async function submit(page: Page, type: string, purposeKey?: string, year?: string): Promise<string> {
  await page.goto(`/requests/new?type=${type}`)
  if (purposeKey) await page.getByLabel('Куда справка').selectOption(purposeKey)
  if (year) await page.getByLabel('Год оплаты').selectOption(year)
  await page.getByRole('button', { name: 'Отправить' }).click()
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  created.push(id)
  return id
}

// ---------- «Вам положено» ----------

for (const width of [360, 1280]) {
  test(`${width}: студент 2 (все «отлично») — «Вам положено» под «Ждёт вас»: повышенная стипендия со сроком, пунктом 3.3 и ссылкой на «Стипендию»`, async ({ browser }) => {
    const { context, page } = await open(browser, student2, width)
    try {
      const block = page.getByRole('region', { name: 'Вам положено' })
      await expect(block).toBeVisible()
      const rows = block.getByRole('listitem')
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toHaveAttribute('data-kind', 'raised_scholarship')
      await expect(rows.first()).toContainText(/Можно подать на повышенную стипендию до \d{1,2} [а-яё]+/)
      // Блок стоит ниже «Ждёт вас» и выше следующей пары.
      const waitingBox = await page.getByRole('region', { name: 'Ждёт вас' }).boundingBox()
      const blockBox = await block.boundingBox()
      expect(blockBox!.y, 'ниже «Ждёт вас»').toBeGreaterThan(waitingBox!.y + waitingBox!.height - 1)
      // Ссылка на пункт и кнопка — зона касания не меньше 44, пункт ведёт в положение, кнопка — на «Стипендию».
      const point = rows.first().getByRole('link', { name: /^п\. 3\.3\./ })
      const action = rows.first().getByRole('link', { name: 'Открыть «Стипендию»' })
      for (const link of [point, action]) expect((await link.boundingBox())!.height, 'зона касания').toBeGreaterThanOrEqual(44)
      await expect(point).toHaveAttribute('href', '/rules#p-3-3')
      await expect(action).toHaveAttribute('href', '/scholarship')
      await expectNoHorizontalScroll(page, width, 'Сегодня, студент 2')
      const today = plain(await rows.first().locator('b').first().textContent())

      // Срок тот же, что на «Стипендии».
      await action.click()
      await expect(page).toHaveURL(`${BASE_URL}/scholarship`)
      const deadline = plain(await page.getByTestId('scholarship-raised-deadline').textContent())
      const date = /до (\d{1,2} [а-яё]+)/.exec(today)![1]
      expect(deadline).toContain(`Подать заявление — до ${date}`)
    } finally {
      await context.close()
    }
  })
}

/** Заявка студента на материальную помощь из набора: в работе (у студента 1 она есть с начала) или выдана. */
async function setSeededAid(login: string, state: 'open' | 'closed'): Promise<void> {
  await withOwner((c) =>
    c.query(
      `update requests set status = $2, issued_on = case when $2 = 'issued' then current_date end
       where kind = 'financial_aid' and student_id = (select id from users where login = $1)`,
      [login, state === 'open' ? 'in_progress' : 'issued'],
    ),
  )
}

for (const width of [360, 1280]) {
  test(`${width}: студент 1 (долг) — строка «долг» (п. 2.2); «материальная помощь» (п. 3.5) только без открытой заявки на помощь и уходит после подачи`, async ({ browser }) => {
    const { context, page } = await open(browser, student1, width)
    try {
      // В наборе у студента 1 заявка на помощь уже в работе: строки помощи нет, повышенной тоже.
      const block = page.getByRole('region', { name: 'Вам положено' })
      const rows = block.getByRole('listitem')
      await expect(rows).toHaveCount(1)
      await expect(rows.nth(0)).toHaveAttribute('data-kind', 'debt_valid_reason')
      await expect(rows.nth(0)).toContainText('Можно сдать долг по уважительной причине')
      await expect(rows.nth(0)).toContainText('«Эконометрика»')
      await expect(rows.nth(0).getByRole('link', { name: /^п\. 2\.2\./ })).toHaveAttribute('href', '/rules#p-2-2')
      await expect(block.locator('[data-kind="raised_scholarship"]')).toHaveCount(0)
      await expect(block.locator('[data-kind="financial_aid"]')).toHaveCount(0)
      await expectNoHorizontalScroll(page, width, 'Сегодня, студент 1')

      // Пункт 2.2 открывается в положении и есть на странице.
      await rows.nth(0).getByRole('link', { name: /^п\. 2\.2\./ }).click()
      await expect(page).toHaveURL(`${BASE_URL}/rules#p-2-2`)
      await expect(page.locator('#p-2-2')).toBeVisible()

      // Прежняя заявка на помощь закрыта — строка помощи появляется, ссылка ведёт на форму.
      await setSeededAid(student1!.login, 'closed')
      await page.goto('/')
      const both = page.getByRole('region', { name: 'Вам положено' }).getByRole('listitem')
      await expect(both).toHaveCount(2)
      await expect(both.nth(1)).toHaveAttribute('data-kind', 'financial_aid')
      await expect(both.nth(1).getByRole('link', { name: /^п\. 3\.5\./ })).toHaveAttribute('href', '/rules#p-3-5')
      await expectNoHorizontalScroll(page, width, 'Сегодня, студент 1, две строки')

      // Подача заявки на помощь убирает строку помощи.
      await both.nth(1).getByRole('link', { name: 'Подать заявление' }).click()
      await expect(page).toHaveURL(`${BASE_URL}/requests/new?type=financial_aid`)
      await page.getByRole('button', { name: 'Отправить' }).click()
      await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
      created.push(new URL(page.url()).pathname.split('/').pop() ?? '')
      await page.goto('/')
      const after = page.getByRole('region', { name: 'Вам положено' }).getByRole('listitem')
      await expect(after).toHaveCount(1)
      await expect(after.first()).toHaveAttribute('data-kind', 'debt_valid_reason')
    } finally {
      await setSeededAid(student1!.login, 'open')
      await context.close()
    }
  })
}

// ---------- Отозвать заявку ----------

test('отзыв без скриптов: «Отозвать» → вопрос → «Нет, оставить» ничего не меняет → «Да, отозвать»: «Отозвана», шаги, список, «Сегодня», «Подать снова»', async ({ browser }) => {
  const live = await open(browser, student1)
  const { context, page } = await withoutScripts(browser, live)
  try {
    const id = await submit(live.page, 'dean_certificate', 'tax_office')
    await page.goto(`/requests/${id}`)
    await expect(page.getByTestId('request-status')).toHaveText('Подана')
    await expect(page.getByTestId('request-withdraw')).toBeVisible()
    expect((await page.getByTestId('request-withdraw').boundingBox())!.height, 'зона касания «Отозвать»').toBeGreaterThanOrEqual(44)

    await page.getByTestId('request-withdraw').click()
    await expect(page).toHaveURL(`${BASE_URL}/requests/${id}?withdraw=1`)
    await expect(page.getByRole('heading', { name: 'Отозвать заявку?' })).toBeVisible()
    await expectNoHorizontalScroll(page, 360, 'подтверждение отзыва')
    await page.getByRole('link', { name: 'Нет, оставить' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/requests/${id}`)
    expect(await dbRow(id)).toMatchObject({ status: 'submitted', reject_reason: null })

    await page.getByTestId('request-withdraw').click()
    await page.getByTestId('request-withdraw-yes').click()
    await expect(page).toHaveURL(`${BASE_URL}/requests/${id}`)
    await expect(page.getByTestId('request-status')).toHaveText('Отозвана')
    await expect(page.getByTestId('request-status-text')).toHaveText('Вы отозвали заявку, деканат её не рассматривает. Можно подать снова')
    await expect(page.getByRole('list', { name: 'Шаги заявки' }).getByRole('listitem')).toHaveText([/Подана/, /Отозвана вами/])
    await expect(page.getByTestId('request-withdraw')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Подать снова' })).toHaveAttribute('href', `/requests/new?type=dean_certificate&from=${id}`)
    expect(await dbRow(id)).toMatchObject({ status: 'rejected', reject_reason: 'withdrawn' })
    const event = await withOwner(async (c) => (await c.query("select status, note from request_events where request_id = $1 and status = 'rejected'", [id])).rows)
    expect(event).toEqual([{ status: 'rejected', note: 'withdrawn' }])
    await expectNoHorizontalScroll(page, 360, 'заявка отозвана')

    // Список: плашка «Отозвана» и текст без «Причина: не указана». «Сегодня»: отозванной нет среди новостей по заявкам.
    await page.goto('/requests')
    const card = page.locator(`a[href="/requests/${id}"]`)
    await expect(card).toContainText('Отозвана')
    await expect(card).not.toContainText('Причина')
    await page.goto('/')
    await expect(page.locator(`#today-requests ~ * a[href="/requests/${id}"]`)).toHaveCount(0)

    // «Подать снова» открывает форму с прежним назначением.
    // Форма новой заявки дорисовывается потоком, ей нужны скрипты: смотрим в окне со скриптами.
    await live.page.goto(`/requests/new?type=dean_certificate&from=${id}`)
    await expect(live.page.getByLabel('Куда справка')).toHaveValue('tax_office')
  } finally {
    await context.close()
    await live.context.close()
  }
})

test('отзыв: заявку успели взять в работу — отзыв не проходит, на экране пояснение, статус прежний; в работе и позже кнопки «Отозвать» нет', async ({ browser }) => {
  const live = await open(browser, student1)
  try {
    const { page } = live
    const id = await submit(page, 'tuition_certificate', undefined, '2024')
    await page.goto(`/requests/${id}?withdraw=1`)
    await expect(page.getByTestId('request-withdraw-yes')).toBeVisible()
    await setStatus(id, 'in_progress') // деканат взял заявку, пока вопрос открыт
    await page.getByTestId('request-withdraw-yes').click()
    await expect(page).toHaveURL(`${BASE_URL}/requests/${id}?notice=not-withdrawn`)
    await expect(page.getByTestId('request-notice')).toContainText('уже взяли в работу')
    await expect(page.getByTestId('request-status')).toHaveText('В работе')
    expect(await dbRow(id)).toMatchObject({ status: 'in_progress', reject_reason: null })
    await expect(page.getByTestId('request-withdraw')).toHaveCount(0)
    // Адрес с `?withdraw=1` у заявки в работе подтверждения не показывает.
    await page.goto(`/requests/${id}?withdraw=1`)
    await expect(page.getByTestId('request-withdraw-confirm')).toHaveCount(0)
    // Пояснение — только у заявки не «Подана»: у новой подделанный адрес его не показывает.
    const fresh = await submit(page, 'dean_certificate')
    await page.goto(`/requests/${fresh}?notice=not-withdrawn`)
    await expect(page.getByTestId('request-notice')).toHaveCount(0)
  } finally {
    await live.context.close()
  }
})

test('чужая заявка: студент 2 получает 404 и на экране заявки, и на подтверждении отзыва; заявка студента 1 не меняется', async ({ browser }) => {
  const owner = await open(browser, student1)
  const other = await open(browser, student2)
  try {
    const id = await submit(owner.page, 'dean_certificate')
    const res = await other.page.goto(`/requests/${id}?withdraw=1`)
    expect(res?.status()).toBe(404)
    expect((await other.page.goto(`/requests/${id}`))?.status()).toBe(404)
    expect(await dbRow(id)).toMatchObject({ status: 'submitted', reject_reason: null })
  } finally {
    await owner.context.close()
    await other.context.close()
  }
})

// ---------- Заказать ещё раз ----------

test('«Заказать ещё раз»: у «Готова» и «Выдана» ведёт на форму с тем же видом и назначением; у «Подана» и «В работе» кнопки нет', async ({ browser }) => {
  const { context, page } = await open(browser, student1)
  try {
    const dean = await submit(page, 'dean_certificate', 'embassy')
    const tuition = await submit(page, 'tuition_certificate', undefined, '2025')
    const aid = await submit(page, 'financial_aid')

    for (const id of [dean, tuition, aid]) {
      await page.goto(`/requests/${id}`)
      await expect(page.getByTestId('request-again')).toHaveCount(0)
    }
    await setStatus(dean, 'in_progress')
    await page.goto(`/requests/${dean}`)
    await expect(page.getByTestId('request-again')).toHaveCount(0)

    await setStatus(dean, 'ready')
    await setStatus(tuition, 'issued')
    await setStatus(aid, 'issued')

    await page.goto(`/requests/${dean}`)
    const again = page.getByTestId('request-again')
    await expect(again).toHaveText('Заказать ещё раз')
    expect((await again.boundingBox())!.height, 'зона касания').toBeGreaterThanOrEqual(44)
    await expectNoHorizontalScroll(page, 360, 'заявка «Готова»')
    await again.click()
    await expect(page).toHaveURL(`${BASE_URL}/requests/new?type=dean_certificate&from=${dean}`)
    await expect(page.getByLabel('Куда справка')).toHaveValue('embassy')
    // Заказ — новая заявка, прежняя остаётся как была.
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    const second = new URL(page.url()).pathname.split('/').pop() ?? ''
    created.push(second)
    expect(second).not.toBe(dean)
    await expect(page.getByTestId('request-field')).toHaveText('Куда: В посольство')
    expect(await dbRow(dean)).toMatchObject({ status: 'ready' })

    await page.goto(`/requests/${tuition}`)
    await page.getByTestId('request-again').click()
    await expect(page).toHaveURL(`${BASE_URL}/requests/new?type=tuition_certificate&from=${tuition}`)
    await expect(page.getByLabel('Год оплаты')).toHaveValue('2025')

    await page.goto(`/requests/${aid}`)
    await page.getByTestId('request-again').click()
    await expect(page).toHaveURL(`${BASE_URL}/requests/new?type=financial_aid&from=${aid}`)
    await expect(page.locator('select')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

// ---------- Оценка выдачи ----------

test('оценка выдачи без скриптов: «Как прошло?» только у «Выдана»; 👍, затем смена на 👎; видна после перезагрузки', async ({ browser }) => {
  const live = await open(browser, student1)
  const { context, page } = await withoutScripts(browser, live)
  try {
    const id = await submit(live.page, 'dean_certificate')
    await page.goto(`/requests/${id}`)
    await expect(page.getByTestId('request-rating')).toHaveCount(0)
    await setStatus(id, 'ready')
    await page.goto(`/requests/${id}`)
    await expect(page.getByTestId('request-rating')).toHaveCount(0)
    await setStatus(id, 'issued')
    await page.goto(`/requests/${id}`)

    const box = page.getByTestId('request-rating')
    await expect(box.getByRole('heading', { name: 'Как прошло?' })).toBeVisible()
    await expect(page.getByTestId('request-rating-state')).toContainText('Оцените')
    const up = box.getByRole('button', { name: /Хорошо/ })
    const down = box.getByRole('button', { name: /Плохо/ })
    for (const b of [up, down]) expect((await b.boundingBox())!.height, 'зона касания').toBeGreaterThanOrEqual(44)
    await expectNoHorizontalScroll(page, 360, 'заявка «Выдана»')

    await up.click()
    await expect(page).toHaveURL(`${BASE_URL}/requests/${id}`)
    await expect(page.getByTestId('request-rating-state')).toContainText('Ваша оценка: хорошо')
    await expect(up).toHaveAttribute('aria-pressed', 'true')
    await expect(down).toHaveAttribute('aria-pressed', 'false')
    expect((await dbRow(id)).rating).toBe(1)

    await down.click()
    await expect(page.getByTestId('request-rating-state')).toContainText('Ваша оценка: плохо')
    await expect(down).toHaveAttribute('aria-pressed', 'true')
    expect((await dbRow(id)).rating).toBe(-1)
    await page.reload()
    await expect(page.getByTestId('request-rating-state')).toContainText('Ваша оценка: плохо')
    // Оценка — одна запись на заявку: событий в истории не прибавилось.
    const events = await withOwner(async (c) => (await c.query('select count(*)::int as n from request_events where request_id = $1', [id])).rows[0].n)
    expect(events).toBe(1)
  } finally {
    await context.close()
    await live.context.close()
  }
})

test('1280: заявка «Выдана» с оценкой и кнопками — без прокрутки вбок', async ({ browser }) => {
  const { context, page } = await open(browser, student1, 1280)
  try {
    const id = await submit(page, 'dean_certificate')
    await setStatus(id, 'issued')
    await page.goto(`/requests/${id}`)
    await expect(page.getByTestId('request-rating')).toBeVisible()
    await expect(page.getByTestId('request-again')).toBeVisible()
    await expectNoHorizontalScroll(page, 1280, 'заявка «Выдана», 1280')
  } finally {
    await context.close()
  }
})
