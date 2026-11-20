// 20.11, рейтинг в группе («Успеваемость») и «Сводка недели от ИИ» («Сводка» сотрудника) на экране 360×800 и 1280.
// Рейтинг: у студентов основного набора в текущем семестре итогов нет — считается последний семестр с итогами (20.11, решение
// участника А): студент 1 — 3,0, место 8 из 21 за 4 семестр; студентка 2 — 5,0, место 1 из 21 за 2 семестр. Строка «Рейтинг появится…»
// видна студенту без итогов; значения на отдельном вымышленном наборе `test-e2e-rating`, который тест создаёт под владельцем и убирает.
// Сводка: ключ модели указывает на заглушку на этом же компьютере (http://127.0.0.1:<порт>): настоящая модель не вызывается;
// заглушка записывает запрос и отвечает по данным в нём. Сервер стенда запускается один раз на весь файл. Путь «ключа нет —
// кнопки нет» здесь не проверяется: для него сервер пришлось бы перезапускать, а в песочнице разработки остановка сервера стенда
// не завершается (процесс `next-server` остаётся). Путь без ключа держат модульные тесты (`summarizeWeek` → `disabled`).
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { hashPassword } from '../../src/server/auth/password'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, PORT, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')
const staff = MAIN_COHORT.staff

const AI_NAMES = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_FOLDER_ID'] as const
const savedEnv = new Map<string, string | undefined>()
const STUB_PORT = PORT + 90
const COHORT = 'test-e2e-rating'
const PASSWORD = 'тест-рейтинг-e2e-1'
const GROUP = 'ТЕСТ-РЕЙТ-E2E'
const MOCK_SECRET = 'e2e-fake-key-0000'

let server: RunningServer | null = null
let stub: Server | null = null
const modelRequests: { authorization: string | undefined; body: { messages: { role: string; content: string }[] } }[] = []

function ownerUrl(): string {
  if (!process.env.DATABASE_OWNER_URL) {
    try {
      process.loadEnvFile(process.env.ENV_FILE || fileURLToPath(new URL('../../../.env', import.meta.url)))
    } catch {
      throw new Error('Нет DATABASE_OWNER_URL и не удалось прочитать файл окружения')
    }
  }
  return process.env.DATABASE_OWNER_URL!
}

async function withOwner<T>(run: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ownerUrl() })
  await c.connect()
  try {
    return await run(c)
  } finally {
    await c.end()
  }
}

async function removeTestCohort(): Promise<void> {
  await withOwner(async (c) => {
    await c.query(`delete from users where cohort = $1`, [COHORT])
    await c.query(`delete from groups where name = $1`, [GROUP])
  })
}

/** Группа из трёх студентов: два с итогами (4,5 и 3,5) и один без итогов. Текущий семестр — 5. */
async function createTestCohort(): Promise<void> {
  await removeTestCohort()
  const hash = await hashPassword(PASSWORD)
  await withOwner(async (c) => {
    const groupId = randomUUID()
    await c.query(`insert into groups (id, name, faculty) values ($1, $2, 'Факультет тестовых данных')`, [groupId, GROUP])
    const d1 = randomUUID()
    const d2 = randomUUID()
    for (const [id, name] of [[d1, 'Тест-А'], [d2, 'Тест-Б']] as const) {
      await c.query(`insert into disciplines (id, group_id, name, control_kind, semester) values ($1, $2, $3, 'exam', 5)`, [id, groupId, name])
    }
    const people: [string, [string, string] | null][] = [
      ['e2e-rating-top', ['5', '4']], // 4,5 — первое место
      ['e2e-rating-mid', ['4', '3']], // 3,5 — второе место
      ['e2e-rating-none', null],
    ]
    for (const [login, marks] of people) {
      const userId = randomUUID()
      await c.query(`insert into users (id, login, password_hash, role, cohort) values ($1, $2, $3, 'student', $4)`, [userId, login, hash, COHORT])
      await c.query(
        `insert into students (user_id, full_name, faculty, programme, course, group_id) values ($1, $2, 'Факультет тестовых данных', 'Тестирование', 1, $3)`,
        [userId, `Тестов ${login}`, groupId],
      )
      if (marks) {
        await c.query(`insert into grades (student_id, discipline_id, outcome) values ($1, $2, $3), ($1, $4, $5)`, [userId, d1, marks[0], d2, marks[1]])
      }
    }
  })
}

/** Заглушка модели: читает числа из сообщения и пишет четыре строки с ними. Ключ и запрос записываются для проверок. */
function startStub(): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
      req.on('end', () => {
        const body = JSON.parse(raw) as { messages: { role: string; content: string }[] }
        modelRequests.push({ authorization: req.headers.authorization, body })
        const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
        const requests = /Всего заявок: (\d+) \((\d+)\)\. Всего просрочено сейчас: (\d+)\./.exec(user)
        const questions = /Всего вопросов: (\d+) \((\d+)\)\. Всего без ответа: (\d+)\./.exec(user)
        const lines = [
          `Заявок за 7 суток подано ${requests?.[1] ?? 0}, за предыдущие 7 суток ${requests?.[2] ?? 0}.`,
          `Просрочено заявок: ${requests?.[3] ?? 0}.`,
          `Вопросов за 7 суток задано ${questions?.[1] ?? 0}, без ответа ${questions?.[3] ?? 0}.`,
          'Начните с просроченных заявок.',
        ]
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ choices: [{ message: { content: lines.join('\n') } }] }))
      })
    })
    s.listen(STUB_PORT, '127.0.0.1', () => resolve(s))
  })
}

function setAiEnv(on: boolean): void {
  for (const name of AI_NAMES) {
    if (!savedEnv.has(name)) savedEnv.set(name, process.env[name])
    process.env[name] = ''
  }
  if (on) {
    process.env.AI_BASE_URL = `http://127.0.0.1:${STUB_PORT}/v1`
    process.env.AI_API_KEY = MOCK_SECRET
    process.env.AI_MODEL = 'stub-model'
  }
}

test.beforeAll(async () => {
  stub = await startStub()
  setAiEnv(true)
  server = await startServer()
})
test.afterAll(async () => {
  // Уборка идёт, даже если остановка сервера не дождалась (в песочнице так бывает): иначе тестовый набор остался бы в базе.
  try {
    if (server) await stopServer(server)
  } finally {
    server = null
    if (stub) await new Promise<void>((r) => stub!.close(() => r()))
    await removeTestCohort()
    for (const name of AI_NAMES) {
      const value = savedEnv.get(name)
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

async function newContext(browser: Browser, width: number, javaScriptEnabled = true): Promise<BrowserContext> {
  const mobile = width < 600
  return browser.newContext({
    viewport: { width, height: 800 },
    isMobile: mobile,
    hasTouch: mobile,
    javaScriptEnabled,
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

async function expectNoHorizontalScroll(page: Page, width: number, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(clientWidth, `${where}: ширина окна`).toBe(width)
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
}

test.describe.configure({ mode: 'serial' })

for (const width of [360, 1280]) {
  // Было: «Рейтинг появится после первых итоговых оценок» у обоих (в текущем семестре итогов нет). Стало: рейтинг за прошлый семестр.
  test(`${width}: итогов в текущем семестре нет — рейтинг по прошлому семестру: 3,0 место 8 из 21 (4 семестр); 5,0 место 1 из 21 (2 семестр)`, async ({ browser }) => {
    const expectedLines = new Map<string, [string, string]>([
      [student1.login, ['Средний балл 3,0 · место 8 из 21 в группе', 'За 4 семестр, по итоговым оценкам 2–5; зачёты не входят']],
      [student2.login, ['Средний балл 5,0 · место 1 из 21 в группе', 'За 2 семестр, по итоговым оценкам 2–5; зачёты не входят']],
    ])
    for (const student of [student1, student2]) {
      const context = await newContext(browser, width)
      try {
        const page = await context.newPage()
        await signIn(page, student.login, student.password, '/')
        await page.goto('/grades')
        await expect(page.getByRole('heading', { name: 'Как у меня дела' })).toBeVisible()
        const [line, note] = expectedLines.get(student.login)!
        await expect(page.getByTestId('group-rating-line')).toHaveText(line)
        await expect(page.getByTestId('group-rating')).toContainText(note)
        await expect(page.getByTestId('group-rating-empty')).toHaveCount(0)
        // Чужие ФИО одногруппников на экране не появляются.
        const body = await page.locator('body').innerText()
        for (const mate of ['Антонова', 'Андреев', 'Гладких', 'Беляева']) expect(body).not.toContain(mate)
        await expectNoHorizontalScroll(page, width, `${width} успеваемость с рейтингом по прошлому семестру`)
      } finally {
        await context.close()
      }
    }
  })
}

for (const width of [360, 1280]) {
  test(`${width}: рейтинг со значениями: 4,5 — первое место из 3; 3,5 — второе; без оценок — пояснение; чужих имён и баллов нет`, async ({ browser }) => {
    await createTestCohort()
    const expected: [string, string | null][] = [
      ['e2e-rating-top', 'Средний балл 4,5 · место 1 из 3 в группе'],
      ['e2e-rating-mid', 'Средний балл 3,5 · место 2 из 3 в группе'],
      ['e2e-rating-none', null],
    ]
    for (const [login, line] of expected) {
      const context = await newContext(browser, width)
      try {
        const page = await context.newPage()
        await signIn(page, login, PASSWORD, '/')
        await page.goto('/grades')
        if (line) {
          await expect(page.getByTestId('group-rating-line')).toHaveText(line)
          await expect(page.getByTestId('group-rating')).toContainText('За 5 семестр, по итоговым оценкам 2–5; зачёты не входят')
        } else {
          await expect(page.getByTestId('group-rating-empty')).toBeVisible()
        }
        // Чужие имена и баллы на странице не появляются.
        const body = await page.locator('body').innerText()
        for (const other of expected.map(([l]) => `Тестов ${l}`)) expect(body).not.toContain(other)
        await expectNoHorizontalScroll(page, width, `${width} успеваемость с рейтингом, ${login}`)
      } finally {
        await context.close()
      }
    }
  })
}

test('кнопка есть; сводка из заглушки модели; подпись; в запросе нет имён; ключ только в заголовке', async ({ browser }) => {
  modelRequests.length = 0

  for (const width of [360, 1280]) {
    const context = await newContext(browser, width)
    try {
      const page = await context.newPage()
      await signIn(page, staff.login, staff.password, '/staff/requests')
      await page.goto('/staff')
      const button = page.getByTestId('week-summary-button')
      await expect(button).toBeVisible()
      expect((await button.boundingBox())!.height, 'зона касания кнопки').toBeGreaterThanOrEqual(44)
      await expectNoHorizontalScroll(page, width, `${width} сводка сотрудника с кнопкой`)
      await button.click()
      const result = page.getByTestId('week-summary-result')
      await expect(result).toBeVisible()
      await expect(result.locator('li')).toHaveCount(4)
      await expect(result).toContainText('Подготовлено ИИ по данным за 7 дней')
      await expect(result).toContainText('Начните с просроченных заявок.')
      await expect(page.getByTestId('week-summary-error')).toHaveCount(0)
      await expectNoHorizontalScroll(page, width, `${width} сводка сотрудника с результатом`)
    } finally {
      await context.close()
    }
  }

  expect(modelRequests.length).toBe(2)
  for (const request of modelRequests) {
    expect(request.authorization).toBe(`Bearer ${MOCK_SECRET}`)
    const sent = JSON.stringify(request.body)
    for (const forbidden of [student1.fullName, student2.fullName, student1.login, student2.login, 'Белозёров', 'Нестерова', 'Берёзовая']) {
      expect(sent, `в запросе модели нет «${forbidden}»`).not.toContain(forbidden)
    }
    expect(request.body.messages[1]!.content).toContain('Всего заявок:')
  }
})

test('без скриптов: форма «Сводка недели от ИИ» отправляется обычным запросом, сводка видна', async ({ browser }) => {
  const context = await newContext(browser, 360, false)
  try {
    const page = await context.newPage()
    await signIn(page, staff.login, staff.password, '/staff/requests')
    await page.goto('/staff')
    await page.getByTestId('week-summary-button').click()
    await expect(page.getByTestId('week-summary-result')).toContainText('Подготовлено ИИ по данным за 7 дней')
  } finally {
    await context.close()
  }
})

test('студент не видит «Сводку недели»: /staff ему закрыт', async ({ browser }) => {
  const context = await newContext(browser, 360)
  try {
    const page = await context.newPage()
    await signIn(page, student1.login, student1.password, '/')
    const response = await page.goto('/staff')
    expect(response?.status()).toBe(403)
    await expect(page.getByText('Сводка недели от ИИ')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
