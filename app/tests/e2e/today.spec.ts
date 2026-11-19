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

/** Число пар сегодня по плану набора: без отменённых и без пар, перенесённых на другой день; перенесённые на сегодня считаются. */
function plannedCountToday(): number {
  return plan.lessons.filter((l) => {
    if (l.change?.kind === 'cancelled') return false
    const date = l.change?.kind === 'moved' ? (l.change.newDate ?? l.date) : l.date
    return date === today
  }).length
}

test('Э-2 на 360 px: подзаголовок, пять блоков, уровни заголовков, число строк по данным, прокрутки вбок нет', async ({ browser }) => {
  const { context, page } = await openToday(browser)
  try {
    // Подзаголовок: день недели, дата, число пар.
    const subtitle = page.locator('main p', { hasText: ` · ` }).first()
    const text = ((await subtitle.textContent()) ?? '').trim()
    const match = new RegExp(`^[А-ЯЁ][а-яё]+, ${formatDayMonth(today)} · (пар нет|(\\d+) пар[аы]?)$`).exec(text)
    expect(match, `подзаголовок «${text}»`).not.toBeNull()
    expect(match![2] === undefined ? 0 : Number(match![2]), 'число пар в подзаголовке').toBe(plannedCountToday())

    // Пять блоков: блок «следующая пара» и четыре с заголовками уровня 2.
    await expect(page.getByRole('region', { name: 'Следующая пара', exact: true })).toBeVisible()
    const titles = ['Изменения в расписании', 'Что сдать на этой неделе', 'Мои заявки', 'Объявления']
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

test('кнопка блока «следующая пара» ведёт на день этой пары', async ({ browser }) => {
  const { context, page } = await openToday(browser)
  try {
    const hero = page.getByRole('region', { name: 'Следующая пара', exact: true })
    await expect(hero).toBeVisible()
    if (plan.totalEntries === 0) {
      // В семи днях от сегодня у группы нет записей: блок говорит, что пар нет, кнопки нет.
      await expect(hero).toContainText('В ближайшие 7 дней пар нет')
      await expect(hero.getByRole('link')).toHaveCount(0)
      return
    }
    // Записи в семи днях есть. Какая из них «следующая», решают день и час запуска; тест читает ответ с экрана и сверяет с днём из семи.
    // Подпись — «Идёт сейчас» или «Следующая пара»; заголовок даты — «Сегодня», «Завтра, ср 18 ноября» или «Пт 20 ноября».
    const caption = ((await hero.getByTestId('next-caption').textContent()) ?? '').trim()
    expect(['Идёт сейчас', 'Следующая пара'], `подпись «${caption}»`).toContain(caption)
    const dateTitle = ((await hero.getByTestId('next-date').textContent()) ?? '').trim()
    const titleOf = (d: string): string =>
      d === today
        ? 'Сегодня'
        : d === tomorrow
          ? `Завтра, ${weekdayShort(d)} ${formatDayMonth(d)}`
          : `${weekdayShort(d).charAt(0).toUpperCase()}${weekdayShort(d).slice(1)} ${formatDayMonth(d)}`
    const date = plan.window.find((d) => dateTitle === titleOf(d))
    expect(date, `день из заголовка «${dateTitle}» не найден среди семи дней`).toBeDefined()
    const expectedDate = date!
    const expectedHref = expectedDate === today ? '/schedule' : `/schedule?day=${expectedDate}`
    if (expectedDate === today) {
      // Пара сегодня: «Идёт сейчас» или «Следующая пара»; плашки «пары закончились» нет.
      await expect(page.getByTestId('day-status')).toHaveCount(0)
    } else {
      expect(expectedDate > today, 'другой день позже сегодняшнего').toBe(true)
      expect(caption, 'у пары другого дня «Идёт сейчас» не бывает').toBe('Следующая пара')
    }
    // Время «следующей пары» стоит отдельной строкой: «10:10 – 11:40».
    await expect(hero.locator('.hero-time')).toHaveText(/^\d{2}:\d{2}\s–\s\d{2}:\d{2}$/)
    const name = ((await hero.getByTestId('next-discipline').textContent()) ?? '').trim()
    expect(name.length, 'название пары').toBeGreaterThan(0)

    const button = hero.getByRole('link', { name: /^Расписание на / })
    await expect(button).toHaveCount(1)
    await expect(button).toHaveText(expectedDate === today ? 'Расписание на сегодня' : `Расписание на ${formatDayMonth(expectedDate)}`)
    await expect(button).toHaveAttribute('href', expectedHref)
    const box = await button.boundingBox()
    expect(box!.height, 'высота кнопки').toBeGreaterThanOrEqual(44)
    await button.click()
    await expect(page).toHaveURL(`${BASE_URL}${expectedHref}`)
    await expect(
      page.getByRole('heading', { name: expectedDate === today ? /Расписание на сегодня/ : `Расписание на ${formatDayMonth(expectedDate)}`, level: 1 }),
    ).toBeVisible()
    // Эта пара стоит на этом дне расписания.
    await expect(page.getByRole('heading', { name }).first()).toBeVisible()
    expect(addDays(today, 6) >= expectedDate).toBe(true)
  } finally {
    await context.close()
  }
})
