// Редизайн, заход В: каркас на компьютере (макет М5) и «Идеи и планы» (макет М6). Данные — основной набор вымышленных аккаунтов.
// Файл только читает: ничего не подаёт и не отмечает. Что зависит от дня и часа запуска (пары сегодня, работы на неделе), сравнивается
// с числами той же страницы, а не с постоянной: в воскресенье пар сегодня ноль, и тест остаётся верным.
// Проверка прокрутки вбок сначала убеждается, что окно нужной ширины (ошибка ИИ 115).
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { resetFeedToSeed } from './helpers/db'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')
const staff = MAIN_COHORT.staff

const group = MAIN_COHORT.groups.find((g) => g.name === student1.groupName)
if (!group) throw new Error('У студента нет группы в наборе')
const SEMESTER = Math.max(...group.disciplines.map((d) => d.semester))

const CONCEPT = 'Концепт для конкурса, не официальный сервис вуза'
const IDEAS_TITLES = ['Помощник по правилам деканата', 'Сдача работ в кабинете', 'Напоминания по времени']

let server: RunningServer | null = null

test.beforeAll(async () => {
  await resetFeedToSeed(student1.login)
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

async function openAsStudent(browser: Browser, width: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newContext(browser, width)
  const page = await context.newPage()
  await signIn(page, student1!.login, student1!.password, '/')
  await expect(page.getByRole('heading', { name: 'Сегодня', level: 1 })).toBeVisible()
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

/** Единственная видимая навигация «Разделы». */
const sections = (page: Page): Locator => page.getByRole('navigation', { name: 'Разделы' })

/** Блок «Ждёт вас» (components/today/waiting-block.tsx): секция с заголовком и список `data-testid="waiting"` с хотя бы одной строкой. */
async function expectWaitingBlock(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Ждёт вас', level: 2 })).toBeVisible()
  const list = page.getByTestId('waiting')
  await expect(list).toBeVisible()
  expect(await list.locator('li[data-kind]').count(), 'строк в «Ждёт вас»').toBeGreaterThan(0)
}

/** Число у колокольчика: нет числа — 0. */
async function bellNumber(page: Page): Promise<number> {
  const bell = page.getByTestId('bell-count')
  return (await bell.count()) === 0 ? 0 : Number((await bell.textContent())!.trim())
}

// ---------- 1280: колонка разделов, шапка, «Ждёт вас» ----------

test('1280: колонка разделов — две группы, шесть ссылок, одна навигация; счётчик «Уведомлений» равен числу у колокольчика', async ({ browser }) => {
  const { context, page } = await openAsStudent(browser, 1280)
  try {
    const nav = sections(page)
    await expect(nav).toHaveCount(1)
    await expect(nav).toBeVisible()
    // Нижней панели в дереве доступности нет: она скрыта `display: none`.
    await expect(page.locator('[data-tabbar]')).toBeHidden()
    await expect(page.locator('[data-tabbar]')).toHaveCSS('display', 'none')

    // Подписи двух групп и ссылки по порядку.
    for (const caption of ['Учёба', 'Деканат']) await expect(nav.getByText(caption, { exact: true })).toBeVisible()
    const links = nav.getByRole('link')
    await expect(links).toHaveCount(6)
    const names = (await links.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())
    expect(names.slice(0, 3)).toEqual(['Сегодня', 'Расписание', 'Успеваемость'])
    expect(names[3]).toBe('Заявки')
    expect(names[4]).toMatch(/^Уведомления/)
    expect(names[5]).toBe('Идеи и планы')
    await expect(nav.getByRole('link', { name: 'Идеи и планы', exact: true })).toHaveAttribute('href', '/ideas')

    // Счётчик: то же число, что у колокольчика; у него есть скрытая приставка «Новых: ».
    const bell = await bellNumber(page)
    expect(bell, 'после сброса ленты есть непрочитанное — иначе проверка пуста').toBeGreaterThan(0)
    const count = nav.getByTestId('side-count')
    await expect(count).toHaveCount(1)
    await expect(count).toHaveText(`Новых: ${bell}`)
    expect(((await count.evaluate((el) => el.lastChild?.textContent)) ?? '').trim()).toBe(String(bell))
    await expect(nav.getByRole('link', { name: /^Уведомления/ })).toHaveAccessibleName(new RegExp(`Новых: ${bell}$`))

    // Активный раздел один — «Сегодня».
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(nav.getByRole('link', { name: 'Сегодня', exact: true })).toHaveAttribute('aria-current', 'page')
    await expectNoHorizontalScroll(page, 1280, '1280 «Сегодня»')
  } finally {
    await context.close()
  }
})

test('1280: колонка шириной 240 px; на «Уведомлениях» и «Идеях и планах» активна своя ссылка', async ({ browser }) => {
  const { context, page } = await openAsStudent(browser, 1280)
  try {
    const nav = sections(page)
    // Точная ширина по макету М5, а не «не меньше»: R-4.6-12 (RV-redesign-C-1).
    expect((await nav.boundingBox())!.width, 'ширина колонки на 1280').toBeCloseTo(240, 0)

    await nav.getByRole('link', { name: /^Уведомления/ }).click()
    await expect(page).toHaveURL(`${BASE_URL}/notifications`)
    await expect(sections(page).locator('[aria-current="page"]')).toHaveCount(1)
    await expect(sections(page).getByRole('link', { name: /^Уведомления/ })).toHaveAttribute('aria-current', 'page')

    await sections(page).getByRole('link', { name: 'Идеи и планы', exact: true }).click()
    await expect(page).toHaveURL(`${BASE_URL}/ideas`)
    await expect(page.getByRole('heading', { name: 'Идеи и планы', level: 1 })).toBeVisible()
    await expect(sections(page).locator('[aria-current="page"]')).toHaveCount(1)
    await expect(sections(page).getByRole('link', { name: 'Идеи и планы', exact: true })).toHaveAttribute('aria-current', 'page')
    await expectNoHorizontalScroll(page, 1280, '1280 /ideas')
  } finally {
    await context.close()
  }
})

test('1024: колонка уже, одна навигация, блок «Ждёт вас» виден', async ({ browser }) => {
  const context = await newContext(browser, 1024)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await expect(sections(page)).toHaveCount(1)
    const width = (await sections(page).boundingBox())!.width
    // Точная ширина по макету М5: R-4.6-12 (RV-redesign-C-1).
    expect(width, 'ширина колонки на 1024').toBeCloseTo(220, 0)
    await expectWaitingBlock(page)
    await expectNoHorizontalScroll(page, 1024, '1024 «Сегодня»')
  } finally {
    await context.close()
  }
})

test('шапка на всех ширинах: группа · неделя · семестр; на 360 и 390 строка не раздвигает страницу, кнопки не меньше 44 px', async ({ browser }) => {
  for (const width of [360, 390, 1280]) {
    const { context, page } = await openAsStudent(browser, width)
    try {
      const header = page.locator('header')
      const line = header.getByText(student1!.groupName)
      await expect(line).toHaveCount(1)
      const text = ((await line.textContent()) ?? '').trim()
      expect(text, `шапка на ${width}`).toMatch(new RegExp(`^${student1!.groupName} · \\d+ неделя, (верхняя|нижняя) · ${SEMESTER} семестр$`))
      // Текст виден целиком: у строки нет скрытой обрезки.
      const clipped = await line.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
      expect(clipped, `шапка на ${width}: строка обрезана`).toBe(false)
      for (const name of ['Уведомления', 'Профиль']) {
        const box = await header.getByRole('link', { name: new RegExp(`^${name}`) }).boundingBox()
        expect(box!.width, `${name} на ${width}: ширина`).toBeGreaterThanOrEqual(44)
        expect(box!.height, `${name} на ${width}: высота`).toBeGreaterThanOrEqual(44)
      }
      await expectNoHorizontalScroll(page, width, `шапка на ${width}`)
    } finally {
      await context.close()
    }
  }
})

test('1280 «Сегодня»: плиток KPI нет; блок «Ждёт вас» — заголовок, строки, в каждой одна ссылка-глагол внутрь кабинета', async ({ browser }) => {
  const { context, page } = await openAsStudent(browser, 1280)
  try {
    // Плитки убраны в дизайн-проходе 19.11: их места в странице нет.
    await expect(page.getByTestId('kpis')).toHaveCount(0)
    await expectWaitingBlock(page)
    const rows = page.getByTestId('waiting').locator('li[data-kind]')
    const total = await rows.count()
    expect(total, 'строк в «Ждёт вас» у студента в наборе').toBeGreaterThan(0)
    let seen = 0
    for (let i = 0; i < total; i += 1) {
      const links = rows.nth(i).getByRole('link')
      await expect(links, `строка ${i + 1}: одна ссылка`).toHaveCount(1)
      await expect(links.first(), `строка ${i + 1}: адрес внутри кабинета`).toHaveAttribute('href', /^\//)
      seen += 1
    }
    expect(seen, 'строк проверено').toBe(total)
  } finally {
    await context.close()
  }
})

test('1280 «Сегодня»: «Ждёт вас» стоит над «билетом»; изменения и три блока на месте', async ({ browser }) => {
  const { context, page } = await openAsStudent(browser, 1280)
  try {
    const waiting = await page.getByRole('region', { name: 'Ждёт вас', exact: true }).boundingBox()
    const ticket = await page.getByRole('region', { name: 'Следующая пара', exact: true }).boundingBox()
    expect(waiting!.y + waiting!.height, '«Ждёт вас» над «билетом»').toBeLessThanOrEqual(ticket!.y)
    for (const title of ['Изменения в расписании', 'Что сдать на этой неделе', 'Мои заявки', 'Объявления']) {
      await expect(page.getByRole('heading', { name: new RegExp(`^${title}`), level: 2 })).toBeVisible()
    }
  } finally {
    await context.close()
  }
})

// ---------- «Идеи и планы» ----------

test('1280 /ideas: заголовок, вступление, три идеи — две в первом ряду, одна во втором, в карточках нет ссылок и кнопок', async ({ browser }) => {
  const { context, page } = await openAsStudent(browser, 1280)
  try {
    await page.goto('/ideas')
    await expect(page.getByRole('heading', { name: 'Идеи и планы', level: 1 })).toBeVisible()
    await expect(page.getByText('Что мы добавили бы в кабинет, будь у нас больше времени. Это планы, а не работающие функции', { exact: true })).toBeVisible()
    const cards = page.locator('main article')
    await expect(cards).toHaveCount(3)
    for (const title of IDEAS_TITLES) await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible()
    await expect(page.locator('main article a, main article button, main article [role="button"], main article [role="link"]')).toHaveCount(0)
    // Две в первом ряду, одна во втором: у первых двух карточек одна верхняя граница, у третьей — другая, ниже.
    const boxes = await Promise.all([0, 1, 2].map((i) => cards.nth(i).boundingBox()))
    expect(Math.round(boxes[0]!.y)).toBe(Math.round(boxes[1]!.y))
    expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1)
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width - 1)
    // Пунктирная рамка.
    await expect(cards.first()).toHaveCSS('border-top-style', 'dashed')
    // На компьютере ссылки внизу страницы нет: вход — в колонке.
    await expect(page.locator('[data-ideas-link]')).toBeHidden()
  } finally {
    await context.close()
  }
})

test('360: блок «Ждёт вас» виден, нижняя панель из четырёх вкладок, ссылка «Идеи и планы» внизу ведёт на /ideas; прокрутки вбок нет', async ({ browser }) => {
  const { context, page } = await openAsStudent(browser, 360)
  try {
    // Плиток KPI нет совсем; на телефоне главное на экране — блок «Ждёт вас».
    await expect(page.getByTestId('kpis')).toHaveCount(0)
    await expectWaitingBlock(page)

    // Одна навигация «Разделы» — нижняя панель, в ней четыре вкладки.
    const nav = sections(page)
    await expect(nav).toHaveCount(1)
    await expect(nav).toHaveAttribute('data-tabbar')
    await expect(nav.getByRole('link')).toHaveCount(4)
    expect((await nav.getByRole('link').allTextContents()).map((t) => t.trim())).toEqual(['Сегодня', 'Расписание', 'Успеваемость', 'Заявки'])
    await expect(page.locator('[data-sidenav]')).toBeHidden()
    await expect(page.locator('[data-sidenav]')).toHaveCSS('display', 'none')

    // Ссылка внизу страницы: вне навигации «Разделы», над общим подвалом, зона касания не меньше 44 px.
    const link = page.getByRole('link', { name: 'Идеи и планы', exact: true })
    await expect(link).toHaveCount(1)
    await expect(nav.getByRole('link', { name: 'Идеи и планы' })).toHaveCount(0)
    const linkBox = (await link.boundingBox())!
    expect(linkBox.height, 'зона касания ссылки').toBeGreaterThanOrEqual(44)
    const mainBox = (await page.locator('main').boundingBox())!
    const footerBox = (await page.locator('footer').boundingBox())!
    await expect(page.locator('footer')).toContainText(CONCEPT)
    expect(linkBox.y, 'ссылка ниже содержимого').toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 1)
    expect(linkBox.y + linkBox.height, 'ссылка над подвалом').toBeLessThanOrEqual(footerBox.y + 1)

    await expectNoHorizontalScroll(page, 360, '360 «Сегодня»')
    await link.click()
    await expect(page).toHaveURL(`${BASE_URL}/ideas`)
    await expect(page.getByRole('heading', { name: 'Идеи и планы', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Идеи и планы', exact: true })).toHaveAttribute('aria-current', 'page')
    await expectNoHorizontalScroll(page, 360, '360 /ideas')

    // Три карточки друг под другом, без ссылок и кнопок.
    const cards = page.locator('main article')
    await expect(cards).toHaveCount(3)
    const boxes = await Promise.all([0, 1, 2].map((i) => cards.nth(i).boundingBox()))
    for (let i = 1; i < 3; i += 1) expect(boxes[i]!.y, `карточка ${i} под предыдущей`).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height - 1)
    await expect(page.locator('main article a, main article button')).toHaveCount(0)
    await expect(nav.getByRole('link')).toHaveCount(4)
  } finally {
    await context.close()
  }
})

test('360 /ideas без прокрутки вбок и на 390', async ({ browser }) => {
  for (const width of [360, 390]) {
    const { context, page } = await openAsStudent(browser, width)
    try {
      await page.goto('/ideas')
      await expect(page.locator('main article')).toHaveCount(3)
      await expectNoHorizontalScroll(page, width, `/ideas на ${width}`)
    } finally {
      await context.close()
    }
  }
})

// ---------- доступ ----------

test('гость на /ideas — на /login; на входе ссылки «Идеи и планы» нет ни на 360, ни на 1280', async ({ browser }) => {
  for (const width of [360, 1280]) {
    const context = await newContext(browser, width)
    try {
      const page = await context.newPage()
      await page.goto('/ideas')
      await expect(page).toHaveURL(`${BASE_URL}/login`)
      await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Идеи и планы' })).toHaveCount(0)
      await expect(page.getByText('Идеи и планы')).toHaveCount(0)
    } finally {
      await context.close()
    }
  }
})

test('сотрудник на /ideas получает тот же ответ, что и на другой странице студента; ссылки «Идеи и планы» у сотрудника нет', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, staff.login, staff.password, '/staff/requests')
    await expect(page.getByRole('link', { name: 'Идеи и планы' })).toHaveCount(0)
    const other = await page.goto('/schedule')
    const ideas = await page.goto('/ideas')
    expect(other!.status(), 'другая страница студента').toBe(403)
    expect(ideas!.status(), '/ideas').toBe(other!.status())
    await expect(page.getByRole('heading', { name: 'Идеи и планы' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Идеи и планы' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
