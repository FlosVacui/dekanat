// Сквозные тесты захода Б редизайна: «Успеваемость» по М3-А (раскрытие «Все работы», сводка, статусы, таблица от 1024 px)
// и страница предмета по М4 (блоки, правила экзамена и зачёта, материалы без ссылок, кнопки сдачи нет).
// Ожидания берутся из плана набора на день запуска (buildCohortPlan), а не из числа или даты в тесте (ошибка ИИ 84).
// Статус работы считается здесь своим коротким правилом: есть баллы — сдано, срока нет и баллов нет — долг/впереди по дате.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { buildCohortPlan } from '../../db/seed-plan'
import { formatDayMonth, todayIn, weekdayShort } from '../../src/lib/dates'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')
const today = todayIn('Europe/Moscow')
const plan = buildCohortPlan(MAIN_COHORT, today)

interface ExpectedWork {
  title: string
  dueDate: string
  maxPoints: number
  points: number | null
  status: 'done' | 'debt' | 'upcoming'
}

/** Работы дисциплины студента с баллами из плана и статусом: баллы есть — сдано; иначе срок прошёл — долг; иначе впереди. */
function worksOf(login: string, discipline: string): ExpectedWork[] {
  const student = plan.students.find((s) => s.spec.login === login)!
  const d = plan.disciplines.find((x) => x.groupName === student.spec.groupName && x.name === discipline)!
  return d.assignments
    .map((a) => {
      const points = student.workResults.find((r) => r.assignmentId === a.id)?.points ?? null
      const status: ExpectedWork['status'] = points !== null ? 'done' : a.dueDate < today ? 'debt' : 'upcoming'
      return { title: a.title, dueDate: a.dueDate, maxPoints: a.maxPoints, points, status }
    })
    .sort((x, y) => x.dueDate.localeCompare(y.dueDate) || x.title.localeCompare(y.title, 'ru'))
}

const PHONE_PHRASE = (w: ExpectedWork) =>
  w.status === 'done' ? `Сдано — ${w.points} из ${w.maxPoints}` : w.status === 'debt' ? `Долг — срок был ${formatDayMonth(w.dueDate)}` : `Впереди — срок ${formatDayMonth(w.dueDate)}`
const SHORT_WORD = { done: 'Сдано', debt: 'Долг', upcoming: 'Впереди' } as const

function summaryText(works: ExpectedWork[]): string {
  const n = (s: ExpectedWork['status']) => works.filter((w) => w.status === s).length
  return [
    n('done') ? `Сдано ${n('done')}` : null,
    n('debt') ? `Долг ${n('debt')}` : null,
    n('upcoming') ? `Впереди ${n('upcoming')}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

const disciplineId = (login: string, name: string) => {
  const student = plan.students.find((s) => s.spec.login === login)!
  return plan.disciplines.find((d) => d.groupName === student.spec.groupName && d.name === name)!.id
}

let server: RunningServer | null = null
let context: BrowserContext
let page: Page
let desktop: BrowserContext

test.use({ extraHTTPHeaders: addressHeaders() })
test.describe.configure({ mode: 'serial' })

async function login(ctx: BrowserContext, account: { login: string; password: string }): Promise<Page> {
  const p = await ctx.newPage()
  await p.goto('/login')
  await fillLogin(p, account.login, account.password)
  await p.getByRole('button', { name: 'Войти' }).click()
  await expect(p).toHaveURL(`${BASE_URL}/`)
  return p
}

test.beforeAll(async ({ browser }) => {
  server = await startServer()
  context = await browser.newContext()
  page = await login(context, student1)
  desktop = await browser.newContext({
    extraHTTPHeaders: addressHeaders(),
    viewport: { width: 1280, height: 900 },
    isMobile: false,
    hasTouch: false,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  })
})

test.afterAll(async () => {
  await context?.close()
  await desktop?.close()
  if (server) await stopServer(server)
  server = null
})

async function expectNoHorizontalScroll(where: string, p: Page, width: number): Promise<void> {
  const { scrollWidth, clientWidth } = await p.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth, `${where}: ширина окна`).toBe(width)
}

async function expectTap(target: Locator, what: string): Promise<void> {
  const box = await target.boundingBox()
  expect(box, `${what}: нет рамки`).not.toBeNull()
  expect(box!.height, `${what}: высота`).toBeGreaterThanOrEqual(44)
  expect(box!.width, `${what}: ширина`).toBeGreaterThanOrEqual(44)
}

const card = (p: Page, name: string) =>
  p.getByRole('list', { name: 'Дисциплины' }).locator('> li').filter({ has: p.getByRole('heading', { level: 3, name, exact: true }) })

const DISCIPLINES_WITH_WORKS = ['Микроэкономика', 'Корпоративные финансы', 'Логистика цепей поставок', 'Деловой английский']

test('«Успеваемость» на 360 px: «Все работы (N)» раскрывает список; сводка, статусы фразой, срок у сданных, максимум у несданных', async () => {
  await page.goto('/grades')
  for (const name of DISCIPLINES_WITH_WORKS) {
    const works = worksOf(student1.login, name)
    const c = card(page, name)
    await expect(c, name).toHaveCount(1)
    const toggle = c.locator('summary')
    await expect(toggle).toHaveText(`Все работы (${works.length})`)
    await expectTap(toggle, `${name}: «Все работы»`)
    // До нажатия список скрыт (ловушка зелёного теста: проверка должна уметь краснеть — после нажатия он виден).
    await expect(c.getByTestId('works-list')).toBeHidden()
    await toggle.click()
    await expect(c.getByTestId('works-list')).toBeVisible()
    await expect(c.getByTestId('works-summary')).toHaveText(summaryText(works))
    const items = c.getByTestId('works-list').locator('> li')
    await expect(items).toHaveCount(works.length)
    for (const [i, w] of works.entries()) {
      const item = items.nth(i)
      await expect(item.getByRole('heading', { level: 4 }), `${name}: ${w.title}`).toHaveText(w.title)
      await expect(item, `${name}: ${w.title}: статус фразой`).toContainText(PHONE_PHRASE(w))
      await expect(item).toHaveAttribute('data-status', w.status)
      if (w.status === 'done') await expect(item).toContainText(`Срок: ${formatDayMonth(w.dueDate)}, ${weekdayShort(w.dueDate)}`)
      // Максимумы набора — 10, 15, 20, 25: везде «баллов».
      else await expect(item).toContainText(`максимум ${w.maxPoints} баллов`)
    }
    // Вся строка предмета — одна ссылка на страницу предмета (кнопки «Страница предмета» больше нет); зона касания не меньше 44 px.
    const link = c.getByRole('link')
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute('href', `/grades/${disciplineId(student1.login, name)}`)
    await expect(c.getByRole('link', { name: 'Страница предмета' })).toHaveCount(0)
    await expectTap(link, `${name}: строка-ссылка`)
  }
  // Все карточки раскрыты, на 360 px прокрутки вбок нет.
  await expectNoHorizontalScroll('«Успеваемость», все работы раскрыты', page, 360)
  // Таблица в разметке есть, но на 360 px скрыта.
  await expect(page.locator('table:visible')).toHaveCount(0)
  expect(await page.locator('table').count()).toBeGreaterThan(0)
  // Дисциплина без работ: раскрытия «Все работы» нет, строка-ссылка на страницу предмета есть.
  const past = card(page, 'Статистика')
  await expect(past.locator('summary')).toHaveCount(0)
  await expect(past.getByRole('link')).toHaveCount(1)
})

test('сумма сданных работ на карточке сходится с баллами за семестр: у экзамена «из 60», у зачёта «из 100»', async () => {
  await page.goto('/grades')
  for (const name of DISCIPLINES_WITH_WORKS) {
    const student = plan.students.find((s) => s.spec.login === student1.login)!
    const grade = student.grades.find((g) => g.discipline === name)!
    const works = worksOf(student1.login, name)
    const sum = works.reduce((total, w) => total + (w.points ?? 0), 0)
    expect(sum, `${name}: сумма работ и баллы за семестр`).toBe(grade.points)
    const kind = plan.disciplines.find((d) => d.groupName === student.spec.groupName && d.name === name)!.controlKind
    await expect(card(page, name)).toContainText(`${grade.points} из ${kind === 'exam' ? 60 : 100} баллов`)
  }
})

test('страница предмета, экзамен на 360 px: блоки по порядку, правила из пяти строк, материалы без ссылок, кнопок сдачи нет', async () => {
  const id = disciplineId(student1.login, 'Микроэкономика')
  await page.goto(`/grades/${id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Микроэкономика' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: 'Успеваемость', exact: true })).toHaveAttribute('href', '/grades')

  // Преподаватели — из пар дисциплины этой группы.
  await expect(page.getByRole('heading', { level: 2, name: 'Преподаватели', exact: true })).toBeVisible()
  await expect(page.getByTestId('teachers').locator('> li')).toHaveText(['Громов Е. В.'])
  // Форма контроля.
  const exam = plan.disciplines.find((d) => d.id === id)!
  await expect(page.getByTestId('control-form')).toContainText(`экзамен — ${weekdayShort(exam.examDate!)} ${formatDayMonth(exam.examDate!)}, ${exam.examTime!.slice(0, 5)}, ауд. ${exam.examRoom}`)
  await expect(page.getByRole('region', { name: 'Форма контроля' })).toContainText('Форма контроля:')

  // Порядок блоков: Преподаватели → Форма контроля → Правила рейтинга → Работы → Материалы курса.
  const y = async (loc: Locator) => (await loc.boundingBox())!.y
  const ys = [
    await y(page.getByRole('heading', { level: 2, name: 'Преподаватели' })),
    await y(page.getByRole('region', { name: 'Форма контроля' })),
    await y(page.getByTestId('rating-rules')),
    await y(page.getByRole('heading', { level: 2, name: 'Работы', exact: true })),
    await y(page.getByRole('heading', { level: 2, name: 'Материалы курса' })),
  ]
  expect([...ys].sort((p, q) => p - q), 'блоки идут сверху вниз в порядке М4').toEqual(ys)

  // Правила рейтинга экзамена — раскрытие: пять строк, последняя — пометка. Слова — дословно из решения 18.11.
  const rules = page.getByTestId('rating-rules')
  await expect(rules).toHaveJSProperty('open', true)
  await expect(rules.locator('summary')).toHaveText('Правила рейтинга')
  await expect(rules.locator('li')).toHaveText([
    'За семестр — до 60 баллов, на экзамене — до 40',
    'Допуск к экзамену — от 30 баллов за семестр',
    'На экзамене нужно набрать не меньше 20',
    'Итог: от 85 — «5», от 70 — «4», от 50 — «3»',
    'Правила условные: концепт для конкурса',
  ])
  await rules.locator('summary').click()
  await expect(rules).toHaveJSProperty('open', false)
  await expect(rules.locator('li').first()).toBeHidden()
  await rules.locator('summary').click()
  await expect(rules.locator('li').first()).toBeVisible()

  // Работы: заголовок h3 у каждой, статус фразой, сводка.
  const works = worksOf(student1.login, 'Микроэкономика')
  await expect(page.getByTestId('works-summary')).toHaveText(summaryText(works))
  const items = page.getByTestId('works-list').locator('> li')
  await expect(items).toHaveCount(works.length)
  for (const [i, w] of works.entries()) {
    await expect(items.nth(i).getByRole('heading', { level: 3 })).toHaveText(w.title)
    await expect(items.nth(i)).toContainText(PHONE_PHRASE(w))
  }

  // Материалы: названиями, без ссылок и кнопок; пояснение под заголовком.
  await expect(page.getByText('В концепте — только названия, файлы не загружаются')).toBeVisible()
  await expect(page.getByTestId('materials').locator('> li')).toHaveText(['Программа курса', 'Вопросы к экзамену', 'Лекция 1 — слайды'])
  await expect(page.getByTestId('materials').getByRole('link')).toHaveCount(0)
  await expect(page.getByTestId('materials').locator('a, button')).toHaveCount(0)

  // Кнопок сдачи и загрузки нет: в основной области нет ни кнопок, ни полей выбора файла, ни слов «Загрузить» и «Сдать работу».
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
  await expect(page.getByRole('main')).not.toContainText(/Загрузить|Сдать работу|Отправить/)
  await expect(page.locator('table:visible')).toHaveCount(0)
  await expectNoHorizontalScroll('страница предмета, экзамен', page, 360)
})

test('страница предмета, зачёт: у правил две строки — без «на экзамене»; материалы — «Вопросы к зачёту»', async () => {
  await page.goto(`/grades/${disciplineId(student1.login, 'Логистика цепей поставок')}`)
  const rules = page.getByTestId('rating-rules')
  await expect(rules.locator('li')).toHaveText(['За семестр — до 100 баллов; порога для зачёта нет', 'Правила условные: концепт для конкурса'])
  await expect(rules).not.toContainText('на экзамене')
  await expect(page.getByTestId('materials').locator('> li')).toHaveText(['Программа курса', 'Вопросы к зачёту', 'Лекция 1 — слайды'])
  await expect(page.getByTestId('control-form')).toContainText('зачёт — ')
  await expect(page.getByTestId('teachers').locator('> li')).toHaveText(['Савельева Н. П.'])
  const works = worksOf(student1.login, 'Логистика цепей поставок')
  await expect(page.getByTestId('works-summary')).toHaveText(summaryText(works))
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expectNoHorizontalScroll('страница предмета, зачёт', page, 360)
})

test('страница предмета без работ, преподавателей и материалов: пустое состояние «Работ пока нет», блоков-пустышек нет', async () => {
  await page.goto(`/grades/${disciplineId(student1.login, 'Статистика')}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Работ пока нет' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Преподаватели' })).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 2, name: 'Материалы курса' })).toHaveCount(0)
  await expect(page.getByTestId('rating-rules')).toBeVisible()
  await expectNoHorizontalScroll('страница предмета без работ', page, 360)
})

test('чужие баллы и чужие дисциплины: студент 2 видит свои баллы, номер студента в адресе не действует', async ({ browser }) => {
  const other = await browser.newContext({
    extraHTTPHeaders: addressHeaders(),
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  })
  try {
    const p = await login(other, student2)
    // Свои баллы: «Физика» — сдано четыре из пяти, впереди «Отчёт по лабораторной №4».
    const physicsId = disciplineId(student2.login, 'Физика')
    await p.goto(`/grades/${physicsId}?studentId=${encodeURIComponent(student1.login)}&group=${encodeURIComponent(student1.groupName)}`)
    const works = worksOf(student2.login, 'Физика')
    await expect(p.getByTestId('works-summary')).toHaveText(summaryText(works))
    const items = p.getByTestId('works-list').locator('> li')
    for (const [i, w] of works.entries()) await expect(items.nth(i)).toContainText(PHONE_PHRASE(w))
    await expect(p.getByTestId('teachers').locator('> li')).toHaveText(['Белова С. А.'])
    // Чужого в ответе нет: ни работ группы студента 1, ни его преподавателей, ни метки его набора.
    for (const word of ['Громов', 'Тарасова', 'Расчётная работа', 'Кейс', 'Эссе по транспортной логистике']) {
      await expect(p.locator('body'), word).not.toContainText(word)
    }
    await p.goto('/grades')
    for (const word of ['Расчётная работа №1', 'Микроэкономика', 'Домашнее задание по дисконтированию']) {
      await expect(p.locator('body'), word).not.toContainText(word)
    }
    // Номер дисциплины чужой группы — тот же ответ, что у несуществующего: 404 и «Нет такой дисциплины».
    const foreign = await p.goto(`/grades/${disciplineId(student1.login, 'Микроэкономика')}`)
    expect(foreign!.status()).toBe(404)
    await expect(p.getByRole('heading', { level: 1, name: 'Нет такой дисциплины' })).toBeVisible()
  } finally {
    await other.close()
  }
})

test('компьютер 1280 px: карточка раскрывает список (блок уже 560 px), страница предмета — таблица «Работа, Срок, Статус, Баллы» и две колонки', async () => {
  const p = await login(desktop, student1)
  await p.goto('/grades')
  const name = 'Корпоративные финансы'
  const works = worksOf(student1.login, name)
  const c = card(p, name)
  await expect(c.getByTestId('works-list')).toBeHidden()
  await c.locator('summary').click()
  // Таблица работ включается по ширине самого блока: от 560 px (контейнерный запрос, дизайн-проход 19.11). Блок внутри карточки
  // на «Успеваемости» и на 1280 px уже 560 px, поэтому там остаётся список; таблица — на странице предмета ниже.
  const blockWidth = await c.getByTestId('works-list').evaluate((el) => el.parentElement!.getBoundingClientRect().width)
  expect(blockWidth, 'ширина блока работ в карточке').toBeLessThan(560)
  await expect(c.getByTestId('works-list')).toBeVisible()
  await expect(c.locator('table')).toBeHidden()
  await expect(c.getByTestId('works-list').locator('> li')).toHaveCount(works.length)
  await expect(c.getByTestId('works-summary')).toHaveText(summaryText(works))
  await expectNoHorizontalScroll('1280, «Успеваемость»', p, 1280)

  await p.goto(`/grades/${disciplineId(student1.login, name)}`)
  await expect(p.locator('table:visible')).toHaveCount(1)
  await expect(p.getByTestId('works-list')).toBeHidden()
  const table = p.getByTestId('works-table')
  await expect(table).toBeVisible()
  await expect(table.locator('thead th')).toHaveText(['Работа', 'Срок', 'Статус', 'Баллы'])
  const rows = table.locator('tbody tr')
  await expect(rows).toHaveCount(works.length)
  for (const [i, w] of works.entries()) {
    const cells = rows.nth(i).locator('td')
    await expect(cells.nth(0)).toHaveText(w.title)
    await expect(cells.nth(1)).toHaveText(`${formatDayMonth(w.dueDate)}, ${weekdayShort(w.dueDate)}`)
    // Статус в таблице — короткое слово; полная фраза — только в списке.
    await expect(cells.nth(2)).toHaveText(SHORT_WORD[w.status])
    await expect(cells.nth(3)).toContainText(w.status === 'done' ? `${w.points} из ${w.maxPoints}` : `максимум ${w.maxPoints}`)
  }
  // «Преподаватели» и «Форма контроля» слева, «Правила рейтинга» справа, работы и материалы — на всю ширину под ними.
  const box = async (loc: Locator) => (await loc.boundingBox())!
  const teachers = await box(p.getByRole('heading', { level: 2, name: 'Преподаватели' }))
  const rules = await box(p.getByTestId('rating-rules'))
  const worksHeading = await box(p.getByRole('heading', { level: 2, name: 'Работы', exact: true }))
  expect(rules.x, 'правила рейтинга справа от преподавателей').toBeGreaterThan(teachers.x + 200)
  expect(worksHeading.y, 'работы ниже верхних блоков').toBeGreaterThan(rules.y)
  await expectNoHorizontalScroll('1280, страница предмета', p, 1280)
  await p.close()
})
