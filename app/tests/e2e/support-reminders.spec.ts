// 20.11, «Поддержка» и напоминания по времени. Экраны 360×800 и 1280×800.
// Проверяется: страница «Поддержка» (номера только из задания, плашка «Пример для прототипа», ссылки на пункты положения, без форм),
// входы в неё (колонка, ссылка под содержимым, профиль), тяжёлый вопрос в помощнике (карточка вместо ответа, текст не остаётся в адресе),
// файл календаря со сроками и экзаменами (VALARM) и строки ленты «Напоминания». Ключа модели у сервера стенда нет: переменные пусты.
// Что зависит от дня запуска (какие сроки и экзамены попадают в окно), сравнивается с планом набора, посчитанным здесь же коротко и
// независимо от кода приложения, а не с постоянной. Файл только читает: ничего не подаёт и не создаёт в базе.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { todayIn } from '../../src/lib/dates'
import { REG_ITEMS } from '../../src/lib/regulations/data'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { planGrades, type PlannedRow } from './helpers/grades-plan'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе меньше двух студентов')
const staff = MAIN_COHORT.staff

const TZ = 'Europe/Moscow'
const AI_NAMES = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_FOLDER_ID'] as const
const savedEnv = new Map<string, string | undefined>()
let server: RunningServer | null = null

test.beforeAll(async () => {
  for (const name of AI_NAMES) {
    savedEnv.set(name, process.env[name])
    process.env[name] = ''
  }
  server = await startServer()
})
test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
  for (const name of AI_NAMES) {
    const value = savedEnv.get(name)
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test.describe.configure({ mode: 'serial' })

async function newContext(browser: Browser, width: number, javaScriptEnabled = true): Promise<BrowserContext> {
  const mobile = width < 600
  return browser.newContext({
    viewport: { width, height: 800 },
    isMobile: mobile,
    hasTouch: mobile,
    javaScriptEnabled,
    locale: 'ru-RU',
    timezoneId: TZ,
    extraHTTPHeaders: addressHeaders(freshAddress()),
  })
}

async function signIn(page: Page, login: string, password: string, landing: string): Promise<void> {
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}${landing}`)
}

async function expectNoHorizontalScroll(page: Page, width: number, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(clientWidth, `${where}: ширина окна`).toBe(width)
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
}

const CRISIS_TEXT = 'не хочу жить'

// ---------- страница «Поддержка» ----------

for (const width of [360, 1280]) {
  test(`${width}: «Поддержка» — служба с плашкой, три номера, источник, пункты положения; форм нет; без прокрутки вбок`, async ({ browser }) => {
    const context = await newContext(browser, width)
    try {
      const page = await context.newPage()
      await signIn(page, student1!.login, student1!.password, '/')
      await page.goto('/support')
      await expect(page.getByRole('heading', { name: 'Поддержка', level: 1 })).toBeVisible()

      const psych = page.getByTestId('support-psych')
      await expect(psych.getByRole('heading', { name: 'Психологическая служба факультета', level: 2 })).toBeVisible()
      await expect(page.getByTestId('support-sample')).toHaveText('Пример для прототипа')
      await expect(page.getByTestId('support-privacy')).toHaveText('Запись идёт напрямую в службу — деканат её не видит')
      // Вымышленные телефон и почта службы — не ссылки: такой номер не должен набираться.
      await expect(psych.locator('a')).toHaveCount(0)

      const now = page.getByTestId('support-now')
      await expect(now.getByRole('heading', { name: 'Если плохо прямо сейчас', level: 2 })).toBeVisible()
      await expect(now).toContainText('с городского телефона, бесплатно')
      await expect(now).toContainText('с мобильного, по тарифу оператора')
      await expect(now).toContainText('Круглосуточно (Москва)')
      await expect(now).toContainText('если есть угроза жизни')
      // Ссылок tel: на всей странице ровно три, и других номеров нет.
      const tel = page.locator('main a[href^="tel:"]')
      await expect(tel).toHaveCount(3)
      expect(await tel.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).toEqual(['tel:051', 'tel:+7495051', 'tel:112'])
      expect((await tel.allTextContents()).map((t) => t.trim())).toEqual(['051', '+7 495 051', '112'])
      for (let i = 0; i < 3; i += 1) expect((await tel.nth(i).boundingBox())!.height, `номер ${i + 1}: зона касания`).toBeGreaterThanOrEqual(44)
      const source = now.getByRole('link', { name: 'Сверено с mos.ru 20.11.2026' })
      await expect(source).toHaveAttribute('href', 'https://www.mos.ru/otvet-zdorovie/kak-poluchit-psihologicheskuyu-pomosch/')
      await expect(source).toHaveAttribute('rel', /noopener/)

      const study = page.getByTestId('support-study')
      await expect(study.getByRole('heading', { name: 'Учёба в трудный период', level: 2 })).toBeVisible()
      const points = study.locator('a[data-point]')
      const count = await points.count()
      expect(count).toBeGreaterThanOrEqual(3)
      expect(count).toBeLessThanOrEqual(4)
      const nums = await points.evaluateAll((els) => els.map((el) => el.getAttribute('data-point')!))
      for (const num of nums) {
        expect(REG_ITEMS.some((i) => i.num === num), `п. ${num} есть в положении`).toBe(true)
        await expect(study.locator(`a[data-point="${num}"]`)).toHaveAttribute('href', `/rules#p-${num.replace('.', '-')}`)
      }

      // Форм, полей и кнопок отправки нет; счётчиков и записи нет.
      await expect(page.locator('main form, main input, main textarea, main button')).toHaveCount(0)
      await expectNoHorizontalScroll(page, width, `${width} «Поддержка»`)

      // Ссылка на пункт открывает положение на нужном месте.
      await points.first().click()
      await expect(page).toHaveURL(new RegExp(`/rules#p-${nums[0]!.replace('.', '-')}$`))
    } finally {
      await context.close()
    }
  })
}

test('входы: колонка на 1280 (после помощника), ссылка под содержимым на 360 при четырёх вкладках, ссылка в профиле', async ({ browser }) => {
  const wide = await newContext(browser, 1280)
  try {
    const page = await wide.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    const nav = page.getByRole('navigation', { name: 'Разделы' })
    const names = (await nav.getByRole('link').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())
    expect(names.indexOf('Поддержка')).toBe(names.indexOf('Помощник по правилам') + 1)
    await nav.getByRole('link', { name: 'Поддержка', exact: true }).click()
    await expect(page).toHaveURL(`${BASE_URL}/support`)
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(nav.getByRole('link', { name: 'Поддержка', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('[data-support-link]')).toBeHidden()

    await page.goto('/profile')
    await expect(page.getByTestId('profile-support-link')).toHaveAttribute('href', '/support')
  } finally {
    await wide.close()
  }

  const narrow = await newContext(browser, 360)
  try {
    const page = await narrow.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await expect(page.locator('[data-tabbar] [data-tab]')).toHaveCount(4)
    const link = page.locator('[data-support-link]')
    await expect(link).toHaveAttribute('href', '/support')
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    const mainBox = (await page.locator('main').boundingBox())!
    expect((await link.boundingBox())!.y, 'ссылка ниже содержимого').toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 1)
    await expectNoHorizontalScroll(page, 360, '360 «Сегодня» с двумя ссылками внизу')
    await link.click()
    await expect(page).toHaveURL(`${BASE_URL}/support`)
    await expect(page.locator('[data-support-link]')).toHaveAttribute('aria-current', 'page')

    await page.goto('/profile')
    await page.getByTestId('profile-support-link').click()
    await expect(page).toHaveURL(`${BASE_URL}/support`)
  } finally {
    await narrow.close()
  }
})

test('доступ: гость уходит на вход, сотрудник видит страницу в своей оболочке (как /rules)', async ({ browser }) => {
  const guest = await newContext(browser, 360)
  try {
    const page = await guest.newPage()
    await page.goto('/support')
    await expect(page).toHaveURL(`${BASE_URL}/login`)
    await expect(page.getByText('Если плохо прямо сейчас')).toHaveCount(0)
  } finally {
    await guest.close()
  }
  const staffContext = await newContext(browser, 360)
  try {
    const page = await staffContext.newPage()
    await signIn(page, staff.login, staff.password, '/staff/requests')
    const response = await page.goto('/support')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Поддержка', level: 1 })).toBeVisible()
    await expect(page.locator('main a[href^="tel:"]')).toHaveCount(3)
  } finally {
    await staffContext.close()
  }
})

// ---------- тяжёлый вопрос в помощнике ----------

test('360: тяжёлый вопрос — карточка с номерами вместо ответа, текста в адресе и в поле нет, «спросить деканат» нет; обычный вопрос работает', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await page.goto('/assistant?q=' + encodeURIComponent(CRISIS_TEXT))
    // Адрес без текста вопроса: он не остаётся ни в строке браузера, ни в истории.
    await expect(page).toHaveURL(`${BASE_URL}/assistant?help=1`)
    expect(page.url()).not.toContain(encodeURIComponent('жить'))
    const card = page.getByTestId('assistant-help')
    await expect(card.getByRole('heading', { name: 'Похоже, вам сейчас тяжело. Вы не одни' })).toBeVisible()
    await expect(card.locator('a[href^="tel:"]')).toHaveCount(3)
    expect(await card.locator('a[href^="tel:"]').evaluateAll((els) => els.map((el) => el.getAttribute('href')))).toEqual(['tel:051', 'tel:+7495051', 'tel:112'])
    await expect(card).toContainText('Психологическая служба факультета')
    await expect(card).toContainText('деканат её не видит')
    await expect(card.getByTestId('assistant-help-support')).toHaveAttribute('href', '/support')
    // Ни ответа, ни поиска по положению, ни «спросить деканат», ни примеров; поле пустое.
    await expect(page.getByTestId('assistant-result')).toHaveCount(0)
    await expect(page.getByTestId('assistant-escalate')).toHaveCount(0)
    await expect(page.locator('[data-example]')).toHaveCount(0)
    await expect(page.getByLabel('Ваш вопрос')).toHaveValue('')
    await expectNoHorizontalScroll(page, 360, '360 помощник, карточка поддержки')

    // Регистр, «ё», повторённый параметр: всё тот же результат.
    const variants = ['НЕ ХОЧУ ЖИТЬ', 'всё бессмысленно', `?q=${encodeURIComponent('пересдача')}&q=${encodeURIComponent(CRISIS_TEXT)}`]
    for (const variant of variants) {
      await page.goto(variant.startsWith('?') ? `/assistant${variant}` : '/assistant?q=' + encodeURIComponent(variant))
      await expect(page, variant).toHaveURL(`${BASE_URL}/assistant?help=1`)
      await expect(page.getByTestId('assistant-help')).toBeVisible()
    }

    // Обычный вопрос про пересдачу и «нет смысла сдавать реферат» — не тяжёлые: поиск по положению работает, карточки нет.
    await page.goto('/assistant?q=' + encodeURIComponent('Как пересдать экзамен?'))
    await expect(page.getByTestId('assistant-result')).toBeVisible()
    await expect(page.getByTestId('assistant-help')).toHaveCount(0)
    await page.goto('/assistant?q=' + encodeURIComponent('нет смысла сдавать реферат?'))
    await expect(page).toHaveURL(/\/assistant\?q=/)
    await expect(page.getByTestId('assistant-help')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('форма без скриптов: тяжёлый вопрос тоже даёт карточку', async ({ browser }) => {
  const context = await newContext(browser, 360, false)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    await page.goto('/assistant')
    await page.getByLabel('Ваш вопрос').fill(CRISIS_TEXT)
    await page.getByRole('button', { name: 'Спросить' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/assistant?help=1`)
    await expect(page.getByTestId('assistant-help')).toBeVisible()
    await expect(page.getByTestId('assistant-result')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

// ---------- календарь: сроки и экзамены ----------

/** Дата плюс дни: своя запись, чтобы не проверять функцию приложения её же ответом. */
function plus(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Какие экзамены и зачёты должны попасть в файл по плану набора: не сданы, дата не раньше сегодня; окно — 14 дней или вся сессия, если конец ближе 60 дней. */
function expectedExamSummaries(rows: PlannedRow[], today: string): string[] {
  const open = rows.filter((r) => r.state !== 'passed' && r.examDate !== null && r.examDate >= today)
  const end = open.reduce((max, r) => (r.examDate! > max ? r.examDate! : max), '')
  const base = plus(today, 13)
  const days = end ? (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000 : 99
  const last = end && days < 60 && end > base ? end : base
  return open
    .filter((r) => r.examDate! <= last)
    .map((r) => `${r.controlKind === 'credit' ? 'Зачёт' : 'Экзамен'}: ${r.name}`)
    .sort()
}

function parseEvents(ics: string): string[][] {
  return ics
    .replace(/\r\n /g, '')
    .split('BEGIN:VEVENT\r\n')
    .slice(1)
    .map((chunk) => chunk.split('END:VEVENT')[0]!.split('\r\n').filter(Boolean))
}

const field = (event: string[], name: string) => event.find((l) => l.startsWith(name))

test('календарь: «Срок: …» с напоминанием за день, «Экзамен/Зачёт: …» с напоминанием в 8:00 по Москве; у пар напоминаний нет; чужих данных нет', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    const response = await page.request.get('/schedule/calendar.ics')
    expect(response.status()).toBe(200)
    const body = await response.text()
    const events = parseEvents(body)
    const today = todayIn(TZ)
    const plan = planGrades(today, student1!.login)

    // Пары — события без VALARM.
    const lessons = events.filter((e) => !/^SUMMARY:(Срок|Экзамен|Зачёт): /.test(field(e, 'SUMMARY:') ?? ''))
    expect(lessons.length, 'пары в файле остались').toBeGreaterThan(0)
    for (const lesson of lessons) expect(lesson.join('\n')).not.toContain('VALARM')

    // Сроки: каждое событие — работа своей группы со сроком в окне 14 дней; напоминание за сутки; событие на весь день.
    const windowWorks = new Set(plan.rows.flatMap((r) => r.works).filter((w) => w.dueDate >= today && w.dueDate <= plus(today, 13)).map((w) => `Срок: ${w.title}`))
    const deadlines = events.filter((e) => (field(e, 'SUMMARY:') ?? '').startsWith('SUMMARY:Срок: '))
    for (const e of deadlines) {
      const summary = field(e, 'SUMMARY:')!.slice('SUMMARY:'.length)
      expect(windowWorks.has(summary), `«${summary}» — работа группы в окне 14 дней`).toBe(true)
      expect(e.some((l) => /^DTSTART;VALUE=DATE:\d{8}$/.test(l))).toBe(true)
      expect(e).toContain('TRIGGER:-P1D')
      expect(e).toContain('BEGIN:VALARM')
    }
    expect(deadlines.length, 'сроков не больше, чем работ в окне').toBeLessThanOrEqual(windowWorks.size)

    // Экзамены и зачёты: ровно те, что даёт план; напоминание — абсолютное, 8:00 по Москве (05:00 UTC) в день экзамена.
    const exams = events.filter((e) => /^SUMMARY:(Экзамен|Зачёт): /.test(field(e, 'SUMMARY:') ?? ''))
    expect(exams.map((e) => field(e, 'SUMMARY:')!.slice('SUMMARY:'.length)).sort()).toEqual(expectedExamSummaries(plan.rows, today))
    for (const e of exams) {
      const start = field(e, 'DTSTART')!
      const date = start.replace(/^DTSTART(;VALUE=DATE)?:/, '').slice(0, 8)
      const alarm = field(e, 'TRIGGER;VALUE=DATE-TIME:')
      expect(alarm, 'у экзамена абсолютное напоминание').toBeDefined()
      expect(alarm, 'в 8:00 по Москве').toBe(`TRIGGER;VALUE=DATE-TIME:${date}T050000Z`)
      expect(e).not.toContain('TRIGGER:-P1D')
    }

    // Чужих данных нет: ни сроков, ни экзаменов другой группы набора.
    const other = planGrades(today, student2!.login)
    const mine = new Set(plan.rows.map((r) => r.name))
    for (const row of other.rows) {
      if (mine.has(row.name)) continue
      expect(body, `дисциплина другой группы «${row.name}»`).not.toContain(`: ${row.name}`)
    }
    for (const work of other.rows.flatMap((r) => r.works)) {
      if (plan.rows.some((r) => r.works.some((w) => w.title === work.title))) continue
      expect(body, `работа другой группы «${work.title}»`).not.toContain(`Срок: ${work.title}`)
    }
  } finally {
    await context.close()
  }
})

// ---------- лента «Напоминания» ----------

test('лента: строки «Завтра срок» и «Сегодня экзамен» считаются на лету, не входят в «Непрочитанных» и видны под «Все» и «Напоминания», не под «Новости»', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student1!.login, student1!.password, '/')
    const today = todayIn(TZ)
    const plan = planGrades(today, student1!.login)
    const examsToday = plan.rows
      .filter((r) => r.state !== 'passed' && r.examDate === today)
      .map((r) => `Сегодня ${r.controlKind === 'credit' ? 'зачёт' : 'экзамен'}: ${r.name}`)
      .sort()
    const worksTomorrow = new Set(plan.rows.flatMap((r) => r.works).filter((w) => w.dueDate === plus(today, 1)).map((w) => `Завтра срок: ${w.title}`))

    const read = async (filter: string) => {
      await page.goto(filter ? `/notifications?filter=${filter}` : '/notifications')
      await expect(page.getByTestId('unread-line')).toBeVisible()
      const rows = page.getByTestId('time-reminders').locator('li[data-kind]')
      const titles = (await rows.locator('span.font-bold').allTextContents()).map((t) => t.trim())
      const unread = Number(((await page.getByTestId('unread-line').textContent()) ?? '').replace(/\D+/g, ''))
      return { titles, unread, feedCards: await page.locator('main ul > li').count() }
    }

    const all = await read('')
    const reminders = await read('reminders')
    const news = await read('news')

    const exams = all.titles.filter((t) => t.startsWith('Сегодня '))
    expect(exams.sort(), 'экзамены сегодня — по плану').toEqual(examsToday)
    for (const t of all.titles.filter((x) => x.startsWith('Завтра срок: '))) expect(worksTomorrow.has(t), `«${t}» — работа со сроком завтра`).toBe(true)
    for (const t of all.titles) expect(t).toMatch(/^(Завтра срок|Сегодня (экзамен|зачёт)): .+/)
    expect(reminders.titles).toEqual(all.titles)
    expect(news.titles, 'под «Новости и объявления» их нет').toEqual([])
    // Число непрочитанного одно и то же: строки времени в него не входят; обычная лента (ul > li) не затронута.
    expect(reminders.unread).toBe(all.unread)
    expect(news.unread).toBe(all.unread)
    expect(all.feedCards).toBeGreaterThan(0)
    await expectNoHorizontalScroll(page, 360, '360 уведомления')
  } finally {
    await context.close()
  }
})
