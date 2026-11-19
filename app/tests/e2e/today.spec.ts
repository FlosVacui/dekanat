// Экран «Сегодня» на 360×800 (пакет 3.6, S-2.1: Э-2; требования ЗД-1, ЗД-2, ЯД-2…ЯД-5, ТР-4).
// Данные — основной набор вымышленных аккаунтов (ТР-5, ТР-11). Что зависит от дня и часа запуска, берётся из базы или из плана набора,
// а не из часов теста; ветки по часу («Идёт сейчас», «пара кончилась») проверяет модульный тест tests/unit/today.test.ts.
// Касания считаются по правилам S-2.1, раздел 1: каждое касание — клик по ссылке или кнопке; прокрутка не считается.
// Каждая проверка в цикле ведёт счёт шагов и сверяет, что цикл шёл больше нуля раз.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addDays, endOfWeek, formatDayMonth, todayIn, weekdayShort } from '../../src/lib/dates'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { addAssignment, dueRecords, removeAssignments, requestNewsCount, resetFeedToSeed, unreadAnnouncementCount, type DueRecord } from './helpers/db'
import { planSchedule } from './helpers/schedule-plan'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')

const today = todayIn('Europe/Moscow')
const tomorrow = addDays(today, 1)
const plan = planSchedule(today)

let server: RunningServer | null = null
const createdAssignments: string[] = []
let tempDue: DueRecord | null = null

test.beforeAll(async () => {
  await resetFeedToSeed(student1.login)
  // Работа со сроком «сегодня»: блок «Что сдать на этой неделе» не пуст в любой день запуска (в воскресенье неделя кончается сегодня).
  tempDue = await addAssignment(student1.login, 'Проверочная работа пакета 3.6', today)
  createdAssignments.push(tempDue.id)
  server = await startServer()
})
test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
  await removeAssignments(createdAssignments)
})

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth, `${where}: ширина окна`).toBe(360)
}

async function openToday(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ extraHTTPHeaders: addressHeaders(freshAddress()) })
  const page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, student1!.login, student1!.password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}/`)
  await expect(page.getByRole('heading', { name: 'Сегодня', level: 1 })).toBeVisible()
  return { context, page }
}

// Имя секции — её заголовок; у «Объявлений» в заголовке стоит ещё плашка «Новых: N», поэтому имя ищется по началу.
const block = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name}`) })

/** Строки экрана, которые ведут в разделы: ссылки внутри блоков под заголовками уровня 2 и кнопка блока «следующая пара». */
const mainLinks = (page: Page) => page.locator('main').getByRole('link')

test('Э-2 на 360 px: заголовок-дата, шесть блоков, уровни заголовков, число строк по данным, прокрутки вбок нет', async ({ browser }) => {
  const { context, page } = await openToday(browser)
  try {
    // Заголовок — дата: день недели и число («Четверг, 19 ноября»); слово «Сегодня» в нём только для экранного чтеца.
    const heading = ((await page.getByRole('heading', { level: 1 }).textContent()) ?? '').trim()
    expect(heading, `заголовок «${heading}»`).toMatch(new RegExp(`^(Сегодня: )?[А-ЯЁ][а-яё]+, ${formatDayMonth(today)}$`))
    // Подпись — группа и неделя: «ИТ-23-04 · 11 неделя, верхняя».
    const subtitle = ((await page.locator('main p', { hasText: ' неделя, ' }).first().textContent()) ?? '').trim()
    expect(subtitle, `подпись «${subtitle}»`).toMatch(/ · \d+ неделя, (верхняя|нижняя)$/)

    // Шесть блоков: блок «следующая пара» и пять с заголовками уровня 2 («Ждёт вас» первым).
    await expect(page.getByRole('region', { name: 'Следующая пара', exact: true })).toBeVisible()
    const titles = ['Ждёт вас', 'Изменения в расписании', 'Что сдать на этой неделе', 'Мои заявки', 'Объявления']
    for (const title of titles) await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible()

    // Уровни заголовков без пропусков.
    const levels = await page.locator('main h1, main h2, main h3').evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))))
    expect(levels.length, 'заголовков на экране').toBeGreaterThan(0)
    expect(levels[0]).toBe(1)
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]!, `заголовок ${i}: пропуск уровня`).toBeLessThanOrEqual(levels[i - 1]! + 1)

    // Объявления: плашка «Новых: N» и строки — по базе.
    const unread = await unreadAnnouncementCount(student1.login)
    const announcements = block(page, 'Объявления')
    if (unread > 0) {
      await expect(page.getByRole('heading', { name: 'Объявления', level: 2 })).toContainText(`Новых: ${unread}`)
      await expect(announcements.getByRole('link')).toHaveCount(unread)
      for (const link of await announcements.getByRole('link').all()) await expect(link).toHaveAttribute('href', '/notifications?filter=news')
    } else {
      await expect(announcements).toContainText('Новых объявлений нет')
      await expect(page.getByText('Новых:')).toHaveCount(0)
    }

    // Заявки: строки — по базе; у каждой плашка статуса.
    const news = await requestNewsCount(student1.login)
    const requests = block(page, 'Мои заявки')
    // Пакет 4.1: в блоке ещё ссылка «Спросить деканат» на /questions/new — ровно одна; остальные ссылки — строки заявок.
    await expect(requests.getByRole('link', { name: 'Спросить деканат', exact: true })).toHaveAttribute('href', '/questions/new')
    const rows = requests.getByRole('link').filter({ hasNotText: /^Спросить деканат$/ })
    await expect(requests.getByRole('link')).toHaveCount(news + 1)
    if (news > 0) {
      await expect(rows).toHaveCount(news)
      for (const link of await rows.all()) await expect(link).toHaveAttribute('href', /^\/requests\/[0-9a-f-]{36}$/)
    } else {
      await expect(requests).toContainText('Новостей по заявкам нет')
    }

    // Что сдать: все работы недели из базы, у каждой своя ссылка на дисциплину; у работы со сроком «сегодня» плашка «Сегодня».
    const due = await dueRecords(student1.login, today, endOfWeek(today))
    expect(due.length, 'работ на неделе (есть созданная тестом)').toBeGreaterThan(0)
    const dueBlock = block(page, 'Что сдать на этой неделе')
    await expect(dueBlock.getByRole('link')).toHaveCount(due.length)
    const hrefs = await dueBlock.getByRole('link').evaluateAll((els) => els.map((el) => el.getAttribute('href')))
    expect(hrefs.slice().sort()).toEqual(due.map((d) => `/grades/${d.disciplineId}`).sort())
    await expect(dueBlock.getByRole('link').filter({ hasText: tempDue!.title })).toContainText('Сегодня')

    // Изменения: либо строки со ссылками в расписание, либо прежнее «пусто».
    const changes = block(page, 'Изменения в расписании')
    const changeLinks = await changes.getByRole('link').all()
    if (changeLinks.length === 0) await expect(changes).toContainText('На сегодня и завтра изменений нет')
    for (const link of changeLinks) await expect(link).toHaveAttribute('href', /^\/schedule(\?day=\d{4}-\d{2}-\d{2})?$/)

    // Зоны касания: каждая ссылка внутри экрана не ниже 44 px; ссылок больше нуля.
    const links = await mainLinks(page).all()
    expect(links.length, 'ссылок на экране').toBeGreaterThan(0)
    for (const link of links) {
      const box = await link.boundingBox()
      expect(box, 'ссылка без рамки').not.toBeNull()
      expect(box!.height, `высота зоны касания (${(await link.textContent())?.trim().slice(0, 40)})`).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
    await expectNoHorizontalScroll(page, 'Э-2')
  } finally {
    await context.close()
  }
})

test('ЗД-1: с главного экрана к каждому из пяти разделов — одно касание', async ({ browser }) => {
  const { context, page } = await openToday(browser)
  try {
    const nav = page.getByRole('navigation', { name: 'Разделы' })
    const unread = await unreadAnnouncementCount(student1.login)
    const news = await requestNewsCount(student1.login)
    const cases: { name: string; target: () => ReturnType<Page['getByRole']>; url: string | RegExp }[] = [
      { name: 'Расписание — вкладка', target: () => nav.getByRole('link', { name: 'Расписание', exact: true }), url: `${BASE_URL}/schedule` },
      { name: 'Успеваемость — вкладка', target: () => nav.getByRole('link', { name: 'Успеваемость', exact: true }), url: `${BASE_URL}/grades` },
      { name: 'Заявки — вкладка', target: () => nav.getByRole('link', { name: 'Заявки', exact: true }), url: `${BASE_URL}/requests` },
      { name: 'Уведомления — колокольчик', target: () => page.getByRole('link', { name: /^Уведомления, непрочитанных: \d+$/ }), url: `${BASE_URL}/notifications` },
      { name: 'Профиль — аватар', target: () => page.getByRole('link', { name: 'Профиль', exact: true }), url: `${BASE_URL}/profile` },
    ]
    if (unread > 0) {
      cases.push({
        name: 'Уведомления — строка объявления',
        target: () => block(page, 'Объявления').getByRole('link').first(),
        url: `${BASE_URL}/notifications?filter=news`,
      })
    }
    if (news > 0) {
      cases.push({ name: 'Заявки — строка заявки', target: () => block(page, 'Мои заявки').getByRole('link').first(), url: new RegExp(`^${BASE_URL}/requests/[0-9a-f-]{36}$`) })
    }
    let steps = 0
    for (const c of cases) {
      await test.step(`${c.name}: одно касание`, async () => {
        await page.goto('/')
        const target = c.target()
        await expect(target).toBeVisible()
        const box = await target.boundingBox()
        expect(box, `${c.name}: нет рамки`).not.toBeNull()
        expect(box!.height, `${c.name}: высота зоны касания`).toBeGreaterThanOrEqual(44)
        expect(box!.width, `${c.name}: ширина зоны касания`).toBeGreaterThanOrEqual(44)
        let touches = 0
        await target.click()
        touches += 1
        await expect(page).toHaveURL(c.url)
        expect(touches, `${c.name}: касаний`).toBe(1)
        steps += 1
      })
    }
    expect(steps, 'сколько путей проверено').toBe(cases.length)
    expect(steps).toBeGreaterThanOrEqual(5)
  } finally {
    await context.close()
  }
})

test('строка «что сдать» ведёт на экран своей дисциплины: название дисциплины на нём', async ({ browser }) => {
  const { context, page } = await openToday(browser)
  try {
    const due = tempDue!
    const row = block(page, 'Что сдать на этой неделе').getByRole('link').filter({ hasText: due.title })
    await expect(row).toHaveCount(1)
    await expect(row).toHaveAttribute('href', `/grades/${due.disciplineId}`)
    await row.click()
    await expect(page).toHaveURL(`${BASE_URL}/grades/${due.disciplineId}`)
    await expect(page.getByText(due.discipline).first()).toBeVisible()
    await expect(page).not.toHaveURL(`${BASE_URL}/grades`)
  } finally {
    await context.close()
  }
})

test('блок «следующая пара»: время и «до …», подпись; ссылка «Расписание на неделю» ведёт в недельный вид', async ({ browser }) => {
  const { context, page } = await openToday(browser)
  try {
    const hero = page.getByRole('region', { name: 'Следующая пара', exact: true })
    await expect(hero).toBeVisible()
    if (plan.totalEntries === 0) {
      // В семи днях от сегодня у группы нет записей: блок говорит, что пар нет, ссылки нет.
      await expect(hero).toContainText('В ближайшие 7 дней пар нет')
      await expect(page.getByRole('link', { name: 'Расписание на неделю' })).toHaveCount(0)
      return
    }
    // Подпись — «Идёт сейчас» или «Следующая пара»; у пары другого дня над названием стоит заголовок даты («Завтра, ср 18 ноября», «Пт 20 ноября»),
    // у сегодняшней его нет: заголовок экрана и так дата.
    const caption = ((await hero.getByTestId('next-caption').textContent()) ?? '').trim()
    expect(['Идёт сейчас', 'Следующая пара'], `подпись «${caption}»`).toContain(caption)
    const dateTitles = hero.getByTestId('next-date')
    if ((await dateTitles.count()) === 0) {
      await expect(page.getByTestId('day-status')).toHaveCount(0)
    } else {
      const dateTitle = ((await dateTitles.textContent()) ?? '').trim()
      const titleOf = (d: string): string =>
        d === tomorrow
          ? `Завтра, ${weekdayShort(d)} ${formatDayMonth(d)}`
          : `${weekdayShort(d).charAt(0).toUpperCase()}${weekdayShort(d).slice(1)} ${formatDayMonth(d)}`
      const date = plan.window.find((d) => d !== today && dateTitle === titleOf(d))
      expect(date, `день из заголовка «${dateTitle}» не найден среди семи дней`).toBeDefined()
      expect(caption, 'у пары другого дня «Идёт сейчас» не бывает').toBe('Следующая пара')
    }
    // Время — крупно, под ним «до 11:40»; аудитория названа.
    await expect(hero.locator('.hero-time')).toHaveText(/^\d{2}:\d{2} до \d{2}:\d{2}$/)
    const name = ((await hero.getByTestId('next-discipline').textContent()) ?? '').trim()
    expect(name.length, 'название пары').toBeGreaterThan(0)
    await expect(hero.getByTestId('next-room')).toContainText('Аудитория')

    const link = page.getByRole('link', { name: 'Расписание на неделю', exact: true })
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute('href', '/schedule?view=week')
    const box = await link.boundingBox()
    expect(box!.height, 'высота ссылки').toBeGreaterThanOrEqual(44)
    await link.click()
    await expect(page).toHaveURL(`${BASE_URL}/schedule?view=week`)
  } finally {
    await context.close()
  }
})
