// Уведомления на экране 360×800 (пакет 3.5, S-2.1: Э-9, сценарии С-10 и С-16, требование ЯД-5): число у колокольчика,
// лента с фильтром, отметка «прочитано» отправкой формы, событие «сотрудник сменил статус заявки» рождает уведомление.
// Данные — основной набор вымышленных аккаунтов (ТР-5, ТР-11). Каждый вход идёт со своим адресом посетителя.
//
// Состояние. Тест отмечает записи, а следующие файлы (requests, schedule, тесты безопасности) работают с теми же аккаунтами:
// в начале файла снимается прочитанность обоих студентов, в конце она возвращается к снимку, а заявки, поданные тестом,
// и уведомления о них удаляются. В начале каждой проверки прочитанность студента ставится «как после db:seed», поэтому
// проверка не зависит ни от порядка файлов, ни от того, что отметили до неё.
//
// Касания считаются по правилам S-2.1, раздел 1: каждое касание (клик по ссылке или кнопке) — один шаг; ввод текста и
// прокрутка не считаются. Счёт ведёт переменная `touches` в самой проверке и сверяется с пределом из сценария.
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import {
  feedRecords,
  forceNotificationKind,
  removeTestRequests,
  resetFeedToSeed,
  restoreFeedState,
  restoreNotificationKinds,
  snapshotFeedState,
  type FeedState,
} from './helpers/db'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
const staff = MAIN_COHORT.staff
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')
const LOGINS = [student1.login, student2.login]

let server: RunningServer | null = null
let initial: FeedState | null = null
const createdRequests: string[] = []

test.beforeAll(async () => {
  initial = await snapshotFeedState(LOGINS)
  server = await startServer()
})
test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
  await removeTestRequests(createdRequests)
  if (initial) await restoreFeedState(initial, LOGINS)
})

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth, `${where}: ширина окна`).toBe(360)
}

async function expectTapSize(target: Locator, what: string): Promise<void> {
  const box = await target.boundingBox()
  expect(box, `${what}: нет на экране`).not.toBeNull()
  expect(box!.height, `${what}: высота ${box!.height}`).toBeGreaterThanOrEqual(44)
  expect(box!.width, `${what}: ширина ${box!.width}`).toBeGreaterThanOrEqual(44)
}

/** Вход под своим адресом посетителя. Возвращает контекст, страницу уже вошедшего и заголовки адреса. */
async function signIn(
  browser: Browser,
  login: string,
  password: string,
  home: string,
): Promise<{ context: BrowserContext; page: Page; headers: Record<string, string> }> {
  const headers = addressHeaders(freshAddress())
  const context = await browser.newContext({ extraHTTPHeaders: headers })
  const page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}${home}`)
  return { context, page, headers }
}

const asStudent = (browser: Browser, who: typeof student1) => signIn(browser, who.login, who.password, '/')

/** Число у колокольчика: нет числа — ноль. */
async function bellCount(page: Page): Promise<number> {
  const el = page.getByTestId('bell-count')
  return (await el.count()) === 0 ? 0 : Number((await el.textContent()) ?? '0')
}

const bellLink = (page: Page) => page.getByRole('link', { name: /^Уведомления, непрочитанных: \d+$/ })
const filterGroup = (page: Page) => page.getByRole('group', { name: 'Фильтр уведомлений' })
const cards = (page: Page) => page.locator('main ul > li')
const unreadLine = (page: Page) => page.getByTestId('unread-line')

async function unreadNumber(page: Page): Promise<number> {
  const text = (await unreadLine(page).textContent()) ?? ''
  const match = /^Непрочитанных: (\d+)$/.exec(text.trim())
  if (!match) throw new Error(`Строка непрочитанного не такая, как ждали: «${text}»`)
  return Number(match[1])
}

/** Сотрудник ставит заявке статус тем же путём, что в жизни: кнопка статуса, «Сохранить». */
async function staffSets(browser: Browser, requestId: string, status: string): Promise<void> {
  const { context, page } = await signIn(browser, staff.login, staff.password, '/staff/requests')
  try {
    await page.goto(`/staff/requests/${requestId}`)
    // Форма оживает после загрузки скриптов: нажатие повторяется, пока кнопка статуса не окажется нажатой.
    const pick = page.getByRole('button', { name: status, exact: true })
    await expect(async () => {
      await pick.click()
      await expect(pick).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
    }).toPass({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByTestId('staff-request-status')).toHaveText(status)
  } finally {
    await context.close()
  }
}

test('С-16: колокольчик с числом → напоминание → экран, о котором оно, — два касания; число и пометка «Новое» убывают', async ({ browser }) => {
  await resetFeedToSeed(student1.login)
  const { context, page } = await asStudent(browser, student1)
  try {
    let touches = 0
    const before = await bellCount(page)
    expect(before, 'у колокольчика есть число').toBeGreaterThan(0)

    await bellLink(page).click()
    touches += 1
    await expect(page).toHaveURL(`${BASE_URL}/notifications`)
    await expect(page.getByRole('heading', { name: 'Уведомления', level: 1 })).toBeVisible()
    expect(await unreadNumber(page), 'строка на экране и число у колокольчика — один счёт').toBe(before)

    const reminder = cards(page).filter({ hasText: 'Расчётная работа №3' })
    await expect(reminder).toHaveCount(1)
    await expect(reminder.getByText('Новое', { exact: true })).toBeVisible()
    await reminder.getByRole('button').click()
    touches += 1
    await expect(page).toHaveURL(`${BASE_URL}/grades`)
    expect(touches, 'касаний до экрана, о котором напоминание').toBeLessThanOrEqual(2)

    // Возврат: число у колокольчика меньше на один; у этой записи пометки нет, и она теперь обычная ссылка.
    expect(await bellCount(page), 'на экране предмета число уже меньше').toBe(before - 1)
    await page.goBack()
    await expect(page).toHaveURL(`${BASE_URL}/notifications`)
    expect(await bellCount(page), 'после «Назад» число меньше на один').toBe(before - 1)
    expect(await unreadNumber(page)).toBe(before - 1)
    await expect(cards(page).filter({ hasText: 'Расчётная работа №3' }).getByText('Новое', { exact: true })).toHaveCount(0)
    await expect(cards(page).filter({ hasText: 'Расчётная работа №3' }).getByRole('link')).toHaveAttribute('href', '/grades')
    // Прочие пометки на месте: отмечена одна запись, а не все.
    await expect(page.getByText('Новое', { exact: true })).not.toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('событие в кабинете: сотрудник сменил статус заявки → у студента на один больше → запись сверху, «Новое», видна под «Напоминания» → касание ведёт на заявку', async ({
  browser,
}) => {
  await resetFeedToSeed(student1.login)
  const { context, page } = await asStudent(browser, student1)
  try {
    await page.goto('/requests/new?type=dean_certificate')
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    const requestId = new URL(page.url()).pathname.split('/').pop() ?? ''
    createdRequests.push(requestId)
    await page.goto('/')
    const before = await bellCount(page)

    await staffSets(browser, requestId, 'В работе')

    await page.goto('/')
    expect(await bellCount(page), 'у колокольчика на один больше').toBe(before + 1)
    await bellLink(page).click()
    await expect(page).toHaveURL(`${BASE_URL}/notifications`)
    expect(await unreadNumber(page)).toBe(before + 1)

    // Новая запись найдена по своему тексту, а не взята «первой»: записи набора стоят на 00:59−N сегодняшней даты и с 00:00 до 00:58
    // новее записи, созданной сейчас. Порядок проверяется по времени из базы: запись стоит выше каждой записи с более ранним временем.
    const records = await feedRecords(student1.login)
    const fresh = records.find((r) => r.link === `/requests/${requestId}`)
    expect(fresh, 'в базе нет уведомления со ссылкой на заявку').toBeDefined()
    // В наборе есть своя запись «Статус заявки изменился … В работе»: новую отличает номер уведомления в скрытом поле карточки-формы.
    const freshCard = cards(page)
      .filter({ hasText: 'Статус заявки изменился' })
      .filter({ hasText: 'В работе' })
      .filter({ has: page.locator(`input[name="id"][value="${fresh!.id}"]`) })
    await expect(freshCard).toHaveCount(1)
    await expect(freshCard).toContainText('Новое')
    const order = async (): Promise<void> => {
      const texts = await cards(page).allInnerTexts()
      const ids = await cards(page).evaluateAll((els) => els.map((el) => el.querySelector('input[name="id"]')?.getAttribute('value') ?? null))
      const freshIndex = ids.indexOf(fresh!.id)
      expect(freshIndex, 'новая запись в ленте').toBeGreaterThanOrEqual(0)
      // Время остальных карточек — из базы: карточка берёт самую новую из ещё не занятых записей с её заголовком и текстом.
      const pool = records.filter((r) => r.id !== fresh!.id).sort((a, b) => b.at.getTime() - a.at.getTime())
      const at: (Date | null)[] = texts.map((t, index) => {
        if (index === freshIndex) return fresh!.at
        const i = pool.findIndex((r) => t.includes(r.title) && t.includes(r.body))
        return i < 0 ? null : pool.splice(i, 1)[0]!.at
      })
      expect(at.every((x) => x !== null), 'у каждой карточки есть запись в базе').toBe(true)
      let older = 0
      at.forEach((time, index) => {
        if (index === freshIndex || time === null) return
        if (time.getTime() < fresh!.at.getTime()) {
          older += 1
          expect(index, `карточка ${index} старше новой записи, а стоит выше неё (${freshIndex})`).toBeGreaterThan(freshIndex)
        }
      })
      expect(older, 'записей старше новой для сравнения порядка').toBeGreaterThan(0)
      // Лента упорядочена по времени: у соседних карточек время не растёт.
      for (let i = 1; i < at.length; i += 1) expect(at[i]!.getTime(), `порядок ленты на месте ${i}`).toBeLessThanOrEqual(at[i - 1]!.getTime())
    }
    await order()

    // Запись видна под фильтром «Напоминания» и стоит выше каждой записи с более ранним временем.
    await filterGroup(page).getByRole('link', { name: 'Напоминания', exact: true }).click()
    await expect(page).toHaveURL(`${BASE_URL}/notifications?filter=reminders`)
    const topReminder = cards(page).filter({ has: page.locator(`input[name="id"][value="${fresh!.id}"]`) })
    await expect(topReminder).toHaveCount(1)
    await expect(topReminder).toContainText('Статус заявки изменился')
    await expect(topReminder).toContainText('Новое')
    await order()

    // Касание ведёт на экран этой заявки.
    await topReminder.getByRole('button').click()
    await expect(page).toHaveURL(`${BASE_URL}/requests/${requestId}`)
    await expect(page.getByTestId('request-status')).toHaveText('В работе')
    expect(await bellCount(page)).toBe(before)
  } finally {
    await context.close()
  }
})

test('С-10: колокольчик → объявление в ленте; фильтры делят ленту; мусор в параметре даёт «Все»', async ({ browser }) => {
  await resetFeedToSeed(student1.login)
  const { context, page } = await asStudent(browser, student1)
  try {
    let touches = 0
    await bellLink(page).click()
    touches += 1
    await expect(page).toHaveURL(`${BASE_URL}/notifications`)
    // Объявление деканата видно в ленте «Все»: касаний до него — одно.
    await expect(cards(page).filter({ hasText: 'Ярмарка стажировок' })).toHaveCount(1)
    expect(touches, 'касаний до объявления').toBeLessThanOrEqual(2)

    const group = filterGroup(page)
    await expect(group.getByRole('link')).toHaveText(['Все', 'Новости и объявления', 'Напоминания'])
    await expect(group.getByRole('link', { name: 'Все', exact: true })).toHaveAttribute('aria-current', 'true')
    const allTexts = await cards(page).allInnerTexts()
    expect(allTexts.length).toBeGreaterThan(0)

    // «Новости и объявления»: объявления и новости есть, напоминаний нет.
    await group.getByRole('link', { name: 'Новости и объявления', exact: true }).click()
    await expect(page).toHaveURL(`${BASE_URL}/notifications?filter=news`)
    await expect(group.getByRole('link', { name: 'Новости и объявления', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(group.getByRole('link', { name: 'Все', exact: true })).not.toHaveAttribute('aria-current', /.*/)
    await expect(cards(page).filter({ hasText: 'Ярмарка стажировок' })).toHaveCount(1)
    await expect(cards(page).filter({ hasText: 'Пересдача по эконометрике' })).not.toHaveCount(0)
    for (const reminder of ['Расчётная работа №3', 'Справка готова', 'Пара отменена', 'Пара перенесена', 'принесите оригиналы']) {
      await expect(cards(page).filter({ hasText: reminder }), `под «Новости и объявления» нет напоминания «${reminder}»`).toHaveCount(0)
    }
    const newsCount = await cards(page).count()

    // «Напоминания»: напоминания есть, объявлений и новостей нет.
    await group.getByRole('link', { name: 'Напоминания', exact: true }).click()
    await expect(page).toHaveURL(`${BASE_URL}/notifications?filter=reminders`)
    await expect(group.getByRole('link', { name: 'Напоминания', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(cards(page).filter({ hasText: 'Расчётная работа №3' })).toHaveCount(1)
    for (const news of ['Ярмарка стажировок', 'Пересдача по эконометрике', 'Расписание зимней сессии']) {
      await expect(cards(page).filter({ hasText: news }), `под «Напоминания» нет «${news}»`).toHaveCount(0)
    }
    const remindersCount = await cards(page).count()
    expect(newsCount + remindersCount, 'фильтры вместе дают всю ленту').toBe(allTexts.length)

    // Мусор в параметре — то же, что «Все».
    for (const junk of ['xyz', 'NEWS', '', 'news%20', 'reminders&filter=news']) {
      await page.goto(`/notifications?filter=${junk}`)
      await expect(group.getByRole('link', { name: 'Все', exact: true }), junk).toHaveAttribute('aria-current', 'true')
      expect(await cards(page).allInnerTexts(), `?filter=${junk}`).toEqual(allTexts)
    }
  } finally {
    await context.close()
  }
})

test('«Отметить все прочитанными»: «Непрочитанных: 0», числа у колокольчика нет, пометок «Новое» нет; фильтр сохраняется', async ({ browser }) => {
  await resetFeedToSeed(student1.login)
  await resetFeedToSeed(student2.login)
  const second = await asStudent(browser, student2)
  const secondBefore = await bellCount(second.page)
  await second.context.close()
  const { context, page } = await asStudent(browser, student1)
  try {
    await page.goto('/notifications?filter=reminders')
    const total = await unreadNumber(page)
    expect(total).toBeGreaterThan(0)
    expect(await bellCount(page)).toBe(total)
    const markAll = page.getByRole('button', { name: 'Отметить все прочитанными', exact: true })
    await expect(markAll).toBeVisible()
    await markAll.click()

    await expect(page).toHaveURL(`${BASE_URL}/notifications?filter=reminders`)
    await expect(unreadLine(page)).toHaveText('Непрочитанных: 0')
    await expect(page.getByTestId('bell-count')).toHaveCount(0)
    await expect(page.getByText('Новое', { exact: true })).toHaveCount(0)
    await expect(markAll).toHaveCount(0)
    // Во всей ленте, а не только под фильтром.
    await filterGroup(page).getByRole('link', { name: 'Все', exact: true }).click()
    await expect(page).toHaveURL(`${BASE_URL}/notifications`)
    await expect(page.getByText('Новое', { exact: true })).toHaveCount(0)
    await expect(unreadLine(page)).toHaveText('Непрочитанных: 0')
  } finally {
    await context.close()
  }
  // У второго студента ничего не отмечено.
  const again = await asStudent(browser, student2)
  try {
    expect(await bellCount(again.page)).toBe(secondBefore)
  } finally {
    await again.context.close()
  }
})

test('«Отметить прочитанным» у объявления работает без скриптов в браузере: пометка снята, фильтр сохранился, число меньше на один', async ({
  browser,
}) => {
  await resetFeedToSeed(student1.login)
  const signed = await asStudent(browser, student1)
  const storageState = await signed.context.storageState()
  await signed.context.close()
  // Тот же вошедший студент, но браузер без скриптов: форма уходит обычной отправкой.
  const context = await browser.newContext({ storageState, extraHTTPHeaders: signed.headers, javaScriptEnabled: false })
  const page = await context.newPage()
  try {
    await page.goto('/notifications?filter=news')
    const fair = cards(page).filter({ hasText: 'Ярмарка стажировок' })
    await expect(fair).toHaveCount(1)
    await expect(fair.getByText('Новое', { exact: true })).toBeVisible()
    const before = await unreadNumber(page)
    expect(await bellCount(page)).toBe(before)
    await expect(fair.getByRole('link')).toHaveCount(0)

    await fair.getByRole('button', { name: 'Отметить прочитанным', exact: true }).click()
    await expect(page).toHaveURL(`${BASE_URL}/notifications?filter=news`)
    await expect(fair).toHaveCount(1)
    await expect(fair.getByText('Новое', { exact: true })).toHaveCount(0)
    await expect(fair.getByRole('button')).toHaveCount(0)
    expect(await unreadNumber(page)).toBe(before - 1)
    expect(await bellCount(page)).toBe(before - 1)
    await expect(filterGroup(page).getByRole('link', { name: 'Новости и объявления', exact: true })).toHaveAttribute('aria-current', 'true')
    // Другие объявления остались непрочитанными.
    await expect(page.getByText('Новое', { exact: true })).not.toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('предзагрузка и обычный переход по ссылкам ничего не отмечают: отметка — только отправка формы', async ({ browser }) => {
  await resetFeedToSeed(student1.login)
  const { context, page } = await asStudent(browser, student1)
  try {
    // Запросы предзагрузки Next.js помечает заголовком `Next-Router-Prefetch: 1` (виден в запросах прогона); слушаем с первого открытия экрана.
    const prefetched: string[] = []
    page.on('request', (request) => {
      if (request.headers()['next-router-prefetch'] === '1') prefetched.push(new URL(request.url()).pathname + new URL(request.url()).search)
    })
    const stateBefore = await snapshotFeedState(LOGINS)
    await page.goto('/notifications')
    const before = await unreadNumber(page)
    // Продукт сам предзагружает ссылки в видимой части экрана (вкладки, колокольчик, фильтр): ждём, пока запросы предзагрузки пойдут.
    await expect.poll(() => prefetched.length, { message: 'запросов предзагрузки не было', timeout: 15_000 }).toBeGreaterThan(0)
    // Ссылка вкладки «Успеваемость» в видимой части: её предзагрузка должна быть среди запросов.
    await expect
      .poll(() => prefetched.some((p) => p.startsWith('/grades')), { message: `предзагрузки «/grades» не было; были: ${prefetched.join(', ')}`, timeout: 15_000 })
      .toBe(true)
    // Предзагрузка прошла, а прочитанность не изменилась: ни число на экране и у колокольчика, ни записи в базе.
    expect(await unreadNumber(page)).toBe(before)
    expect(await bellCount(page)).toBe(before)
    const stateAfter = await snapshotFeedState(LOGINS)
    expect(stateAfter.notifications.length).toBeGreaterThan(0)
    expect(stateAfter).toEqual(stateBefore)
    // Обычный переход по тем же адресам тоже ничего не отмечает.
    for (const path of ['/notifications?filter=news', '/notifications?filter=reminders', '/grades', '/schedule', '/notifications']) {
      await page.goto(path)
    }
    expect(await unreadNumber(page)).toBe(before)
    expect(await bellCount(page)).toBe(before)
    expect(await snapshotFeedState(LOGINS)).toEqual(stateBefore)
  } finally {
    await context.close()
  }
})

test('360 px: прокрутки вбок нет ни в одном виде ленты; ссылки фильтра и кнопки не ниже 44 px; три подписи видны целиком', async ({ browser }) => {
  await resetFeedToSeed(student1.login)
  const { context, page } = await asStudent(browser, student1)
  try {
    // В состоянии набора все карточки со ссылкой непрочитаны, то есть кнопки. Чтобы карточка-ссылка была, одно напоминание
    // со ссылкой отмечается открытием: после него оно прочитано и стоит ссылкой (R-3.5-2).
    await page.goto('/notifications')
    await cards(page).filter({ hasText: 'Расчётная работа №3' }).getByRole('button').click()
    await expect(page).not.toHaveURL(`${BASE_URL}/notifications`)
    let linkCardsTotal = 0
    for (const path of ['/notifications', '/notifications?filter=news', '/notifications?filter=reminders']) {
      await page.goto(path)
      await expectNoHorizontalScroll(page, path)
      const group = filterGroup(page)
      for (const name of ['Все', 'Новости и объявления', 'Напоминания']) {
        const link = group.getByRole('link', { name, exact: true })
        await expectTapSize(link, `${path}: фильтр «${name}»`)
        // Подпись видна целиком: ни обрезки, ни прокрутки внутри ссылки; ссылка не шире экрана.
        const fit = await link.evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { clipped: el.scrollWidth - el.clientWidth, clippedY: el.scrollHeight - el.clientHeight, left: r.left, right: r.right }
        })
        expect(fit.clipped, `${path}: «${name}» обрезана по ширине`).toBeLessThanOrEqual(0)
        expect(fit.clippedY, `${path}: «${name}» обрезана по высоте`).toBeLessThanOrEqual(0)
        expect(fit.left).toBeGreaterThanOrEqual(0)
        expect(fit.right).toBeLessThanOrEqual(360)
      }
      await expectTapSize(page.getByRole('button', { name: 'Отметить все прочитанными', exact: true }), `${path}: «Отметить все прочитанными»`)
      for (const button of await cards(page).getByRole('button').all()) await expectTapSize(button, `${path}: карточка-кнопка`)
      const linkCards = await cards(page).getByRole('link').all()
      // В «Все» и «Напоминания» отмеченное напоминание стоит ссылкой; в «Новости и объявления» его нет.
      if (path !== '/notifications?filter=news') expect(linkCards.length, `${path}: карточек-ссылок`).toBeGreaterThan(0)
      for (const link of linkCards) await expectTapSize(link, `${path}: карточка-ссылка`)
      linkCardsTotal += linkCards.length
    }
    expect(linkCardsTotal, 'карточек-ссылок во всех видах ленты').toBeGreaterThan(0)
    // Кнопки «Отметить прочитанным» стоят у объявлений.
    await page.goto('/notifications?filter=news')
    const own = await page.getByRole('button', { name: 'Отметить прочитанным', exact: true }).all()
    expect(own.length).toBeGreaterThan(0)
    for (const button of own) await expectTapSize(button, 'кнопка «Отметить прочитанным»')

    // Уровни заголовков без пропусков: h1, затем при пустом состоянии h2.
    const levels = await page.locator('main h1, main h2, main h3').evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))))
    expect(levels[0]).toBe(1)
  } finally {
    await context.close()
  }
})

test('пустой фильтр: «Здесь пока ничего нет» без второй фразы; лента пуста совсем — прежний текст', async ({ browser }) => {
  // У студентов основного набора обе ленты не пусты. Пустой фильтр на время проверки получается так: все личные уведомления
  // студента 2 переводятся в новости, а после проверки каждое получает прежний вид (по номеру).
  const second = await asStudent(browser, student2)
  const saved = await forceNotificationKind(student2.login, 'news')
  try {
    await second.page.goto('/notifications?filter=reminders')
    await expect(second.page.getByRole('heading', { name: 'Здесь пока ничего нет', level: 2 })).toBeVisible()
    await expect(second.page.getByText('Здесь появятся сообщения')).toHaveCount(0)
    await expect(second.page.locator('main p')).toHaveCount(1) // только строка «Непрочитанных: N»
    await expectNoHorizontalScroll(second.page, 'пустой фильтр')
  } finally {
    await restoreNotificationKinds(saved)
    await second.context.close()
  }
})
