// Сквозные тесты экрана «Расписание» (пакет 3.2, строка ЯД-2): на экране 360×800. Данные — основной набор вымышленных аккаунтов.
// Дни для проверок ищутся по данным плана набора (helpers/schedule-plan.ts), а не по номеру дня недели: тесты зелёные при любом дне запуска.
// Касания считаются по правилам S-2.1, раздел 1: счёт идёт от экрана «Сегодня»; С-2 и С-3 — по два касания.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addDays, formatDayMonth, todayIn, weekdayShort, weekInfo } from '../../src/lib/dates'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { dayPath, planSchedule, type ExpectedEntry, type PlannedPlacement } from './helpers/schedule-plan'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')
const today = todayIn('Europe/Moscow')
const tomorrow = addDays(today, 1)
const plan = planSchedule(today)

let server: RunningServer | null = null
let context: BrowserContext
let page: Page

test.use({ extraHTTPHeaders: addressHeaders() })
// Один вход на весь файл: тесты идут по порядку в одном окне браузера.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  server = await startServer()
  context = await browser.newContext()
  page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, student1.login, student1.password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}/`)
})

test.afterAll(async () => {
  await context?.close()
  if (server) await stopServer(server)
  server = null
})

/** Касание: зона не меньше 44×44 пикселей (ЗД-5), затем одно нажатие. */
async function touch(counter: { n: number }, target: Locator, name: string): Promise<void> {
  await test.step(`Касание ${counter.n + 1}: ${name}`, async () => {
    await expect(target).toBeVisible()
    const box = await target.boundingBox()
    expect(box, `${name}: нет рамки`).not.toBeNull()
    expect(box!.height, `${name}: высота зоны касания`).toBeGreaterThanOrEqual(44)
    expect(box!.width, `${name}: ширина зоны касания`).toBeGreaterThanOrEqual(44)
    await target.click()
    counter.n += 1
  })
}

async function expectNoHorizontalScroll(where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth, `${where}: ширина окна`).toBe(360)
}

async function expectTapSize(links: Locator, expected: number, where: string): Promise<void> {
  await expect(links, `${where}: число кнопок`).toHaveCount(expected)
  for (let i = 0; i < expected; i += 1) {
    const box = await links.nth(i).boundingBox()
    expect(box, `${where}, кнопка ${i + 1}: нет рамки`).not.toBeNull()
    expect(box!.width, `${where}, кнопка ${i + 1}: ширина`).toBeGreaterThanOrEqual(44)
    expect(box!.height, `${where}, кнопка ${i + 1}: высота`).toBeGreaterThanOrEqual(44)
  }
}

const tab = () => page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Расписание', exact: true })
const strip = () => page.getByRole('navigation', { name: 'Дни недели' })
const dayLink = (date: string) => strip().locator(`a[href="${dayPath(date)}"]`)

async function openToday(): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Сегодня', level: 1 })).toBeVisible()
}

async function expectLineThrough(target: Locator, what: string): Promise<void> {
  const line = await target.evaluate((el) => getComputedStyle(el).textDecorationLine)
  expect(line, `${what}: зачёркивание`).toContain('line-through')
}

/** Запись плана, которую тест ищет на экране: пара из плана на нужном дне и месте. Нет такой — ошибка набора, а не тихий пропуск. */
function wanted(scenario: ExpectedEntry['scenario'], placement: PlannedPlacement): ExpectedEntry {
  const found = plan.expected.find((e) => e.scenario === scenario && e.placement === placement)
  if (!found) throw new Error(`В плане на ${today} нет записи «${scenario}», место ${placement}`)
  return found
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Карточка пары в виде «День»: дисциплина (заголовок, у отменённой с приписью «, отменено») и время на этом месте.
 * Ищется по данным плана, а не как «первая карточка со строкой «Было»»: на дне таких карточек может быть несколько.
 */
function card(entry: ExpectedEntry): Locator {
  const title = new RegExp(`^${escapeRegExp(entry.lesson.discipline)}(\\s*,\\s*отменено)?$`)
  return page
    .locator('li')
    .filter({ has: page.getByRole('heading', { level: 2, name: title }) })
    .filter({ has: page.locator('b', { hasText: new RegExp(`^${escapeRegExp(entry.startsAt)}$`) }) })
}

test('данные: в плане набора есть отмена, перенос внутри дня, смена аудитории, замена преподавателя и перенос на другой день', () => {
  // Если этого нет, остальные тесты проверяют пустоту. Пустой день есть не всегда: что тест делает без него — в тесте «пустой день».
  expect(plan.cancelled, 'в окне нет отменённой пары').toBeDefined()
  expect(plan.movedSameDay, 'в окне нет переноса внутри дня').toBeDefined()
  expect(plan.roomChanged, 'в окне нет смены аудитории').toBeDefined()
  expect(plan.teacherChanged, 'в окне нет замены преподавателя').toBeDefined()
  expect(plan.movedOtherDayInWindow ?? plan.movedOutOfWindow, 'в окне нет переноса на другой день').toBeDefined()
})

test('С-2: вкладка «Расписание», затем завтрашний день — два касания', async () => {
  await openToday()
  const touches = { n: 0 }
  await touch(touches, tab(), 'вкладка «Расписание»')
  await expect(page).toHaveURL(`${BASE_URL}/schedule`)
  await expect(page.getByRole('heading', { name: /Расписание на сегодня/, level: 1 })).toBeVisible()
  await touch(touches, dayLink(tomorrow), 'завтрашний день в полосе дней')
  await expect(page).toHaveURL(`${BASE_URL}${dayPath(tomorrow)}`)
  expect(touches.n, 'число касаний С-2').toBe(2)
  await expect(page.getByRole('heading', { name: `Расписание на ${formatDayMonth(tomorrow)}`, level: 1 })).toBeVisible()
  await expect(dayLink(tomorrow)).toHaveAttribute('aria-current', 'date')
  // Видны пары завтрашнего дня из плана; если их нет — пустое состояние.
  const tomorrowLessons = plan.lessons.filter((l) => l.date === tomorrow)
  if (tomorrowLessons.length === 0) await expect(page.getByText('В этот день пар нет')).toBeVisible()
  for (const l of tomorrowLessons) await expect(page.getByRole('heading', { name: l.discipline }).first()).toBeVisible()
  await expectNoHorizontalScroll('С-2')
  test.info().annotations.push({ type: 'Касаний С-2', description: String(touches.n) })
})

test('С-3: вкладка «Расписание», затем «Неделя» — два касания', async () => {
  await openToday()
  const touches = { n: 0 }
  await touch(touches, tab(), 'вкладка «Расписание»')
  await touch(touches, page.getByRole('group', { name: 'Вид' }).getByRole('link', { name: 'Неделя', exact: true }), 'переключатель «Неделя»')
  await expect(page).toHaveURL(`${BASE_URL}/schedule?view=week`)
  expect(touches.n, 'число касаний С-3').toBe(2)
  await expect(page.getByRole('heading', { name: 'Расписание на неделю', level: 1 })).toBeVisible()
  const week = page.getByRole('list', { name: 'Неделя по дням' })
  // Семь дней, сегодня отмечен словом, дни без пар названы «Пар нет».
  await expect(week.getByRole('heading', { level: 2 })).toHaveCount(7)
  await expect(week.getByText('сегодня', { exact: true })).toHaveCount(1)
  await expect(week.locator('h2', { hasText: 'сегодня' })).toHaveCount(1)
  const emptyDays = plan.window.filter((d) => plan.entriesOn(d) === 0).length
  await expect(week.getByText('Пар нет', { exact: true })).toHaveCount(emptyDays)
  await expect(week.locator('ul > li')).toHaveCount(plan.totalEntries)
  for (const l of plan.lessons) await expect(week.getByText(l.discipline).first()).toBeVisible()
  await expectNoHorizontalScroll('С-3')
  test.info().annotations.push({ type: 'Касаний С-3', description: String(touches.n) })
})

test('полоса дней: семь дней от сегодняшнего, выбранный назван, у дней с изменениями — скрытый текст', async () => {
  await page.goto(dayPath(plan.movedSameDay!.date))
  const links = strip().getByRole('link')
  await expect(links).toHaveCount(7)
  for (const [i, date] of plan.window.entries()) {
    const link = links.nth(i)
    await expect(link).toHaveAttribute('href', dayPath(date))
    if (date === plan.movedSameDay!.date) await expect(link).toHaveAttribute('aria-current', 'date')
    else await expect(link).not.toHaveAttribute('aria-current', /.*/)
    if (plan.hasChangesOn(date)) await expect(link, `${date}: есть изменения`).toContainText('есть изменения')
    else await expect(link, `${date}: изменений нет`).not.toContainText('есть изменения')
  }
  await expect(links.first()).toContainText('сегодня')
  const week = weekInfo(plan.movedSameDay!.date)!
  await expect(page.getByTestId('week-label')).toHaveText(`${week.kind === 'верхняя' ? 'Верхняя' : 'Нижняя'} неделя · ${week.number}-я`)
  await expect(page.getByRole('group', { name: 'Вид' }).getByRole('link', { name: 'День' })).toHaveAttribute('aria-current', 'true')
})

test('перенос внутри дня: «Перенесена» дважды, новое время крупно, строка «Было», на старом месте — «Перенесена на»', async () => {
  const l = plan.movedSameDay!
  const change = l.change!
  const from = wanted('movedSameDay', 'moved_from')
  const to = wanted('movedSameDay', 'moved_to')
  await page.goto(dayPath(l.date))
  // Плашка стоит и на старом, и на новом месте этой пары; слово и значок, а не только цвет. Другие переносы того же дня не мешают.
  await expect(card(from).getByText('Перенесена', { exact: true })).toHaveCount(1)
  await expect(card(to).getByText('Перенесена', { exact: true })).toHaveCount(1)
  const newRoom = change.newRoom ?? l.room
  await expect(card(from).getByText(`Перенесена на ${change.newStartsAt}–${change.newEndsAt}, ауд. ${newRoom}`)).toBeVisible()
  // Строка «Было» — внутри карточки нового места этой пары.
  const was = card(to).locator('p', { hasText: 'Было:' })
  await expect(was).toHaveCount(1)
  await expect(was).toContainText(`${l.startsAt}–${l.endsAt}`)
  await expectLineThrough(was.locator('s'), 'строка «Было»')
  // Новое время набрано крупнее остальных.
  const newTime = card(to).locator('b', { hasText: new RegExp(`^${change.newStartsAt}$`) })
  await expect(newTime).toHaveCount(1)
  const size = await newTime.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(size, 'размер нового времени').toBeGreaterThanOrEqual(18)
  await expectNoHorizontalScroll('день с переносом')
})

test('перенос на другой день: старое место говорит, куда перенесена; новое место видно, если день внутри семи', async () => {
  const inWindow = plan.movedOtherDayInWindow
  const outOfWindow = plan.movedOutOfWindow
  const l = inWindow ?? outOfWindow
  expect(l, 'в окне нет переноса на другой день').toBeDefined()
  const change = l!.change!
  const target = `${weekdayShort(change.newDate!)}, ${formatDayMonth(change.newDate!)}, ${change.newStartsAt}–${change.newEndsAt}, ауд. ${change.newRoom ?? l!.room}`
  const scenario = inWindow ? 'movedOtherDayInWindow' : 'movedOutOfWindow'
  // Старое место стоит на своём дне, если этот день в окне. Пара, перенесённая с прошедшего дня, на старом месте не показывается.
  if (plan.window.includes(l!.date)) {
    await page.goto(dayPath(l!.date))
    await expect(card(wanted(scenario, 'moved_from')).getByText(`Перенесена на ${target}`)).toBeVisible()
  }
  if (inWindow) {
    await page.goto(dayPath(change.newDate!))
    const to = card(wanted(scenario, 'moved_to'))
    const was = to.locator('p', { hasText: 'Было:' })
    await expect(was).toHaveCount(1)
    await expect(was).toContainText(`${weekdayShort(l!.date)}, ${formatDayMonth(l!.date)}, ${l!.startsAt}–${l!.endsAt}`)
    await expect(to.locator('b', { hasText: new RegExp(`^${change.newStartsAt}$`) })).toHaveCount(1)
  } else {
    // Новое место вне семи дней от сегодня: в полосе такого дня нет, видно только старое место с текстом. Новое место — в модульных тестах.
    await expect(dayLink(change.newDate!)).toHaveCount(0)
    test.info().annotations.push({
      type: 'Перенос на другой день',
      description: `Новая дата ${change.newDate} вне семи дней от ${today}: новое место на живых данных не показать, проверено модульным тестом schedule-lib.test.ts`,
    })
  }
})

test('день с отменой: «Отменена», зачёркнутое название, «Занятие не состоится»', async () => {
  const l = plan.cancelled!
  await page.goto(dayPath(l.date))
  const cancelledCard = card(wanted('cancelled', 'regular'))
  await expect(cancelledCard).toHaveCount(1)
  await expect(cancelledCard.getByText('Занятие не состоится')).toBeVisible()
  await expect(cancelledCard.getByText('Отменена', { exact: true })).toBeVisible()
  const title = cancelledCard.getByRole('heading', { level: 2 })
  await expect(title).toContainText(l.discipline)
  await expectLineThrough(title, 'название отменённой пары')
  // Для экранного чтеца зачёркивание продублировано словом.
  await expect(title.locator('.sr-only')).toHaveText(/отменено/)
  await expect(cancelledCard.getByText(l.change!.note)).toBeVisible()
  // После заголовка страницы (h1) идут заголовки карточек уровнем ниже (h2), без пропуска уровня.
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0)
  await expectNoHorizontalScroll('день с отменой')
})

test('смена аудитории и замена преподавателя: плашка и строка «Было»', async () => {
  const room = plan.roomChanged!
  await page.goto(dayPath(room.date))
  const roomCard = card(wanted('roomChanged', 'regular'))
  await expect(roomCard.getByText('Сменилась аудитория', { exact: true })).toBeVisible()
  await expect(roomCard).toContainText(`Аудитория: ${room.change!.newRoom}`)
  await expect(roomCard.locator('p', { hasText: 'Было:' }).locator('s')).toHaveText(`ауд. ${room.room}`)

  const teacher = plan.teacherChanged
  expect(teacher, 'в окне нет замены преподавателя').toBeDefined()
  await page.goto(dayPath(teacher!.date))
  const [, next, prev] = /^Ведёт\s+(.+?)\s+вместо\s+(.+)$/.exec(teacher!.change!.note)!
  const teacherCard = card(wanted('teacherChanged', 'regular'))
  await expect(teacherCard.getByText('Сменился преподаватель', { exact: true })).toBeVisible()
  await expect(teacherCard).toContainText(`Преподаватель: ${next}`)
  await expect(teacherCard.locator('p', { hasText: 'Было:' }).locator('s')).toHaveText(prev!)
})

test('адрес с мусором в «day» и «view» показывает сегодня и вид «День», без ошибки', async () => {
  const junk = ['мусор', '2026-02-30', '2026-11-1', addDays(today, 7), addDays(today, -1), '', '<script>']
  for (const value of junk) {
    const response = await page.goto(`/schedule?day=${encodeURIComponent(value)}`)
    expect(response!.status(), `day=${value}: код ответа`).toBe(200)
    await expect(page.getByRole('heading', { name: /Расписание на сегодня/, level: 1 }), `day=${value}`).toBeVisible()
    await expect(dayLink(today)).toHaveAttribute('aria-current', 'date')
  }
  const twice = await page.goto('/schedule?day=a&day=b&view=week&view=day')
  expect(twice!.status()).toBe(200)
  await expect(page.getByRole('heading', { name: /Расписание на сегодня/, level: 1 })).toBeVisible()
  await page.goto('/schedule?view=мусор')
  await expect(page.getByRole('group', { name: 'Вид' }).getByRole('link', { name: 'День' })).toHaveAttribute('aria-current', 'true')
  // Дата внутри окна принимается.
  await page.goto(dayPath(tomorrow))
  await expect(dayLink(tomorrow)).toHaveAttribute('aria-current', 'date')
})

test('пустой день: «В этот день пар нет», без ошибки', async () => {
  const date = plan.emptyDate
  if (date === undefined) {
    // В этот день запуска у набора нет дня без записей: ни одного из семи, сегодняшний тоже. Тест не ходит по выдуманному адресу, а
    // проверяет то, что набор даёт: в виде «Неделя» нет строки «Пар нет» ни у одного дня.
    test.info().annotations.push({ type: 'Пустого дня нет', description: `В окне от ${today} у набора нет дня без пар и переносов: проверяется, что в «Неделе» нет «Пар нет»` })
    await page.goto('/schedule?view=week')
    await expect(page.getByRole('list', { name: 'Неделя по дням' }).getByRole('heading', { level: 2 })).toHaveCount(7)
    await expect(page.getByText('Пар нет', { exact: true })).toHaveCount(0)
    await expectNoHorizontalScroll('неделя без пустых дней')
    return
  }
  await page.goto(dayPath(date))
  await expect(page.getByRole('heading', { name: date === today ? 'Сегодня пар нет' : 'В этот день пар нет', level: 2 })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: date === today ? 'Расписание на сегодня' : `Расписание на ${formatDayMonth(date)}`, level: 1 }),
  ).toBeVisible()
  await expectNoHorizontalScroll('пустой день')
})

test('нет прокрутки вбок, зоны касания не меньше 44×44', async () => {
  const where: [string, string][] = [
    ['день: сегодня', '/schedule'],
    ['день: с переносом', dayPath(plan.movedSameDay!.date)],
    ['день: с отменой', dayPath(plan.cancelled!.date)],
    ['неделя', '/schedule?view=week'],
  ]
  // Пустой день есть не всегда; нет его — этой строки нет, в тесте «пустой день» причина названа.
  if (plan.emptyDate !== undefined) where.splice(3, 0, ['день: пустой', dayPath(plan.emptyDate)])
  for (const [name, path] of where) {
    await page.goto(path)
    await expectNoHorizontalScroll(name)
    await expectTapSize(page.getByRole('group', { name: 'Вид' }).getByRole('link'), 2, `${name}: переключатель`)
    if (path !== '/schedule?view=week') await expectTapSize(strip().getByRole('link'), 7, `${name}: полоса дней`)
  }
})

test('владелец данных — из сессии: метка другой группы на экране не появляется, группа в адресе не действует', async () => {
  for (const path of [
    '/schedule',
    '/schedule?view=week',
    `/schedule?group=${encodeURIComponent(student2.groupName)}&groupId=x&studentId=x`,
    `/schedule?view=week&group=${encodeURIComponent(student2.groupName)}`,
  ]) {
    await page.goto(path)
    await expect(page.locator('body'), path).not.toContainText(student2.markers.schedule)
  }
  await page.goto('/schedule?view=week')
  await expect(page.locator('body')).toContainText(student1.groupName)
})
