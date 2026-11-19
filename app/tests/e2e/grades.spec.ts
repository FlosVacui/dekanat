// Сквозные тесты экрана «Успеваемость» (пакет 3.3, строка ЯД-3): экран 360×800, данные — основной набор вымышленных аккаунтов.
// Ожидания берутся из плана набора (helpers/grades-plan.ts) на день запуска, а не из числа или даты в тесте (ошибка ИИ 84).
// Касания считаются по правилам S-2.1, раздел 1: счёт идёт от экрана «Сегодня»; С-6 и С-14 — одно касание, С-7 и С-15 — два.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addDays, formatDayMonth, todayIn, weekdayShort } from '../../src/lib/dates'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { expectedExamNeeds, planGrades, scoreWord, type PlannedRow } from './helpers/grades-plan'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')
const today = todayIn('Europe/Moscow')
const plan = planGrades(today, student1.login)
const plan2 = planGrades(today, student2.login)

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

/** Строка плана, которую тест ищет на экране. Нет такой — ошибка набора, а не тихий пропуск. */
function need(rows: PlannedRow[], where: (r: PlannedRow) => boolean, what: string): PlannedRow {
  const found = rows.find(where)
  if (!found) throw new Error(`В плане на ${today} нет дисциплины: ${what}`)
  return found
}
const debtRow = need(plan.rows, (r) => r.state === 'debt', 'долг')
const noAdmissionRow = need(plan.rows, (r) => r.state === 'no_admission' && r.controlKind === 'exam', 'экзамен без допуска')
const admittedRow = need(plan.rows, (r) => r.state === 'admitted' && r.controlKind === 'exam', 'экзамен впереди, допуск есть')
const creditAheadRow = need(plan.rows, (r) => r.state === 'admitted' && r.controlKind === 'credit', 'зачёт впереди')
const passedCreditRow = need(plan.rows, (r) => r.state === 'passed' && r.controlKind === 'credit', 'сданный зачёт')
const passedExamRow = need(plan.rows, (r) => r.state === 'passed' && r.controlKind === 'exam', 'сданный экзамен с оценкой')

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

async function expectNoHorizontalScroll(where: string, p: Page = page): Promise<void> {
  const { scrollWidth, clientWidth } = await p.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth, `${where}: ширина окна`).toBe(360)
}

async function expectTapSize(links: Locator, expectedAtLeast: number, where: string): Promise<void> {
  const count = await links.count()
  expect(count, `${where}: число ссылок`).toBeGreaterThanOrEqual(expectedAtLeast)
  for (let i = 0; i < count; i += 1) {
    const box = await links.nth(i).boundingBox()
    expect(box, `${where}, ссылка ${i + 1}: нет рамки`).not.toBeNull()
    expect(box!.width, `${where}, ссылка ${i + 1}: ширина`).toBeGreaterThanOrEqual(44)
    expect(box!.height, `${where}, ссылка ${i + 1}: высота`).toBeGreaterThanOrEqual(44)
  }
}

const tab = (p: Page = page) => p.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Успеваемость', exact: true })
const semesterList = (p: Page = page) => p.getByRole('list', { name: 'Дисциплины' })
const card = (name: string, p: Page = page) =>
  semesterList(p).locator('> li').filter({ has: p.getByRole('heading', { level: 3, name, exact: true }) })
const sessionSection = (title: string, p: Page = page) =>
  p.locator('section', { has: p.getByRole('heading', { level: 2, name: title, exact: true }) })
const sessionRow = (section: Locator, name: string, p: Page = page) =>
  section.locator('ul > li').filter({ has: p.getByRole('heading', { level: 3, name, exact: true }) })

async function openToday(): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Сегодня', level: 1 })).toBeVisible()
}

function outcomeWord(outcome: string): string {
  if (['5', '4', '3', '2'].includes(outcome)) return `Оценка ${outcome}`
  if (outcome === 'credit') return 'Зачтено'
  if (outcome === 'no_credit') return 'Не зачтено'
  return 'Впереди'
}

/** Баллы на карточке и в блоке баллов: у экзамена без итога — из 60 за семестр, у остальных — сумма из 100. */
function pointsText(r: PlannedRow): string {
  if (r.points === null) return 'Баллов пока нет'
  return `${r.points} из ${r.controlKind === 'exam' && r.outcome === 'pending' ? 60 : 100} баллов`
}

function averageText(rows: PlannedRow[]): string {
  const marks = rows.filter((r) => ['2', '3', '4', '5'].includes(r.outcome)).map((r) => Number(r.outcome))
  return marks.length ? (marks.reduce((a, b) => a + b, 0) / marks.length).toFixed(1).replace('.', ',') : '—'
}

function dateLine(r: PlannedRow): string {
  return `${formatDayMonth(r.examDate!)}, ${weekdayShort(r.examDate!)}${r.examTime ? `, ${r.examTime.slice(0, 5)}` : ''}`
}

/** Блок «Форма контроля» страницы предмета (М4): «экзамен — чт 24 декабря, 10:00, ауд. 314»; даты нет — только вид. */
function controlForm(r: PlannedRow, word: string): string {
  if (!r.examDate) return word
  const parts = [`${weekdayShort(r.examDate)} ${formatDayMonth(r.examDate)}`]
  if (r.examTime) parts.push(r.examTime.slice(0, 5))
  if (r.examRoom) parts.push(`ауд. ${r.examRoom}`)
  return `${word} — ${parts.join(', ')}`
}

/** Ссылка назад на странице предмета (М4): «Успеваемость»; одноимённая вкладка нижней панели в `main` не входит. */
const backLink = (p: Page = page) => p.getByRole('main').getByRole('link', { name: 'Успеваемость', exact: true })

test('данные: у студента 1 есть долг, недопуск, экзамен и зачёт впереди, сданные зачёт и экзамен; у другой группы есть свои дисциплины', () => {
  // Если этого нет, остальные тесты проверяют пустоту.
  expect(plan.rows).toHaveLength(7)
  expect([debtRow, noAdmissionRow, admittedRow, creditAheadRow, passedCreditRow, passedExamRow].every(Boolean)).toBe(true)
  expect(debtRow.examDate, 'у долга должна быть дата пересдачи').not.toBeNull()
  expect(plan.foreignIds.length, 'у другой группы нет дисциплин').toBeGreaterThan(0)
  expect(plan2.rows.length).toBeGreaterThan(0)
})

test('С-6: вкладка «Успеваемость» — одно касание, в сводке фраза-итог, числа, строка о стипендии и «что сделать первым»', async () => {
  await openToday()
  const touches = { n: 0 }
  await touch(touches, tab(), 'вкладка «Успеваемость»')
  await expect(page).toHaveURL(`${BASE_URL}/grades`)
  expect(touches.n, 'число касаний С-6').toBe(1)
  await expect(page.getByRole('heading', { name: 'Успеваемость', level: 1 })).toBeVisible()

  const summary = page.locator('section', { has: page.getByRole('heading', { name: 'Как у меня дела', level: 2 }) })
  await expect(summary.getByTestId('grades-phrase')).toHaveText(plan.phrase)
  const number = (term: string) => summary.locator('dl > div').filter({ has: page.getByText(term, { exact: true }) }).locator('dd')
  await expect(number('Сдано')).toHaveText(String(plan.passed))
  await expect(number('Долг')).toHaveText(String(plan.debt))
  await expect(number('Впереди')).toHaveText(String(plan.ahead))
  await expect(number('Средний балл')).toHaveText(averageText(plan.rows))

  // Строка о стипендии стоит, пока есть долг (у студента 1 он есть), и ровно в той сводке, где число «долг» не ноль.
  expect(plan.debt, 'у студента 1 должен быть долг').toBeGreaterThan(0)
  await expect(summary.getByTestId('stipend-line')).toHaveText('Пока есть долг, обычная стипендия не назначается')
  await expect(page.locator('body')).not.toContainText('по правилам вуза')

  // «Что сделать первым»: при долге это пересдача долга, со ссылкой на дисциплину.
  const first = summary.getByTestId('first-action')
  await expect(first).toHaveAttribute('href', `/grades/${debtRow.id}`)
  await expect(first).toContainText('Пересдать')
  await expect(first).toContainText(`${debtRow.name}, пересдача ${formatDayMonth(debtRow.examDate!)}`)
  await expectNoHorizontalScroll('С-6')
  test.info().annotations.push({ type: 'Касаний С-6', description: String(touches.n) })
})

test('С-14: итог виден на карточке после одного касания; долги и недопуски — вверху списка, все дисциплины на месте', async () => {
  await openToday()
  const touches = { n: 0 }
  await touch(touches, tab(), 'вкладка «Успеваемость»')
  expect(touches.n, 'число касаний С-14').toBe(1)
  await expect(page.getByRole('link', { name: 'Семестр', exact: true })).toHaveAttribute('aria-current', 'true')

  const list = semesterList()
  await expect(list.locator('> li')).toHaveCount(plan.rows.length)
  // Порядок: долг, недопуск, остальное «впереди», сданное. Сданное и долг лежат в прошлом семестре и на экране есть: фильтра нет.
  await expect(list.getByRole('heading', { level: 3 })).toHaveText(plan.semesterOrder)
  expect(plan.rows.map((r) => r.semester), 'нужны разные семестры, иначе проверка фильтра пуста').not.toEqual(plan.rows.map(() => plan.rows[0]!.semester))
  expect(plan.semesterOrder[0]).toBe(debtRow.name)
  expect(plan.semesterOrder[1]).toBe(noAdmissionRow.name)

  for (const r of plan.rows) {
    const c = card(r.name)
    await expect(c, r.name).toHaveCount(1)
    await expect(c, `${r.name}: итог`).toContainText(`Итог: ${outcomeWord(r.outcome)}`)
    await expect(c, `${r.name}: вид контроля`).toContainText(r.controlKind === 'exam' ? 'Экзамен' : 'Зачёт')
    await expect(c, `${r.name}: баллы`).toContainText(pointsText(r))
    await expect(c.getByRole('link'), `${r.name}: карточка — ссылка`).toHaveAttribute('href', `/grades/${r.id}`)
  }
  // Итог словом и плашкой на каждой карточке; оценка 4 и «зачтено» из набора.
  await expect(list.locator('> li').filter({ hasText: 'Итог:' })).toHaveCount(plan.rows.length)
  await expect(card(passedExamRow.name)).toContainText('Итог: Оценка 4')
  await expect(card(passedCreditRow.name)).toContainText('Итог: Зачтено')

  // Смысл не только цветом: долг и недопуск названы словом; допуск назван словом; у недопуска сказано, сколько не хватает.
  await expect(card(debtRow.name)).toContainText('Долг')
  await expect(card(debtRow.name)).toContainText(`Пересдача — ${formatDayMonth(debtRow.examDate!)}`)
  await expect(card(noAdmissionRow.name)).toContainText('Нет допуска')
  await expect(card(noAdmissionRow.name)).toContainText(`До допуска не хватает ${noAdmissionRow.missing} ${scoreWord(noAdmissionRow.missing)}`)
  await expect(card(admittedRow.name)).toContainText('Допуск есть')
  // Допуск к зачёту порога не имеет: числа «не хватает» у зачёта нет.
  await expect(card(creditAheadRow.name)).not.toContainText('не хватает')

  // Полоса баллов названа для экранного чтеца и дублируется числом; отметка допуска — только у экзамена без итога.
  const meters = list.getByRole('meter', { name: 'Набрано баллов' })
  await expect(meters).toHaveCount(plan.rows.filter((r) => r.points !== null).length)
  const bar = card(admittedRow.name).getByRole('meter')
  await expect(bar).toHaveAttribute('aria-valuenow', String(admittedRow.points))
  await expect(bar).toHaveAttribute('aria-valuemax', '60')
  await expect(card(admittedRow.name).getByTestId('threshold-mark')).toHaveCount(1)
  await expect(card(passedExamRow.name).getByTestId('threshold-mark')).toHaveCount(0)
  await expect(card(creditAheadRow.name).getByTestId('threshold-mark')).toHaveCount(0)

  // Ближайшая работа со сроком — на карточке, где она есть.
  const workDue = admittedRow.works.filter((w) => w.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  expect(workDue, 'у экзамена с допуском в плане нет предстоящей работы').toBeDefined()
  await expect(card(admittedRow.name)).toContainText(`Ближайшая работа: ${workDue!.title}, до ${formatDayMonth(workDue!.dueDate)}`)
  await expectNoHorizontalScroll('С-14')
  test.info().annotations.push({ type: 'Касаний С-14', description: String(touches.n) })
})

test('С-7: вкладка «Успеваемость», затем карточка дисциплины — два касания; на экране баллы, допуск, что нужно на экзамене, дата, работы', async () => {
  await openToday()
  const touches = { n: 0 }
  await touch(touches, tab(), 'вкладка «Успеваемость»')
  await touch(touches, card(admittedRow.name).getByRole('link'), `карточка «${admittedRow.name}»`)
  await expect(page).toHaveURL(`${BASE_URL}/grades/${admittedRow.id}`)
  expect(touches.n, 'число касаний С-7').toBe(2)

  await expect(page.getByRole('heading', { level: 1, name: admittedRow.name })).toBeVisible()
  // Было: ссылка «Все дисциплины». Стало (М4): «Успеваемость».
  await expect(backLink()).toHaveAttribute('href', '/grades')
  await expect(page.getByTestId('points-line')).toHaveText(pointsText(admittedRow))
  await expect(page.getByRole('meter', { name: 'Набрано баллов' })).toHaveAttribute('aria-valuenow', String(admittedRow.points))
  await expect(page.getByTestId('threshold-mark')).toHaveCount(1)
  await expect(page.getByTestId('admission-line')).toHaveText('Допуск есть')
  // Что нужно на экзамене для 3, 4 и 5 — по баллам из плана. У «Микроэкономики» оценка 5 недостижима: нужно 44 из 40 — это следствие набора.
  await expect(page.getByTestId('exam-targets').locator('li')).toHaveText(expectedExamNeeds(admittedRow.points))
  await expect(page.getByRole('heading', { level: 2, name: 'Что нужно на экзамене' })).toBeVisible()
  // Форма контроля — одной строкой (М4). Было: заголовок «Экзамен» и отдельные «Дата» и «Аудитория: …».
  await expect(page.getByTestId('control-form')).toHaveText(controlForm(admittedRow, 'экзамен'))
  // Работы: каждая названа; их список и баллы по статусам проверяет grades-works.spec.ts. Было: деление на «Предстоящие» и «Прошедшие»
  // и подпись «Баллы за отдельную работу здесь не показываются» — баллы за работу теперь есть.
  await expect(page.getByRole('heading', { level: 2, name: 'Работы', exact: true })).toBeVisible()
  await expect(page.getByTestId('works-list').locator('> li')).toHaveCount(admittedRow.works.length)
  // Было: «таблиц нет». Стало: на 360 px таблица работ есть в разметке, но скрыта (от 1024 px — таблица, ниже — список).
  await expect(page.locator('table:visible')).toHaveCount(0)
  await expectNoHorizontalScroll('С-7')
  test.info().annotations.push({ type: 'Касаний С-7', description: String(touches.n) })
})

test('С-15: вкладка «Успеваемость», затем «Сессия» — два касания; видны даты, допуск, у недопущенного — сколько не хватает; прошедшие — с итогом', async () => {
  await openToday()
  const touches = { n: 0 }
  await touch(touches, tab(), 'вкладка «Успеваемость»')
  await touch(touches, page.getByRole('group', { name: 'Вид' }).getByRole('link', { name: 'Сессия', exact: true }), 'переключатель «Сессия»')
  await expect(page).toHaveURL(`${BASE_URL}/grades?view=session`)
  expect(touches.n, 'число касаний С-15').toBe(2)
  await expect(page.getByRole('link', { name: 'Сессия', exact: true })).toHaveAttribute('aria-current', 'true')

  const upcoming = sessionSection('Предстоящие экзамены и зачёты')
  await expect(upcoming.locator('ul > li').getByRole('heading', { level: 3 })).toHaveText(plan.sessionUpcoming)
  for (const name of plan.sessionUpcoming) {
    const r = plan.rows.find((x) => x.name === name)!
    const row = sessionRow(upcoming, name)
    await expect(row, name).toHaveCount(1)
    await expect(row.getByRole('link'), `${name}: строка — ссылка`).toHaveAttribute('href', `/grades/${r.id}`)
    await expect(row, `${name}: дата`).toContainText(dateLine(r))
    await expect(row, `${name}: вид контроля`).toContainText(r.controlKind === 'exam' ? 'Экзамен' : 'Зачёт')
    if (r.examRoom) await expect(row, `${name}: аудитория`).toContainText(`ауд. ${r.examRoom}`)
    const word = r.state === 'debt' ? 'Пересдача' : r.state === 'no_admission' ? 'Не допущен' : 'Допущен'
    await expect(row.getByText(word, { exact: true }), `${name}: плашка «${word}»`).toHaveCount(1)
    if (r.state === 'no_admission' && r.controlKind === 'exam') {
      await expect(row, `${name}: сколько не хватает`).toContainText(`До допуска не хватает ${r.missing} ${scoreWord(r.missing)}`)
    } else {
      await expect(row, `${name}: числа «не хватает» нет`).not.toContainText('не хватает')
    }
  }
  // Недопуск и допуск названы разными словами: проверка не пустая.
  expect(plan.sessionUpcoming).toContain(noAdmissionRow.name)
  expect(plan.sessionUpcoming).toContain(admittedRow.name)

  const past = sessionSection('Прошедшие')
  await expect(past.locator('ul > li').getByRole('heading', { level: 3 })).toHaveText(plan.sessionPast)
  for (const name of plan.sessionPast) {
    const r = plan.rows.find((x) => x.name === name)!
    const row = sessionRow(past, name)
    await expect(row, `${name}: итог`).toContainText(r.outcome === 'pending' ? 'Итога пока нет' : `Итог: ${outcomeWord(r.outcome)}`)
    // Сданное без даты: строки с датой нет, подписи «Дата не назначена» тоже (замечание R-3.3-4). С датой — дата как есть.
    if (r.examDate) await expect(row, `${name}: дата`).toContainText(dateLine(r))
    else if (r.state === 'passed') await expect(row, `${name}: сданное без даты — подписи «Дата не назначена» нет`).not.toContainText('Дата не назначена')
  }
  // Прошедшие у студента 1 — сданные без даты (Маркетинг, Статистика): проверка выше не пустая.
  expect(plan.sessionPast.map((n) => plan.rows.find((x) => x.name === n)!).some((r) => !r.examDate && r.state === 'passed')).toBe(true)
  await expect(page.locator('table:visible')).toHaveCount(0)
  await expectNoHorizontalScroll('С-15')
  test.info().annotations.push({ type: 'Касаний С-15', description: String(touches.n) })
})

test('дисциплина с долгом: итог «Оценка 2», пересдача с датой, сумма из 100, подсчёта «что нужно на экзамене» нет, работ нет', async () => {
  await page.goto(`/grades/${debtRow.id}`)
  await expect(page.getByRole('heading', { level: 1, name: debtRow.name })).toBeVisible()
  await expect(page.getByTestId('discipline-outcome')).toHaveText(`Итог: ${outcomeWord(debtRow.outcome)}`)
  await expect(page.getByTestId('discipline-state')).toHaveText('Долг')
  await expect(page.getByTestId('points-line')).toHaveText(pointsText(debtRow))
  await expect(page.getByTestId('threshold-mark')).toHaveCount(0)
  await expect(page.getByTestId('exam-targets')).toHaveCount(0)
  // Было: заголовок «Пересдача» и дата отдельно. Стало: «Форма контроля: пересдача — …» (М4).
  await expect(page.getByTestId('control-form')).toHaveText(controlForm(debtRow, 'пересдача'))
  await expect(page.getByRole('heading', { level: 2, name: 'Работ пока нет' })).toBeVisible()
  await expectNoHorizontalScroll('дисциплина с долгом')
})

test('дисциплина без допуска: сколько не хватает, три оценки — «сначала нужен допуск»', async () => {
  await page.goto(`/grades/${noAdmissionRow.id}`)
  await expect(page.getByRole('heading', { level: 1, name: noAdmissionRow.name })).toBeVisible()
  await expect(page.getByTestId('points-line')).toHaveText(pointsText(noAdmissionRow))
  await expect(page.getByTestId('admission-line')).toContainText('Нет допуска')
  await expect(page.getByTestId('admission-line')).toContainText(`До допуска не хватает ${noAdmissionRow.missing} ${scoreWord(noAdmissionRow.missing)}`)
  await expect(page.getByTestId('discipline-state')).toHaveText(
    `Впереди, до допуска не хватает ${noAdmissionRow.missing} ${scoreWord(noAdmissionRow.missing)}`,
  )
  await expect(page.getByTestId('exam-targets').locator('li')).toHaveText(expectedExamNeeds(noAdmissionRow.points))
  await expect(page.getByTestId('control-form')).toHaveText(controlForm(noAdmissionRow, 'экзамен'))
})

test('зачёты: у сданного — итог «Зачтено», у предстоящего — баллы, срок и итог «Впереди», порога и «до допуска» нет', async () => {
  await page.goto(`/grades/${passedCreditRow.id}`)
  await expect(page.getByTestId('discipline-outcome')).toHaveText('Итог: Зачтено')
  await expect(page.getByTestId('points-line')).toHaveText(pointsText(passedCreditRow))
  await expect(page.getByTestId('exam-targets')).toHaveCount(0)
  await expect(page.getByTestId('threshold-mark')).toHaveCount(0)
  // Сданное без даты: слов «дата не назначена» нет; в «Форме контроля» — только вид (было: блока контроля не было вовсе).
  if (passedCreditRow.examDate === null) {
    await expect(page.getByTestId('control-form')).toHaveText('зачёт')
    await expect(page.locator('body')).not.toContainText('дата не назначена')
  }

  await page.goto(`/grades/${creditAheadRow.id}`)
  await expect(page.getByRole('heading', { level: 1, name: creditAheadRow.name })).toBeVisible()
  await expect(page.getByTestId('points-line')).toHaveText(pointsText(creditAheadRow))
  await expect(page.getByTestId('discipline-outcome')).toHaveCount(0)
  await expect(page.getByTestId('discipline-state')).toHaveText('Впереди')
  await expect(page.getByTestId('exam-targets')).toHaveCount(0)
  await expect(page.getByTestId('threshold-mark')).toHaveCount(0)
  await expect(page.getByTestId('admission-line')).toHaveCount(0)
  await expect(page.getByTestId('control-form')).toHaveText(controlForm(creditAheadRow, 'зачёт'))
  await expect(page.locator('body')).not.toContainText('не хватает')
})

test('сданный экзамен: итог «Оценка 4», сумма из 100, подсчёта «что нужно на экзамене» нет', async () => {
  await page.goto(`/grades/${passedExamRow.id}`)
  await expect(page.getByTestId('discipline-outcome')).toHaveText(`Итог: ${outcomeWord(passedExamRow.outcome)}`)
  await expect(page.getByTestId('points-line')).toHaveText(pointsText(passedExamRow))
  await expect(page.getByTestId('exam-targets')).toHaveCount(0)
  await expect(page.getByTestId('threshold-mark')).toHaveCount(0)
})

test('чужой номер, случайный номер и мусор вместо номера дают один и тот же ответ «не найдено»', async () => {
  const foreignId = plan.foreignIds[0]!
  const foreignNames = plan2.rows.map((r) => r.name)
  const probes: [string, string][] = [
    ['номер дисциплины другой группы', foreignId],
    ['случайный номер', '7b1d2c9e-4f3a-4b6d-8e5f-1a2b3c4d5e6f'],
    ['мусор', encodeURIComponent('мусор')],
    ['число', '1'],
    ['запрос к базе', encodeURIComponent("' or 1=1 --")],
    ['путь наверх', encodeURIComponent('../../etc/passwd')],
    ['номер без одной цифры', foreignId.slice(0, -1)],
  ]
  // Для контроля: свой номер открывается, иначе «не найдено» везде было бы пустой проверкой.
  const own = await page.goto(`/grades/${debtRow.id}`)
  expect(own!.status(), 'свой номер').toBe(200)

  const answers: { what: string; status: number; text: string; title: string }[] = []
  for (const [what, id] of probes) {
    const res = await page.goto(`/grades/${id}`)
    const text = await page.locator('main').innerText()
    answers.push({ what, status: res!.status(), text, title: await page.title() })
    await expect(page.getByRole('heading', { level: 1, name: 'Нет такой дисциплины' }), what).toBeVisible()
    const html = await page.content()
    for (const name of foreignNames) expect(html, `${what}: имя чужой дисциплины «${name}» в ответе`).not.toContain(name)
  }
  for (const a of answers) expect(a.status, `${a.what}: код ответа`).toBe(404)
  const first = answers[0]!
  for (const a of answers) {
    expect(a.text, `${a.what}: текст ответа отличается от «${first.what}»`).toBe(first.text)
    expect(a.title, `${a.what}: заголовок вкладки отличается`).toBe(first.title)
  }
  expect(first.text).toContain('Дисциплины с таким номером у вас нет.')
})

test('владелец данных — из сессии: метки другой группы не появляются, студент и группа в адресе не действуют', async () => {
  for (const path of [
    '/grades',
    '/grades?view=session',
    `/grades?group=${encodeURIComponent(student2.groupName)}&groupId=x&studentId=x&view=session`,
    `/grades?studentId=${encodeURIComponent(student2.login)}`,
    `/grades/${debtRow.id}?studentId=x&group=${encodeURIComponent(student2.groupName)}`,
  ]) {
    await page.goto(path)
    await expect(page.locator('body'), path).not.toContainText(student2.markers.grades)
    for (const r of plan2.rows) await expect(page.locator('body'), `${path}: ${r.name}`).not.toContainText(r.name)
  }
  await page.goto('/grades?view=мусор')
  await expect(page.getByRole('link', { name: 'Семестр', exact: true })).toHaveAttribute('aria-current', 'true')
})

test('нет видимых таблиц, нет прокрутки вбок, зоны касания не меньше 44×44 — на «Семестре», «Сессии» и экране дисциплины', async () => {
  const where: [string, string][] = [
    ['семестр', '/grades'],
    ['сессия', '/grades?view=session'],
    ...plan.rows.map((r): [string, string] => [`дисциплина «${r.name}»`, `/grades/${r.id}`]),
  ]
  for (const [name, path] of where) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Было: `table` — 0. Стало: таблица работ есть в разметке, но на 360 px скрыта, видимых таблиц нет.
    await expect(page.locator('table:visible'), `${name}: видимые таблицы`).toHaveCount(0)
    await expect(page.locator('[role=table], [role=grid], [role=row]'), `${name}: роли таблицы`).toHaveCount(0)
    await expectNoHorizontalScroll(name)
    if (path.startsWith('/grades?') || path === '/grades') {
      await expectTapSize(page.getByRole('group', { name: 'Вид' }).getByRole('link'), 2, `${name}: переключатель`)
      await expectTapSize(page.locator('main ul > li').getByRole('link'), plan.rows.length - 1, `${name}: ссылки-карточки`)
    } else {
      await expectTapSize(backLink(), 1, `${name}: «Успеваемость» (назад)`)
    }
    if (path === '/grades') await expectTapSize(page.getByTestId('first-action'), 1, `${name}: «что сделать первым»`)
  }
})

test('студент 2: баллов нет — «Баллов пока нет», долгов нет — строки о стипендии нет, первым стоит ближайший контроль', async ({ browser }) => {
  const other = await browser.newContext({
    extraHTTPHeaders: addressHeaders(),
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  })
  try {
    const p = await other.newPage()
    await p.goto('/login')
    await fillLogin(p, student2.login, student2.password)
    await p.getByRole('button', { name: 'Войти' }).click()
    await expect(p).toHaveURL(`${BASE_URL}/`)
    await p.goto('/grades')

    const summary = p.locator('section', { has: p.getByRole('heading', { name: 'Как у меня дела', level: 2 }) })
    await expect(summary.getByTestId('grades-phrase')).toHaveText(plan2.phrase)
    expect(plan2.debt, 'у студента 2 не должно быть долга').toBe(0)
    await expect(summary.getByTestId('stipend-line')).toHaveCount(0)
    await expect(p.locator('body')).not.toContainText('стипенди')
    // «Что сделать первым»: недопусков нет — ближайший экзамен или зачёт.
    expect(plan2.rows.every((r) => r.state !== 'no_admission'), 'у студента 2 появился недопуск: ожидание теста устарело').toBe(true)
    const nearest = plan2.rows.find((r) => r.name === plan2.nearest!.name)!
    const first = summary.getByTestId('first-action')
    await expect(first).toHaveAttribute('href', `/grades/${nearest.id}`)
    await expect(first).toContainText(`Подготовиться: ${nearest.name}, ${nearest.controlKind === 'credit' ? 'зачёт' : 'экзамен'} ${formatDayMonth(nearest.examDate!)}`)

    // Дисциплина без баллов: пустое — не ноль.
    const empty = need(plan2.rows, (r) => r.points === null, 'дисциплина без баллов')
    await expect(semesterList(p).locator('> li').filter({ has: p.getByRole('heading', { level: 3, name: empty.name, exact: true }) })).toContainText('Баллов пока нет')
    await expect(semesterList(p).locator('> li').filter({ has: p.getByRole('heading', { level: 3, name: empty.name, exact: true }) }).getByRole('meter')).toHaveCount(0)
    await p.goto(`/grades/${empty.id}`)
    await expect(p.getByTestId('points-line')).toHaveText('Баллов пока нет')
    await expect(p.getByRole('meter')).toHaveCount(0)
    await expectNoHorizontalScroll('студент 2, дисциплина без баллов', p)

    // Экзамен с баллами выше порога: строки «что нужно» по баллам из плана.
    const exam = need(plan2.rows, (r) => r.controlKind === 'exam' && r.outcome === 'pending' && r.points !== null, 'экзамен с баллами')
    await p.goto(`/grades/${exam.id}`)
    await expect(p.getByTestId('exam-targets').locator('li')).toHaveText(expectedExamNeeds(exam.points))
    await expect(p.getByTestId('points-line')).toHaveText(pointsText(exam))

    // Чужой для студента 2 номер — тот же ответ «не найдено».
    const res = await p.goto(`/grades/${debtRow.id}`)
    expect(res!.status()).toBe(404)
    await expect(p.getByRole('heading', { level: 1, name: 'Нет такой дисциплины' })).toBeVisible()
    await expect(p.locator('body')).not.toContainText(debtRow.name)
  } finally {
    await other.close()
  }
})

// Заход А редизайна, шаг 2: переключатели и полоса дней не прыгают наверх (scroll={false}). Ошибка ИИ 115: зелёный тест может
// ничего не проверять, поэтому до нажатия проверяется, что страница действительно прокручена.
// Допуск — высота шапки. Прыжок наверх он не прячет: после перехода scrollY обязан остаться больше нуля.
async function expectNoJumpToTop(
  where: string,
  click: () => Promise<void>,
  arrived: () => Promise<void>,
  p: Page = page,
): Promise<void> {
  const headerHeight = (await p.locator('header').first().boundingBox())?.height ?? 0
  expect(headerHeight, `${where}: высота шапки`).toBeGreaterThan(0)
  const before = await p.evaluate(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight
    window.scrollTo(0, Math.min(150, max))
    return window.scrollY
  })
  expect(before, `${where}: страница должна быть прокручена до нажатия`).toBeGreaterThan(0)
  await click()
  await arrived()
  const { after, max } = await p.evaluate(() => ({ after: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight }))
  // Новая страница может быть короче прокрутки до нажатия (смена 37: дни расписания с одной парой в четверг и на
  // следующей неделе) — тогда ждём наибольшую прокрутку, какую она позволяет. На длинной странице проверка прежняя.
  const expected = Math.min(before, Math.max(0, max))
  if (expected === before) {
    expect(after, `${where}: после перехода страница не должна оказаться наверху (было ${before}, стало ${after})`).toBeGreaterThan(0)
  }
  expect(
    Math.abs(after - expected),
    `${where}: сдвиг ${before} → ${after} (ожидалось ${expected}, наибольшая прокрутка ${max}) больше высоты шапки ${headerHeight}`,
  ).toBeLessThanOrEqual(headerHeight)
}

test('переключатель «Семестр / Сессия» не прыгает наверх', async () => {
  await page.goto('/grades')
  const group = page.getByRole('group', { name: 'Вид' })
  await expectNoJumpToTop(
    'Семестр → Сессия',
    () => group.getByRole('link', { name: 'Сессия', exact: true }).click(),
    () => expect(group.getByRole('link', { name: 'Сессия', exact: true })).toHaveAttribute('aria-current', 'true'),
  )
  await expectNoJumpToTop(
    'Сессия → Семестр',
    () => group.getByRole('link', { name: 'Семестр', exact: true }).click(),
    () => expect(group.getByRole('link', { name: 'Семестр', exact: true })).toHaveAttribute('aria-current', 'true'),
  )
})

test('переключатель «День / Неделя» и полоса дней в расписании не прыгают наверх', async () => {
  // После дизайн-прохода день с двумя парами умещается в окно 360×800 целиком, и прокручивать нечего: проверка прыжка наверх
  // стала бы пустой. Окно ниже — страница заведомо длиннее него; в конце высота возвращается.
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: viewport?.width ?? 360, height: 480 })
  try {
    await checkScheduleNoJump()
  } finally {
    if (viewport) await page.setViewportSize(viewport)
  }
})

async function checkScheduleNoJump(): Promise<void> {
  // День с парами: ближайший к сегодняшнему из пн, вт, ср — у них в основном наборе не меньше двух пар. От дня запуска не зависит.
  let busyDay = today
  for (let i = 0; i < 7 && !['пн', 'вт', 'ср'].includes(weekdayShort(busyDay)); i += 1) busyDay = addDays(busyDay, 1)
  await page.goto(`/schedule?day=${busyDay}`)
  const group = page.getByRole('group', { name: 'Вид' })
  await expectNoJumpToTop(
    'День → Неделя',
    () => group.getByRole('link', { name: 'Неделя', exact: true }).click(),
    () => expect(group.getByRole('link', { name: 'Неделя', exact: true })).toHaveAttribute('aria-current', 'true'),
  )
  // «День» в виде недели ведёт на сегодняшний день, а не на busyDay: в чт–вс его страница бывает короче прокрутки до нажатия —
  // это учитывает expectNoJumpToTop (смена 37).
  await expectNoJumpToTop(
    'Неделя → День',
    () => group.getByRole('link', { name: 'День', exact: true }).click(),
    () => expect(group.getByRole('link', { name: 'День', exact: true })).toHaveAttribute('aria-current', 'true'),
  )
  // Полоса дней: другой день из пн, вт, ср, который сейчас не выбран.
  await page.goto(`/schedule?day=${busyDay}`)
  const other = page
    .getByRole('navigation', { name: 'Дни недели' })
    .locator('a:not([aria-current])')
    .filter({ hasText: /^(пн|вт|ср)/ })
    .first()
  await expect(other, 'в полосе дней есть другой день из пн, вт, ср').toBeVisible()
  await expectNoJumpToTop(
    'Полоса дней',
    () => other.click(),
    () => expect(page).not.toHaveURL(`${BASE_URL}/schedule?day=${busyDay}`),
  )
}
