// Защита входа на экране 360×800 (пакет 3.1, ADR-0003, Э-1): понятные тексты отказов, ограничение частых попыток,
// новая кука после входа (В-08), внутренний адрес возврата (В-12), журнал событий безопасности в выводе сервера
// (В-03, Ж-02, Ж-03). Лимиты не выключаются: каждый тест шлёт свой адрес заголовком, как прокси (helpers/address.ts).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')

const CANARY = 'PWD-CANARY-e2e-5d1b'
let server: RunningServer | null = null

test.beforeAll(async () => {
  server = await startServer()
})
test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
})

async function visitor(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ extraHTTPHeaders: addressHeaders() })
  return { context, page: await context.newPage() }
}

async function submitLogin(page: Page, login: string, password: string): Promise<void> {
  await fillLogin(page, login, password)
  const answered = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/login')
  await page.getByRole('button', { name: 'Войти' }).click()
  await answered
  // Ответ получен, но форма ещё обновляется: следующий ввод ждёт, пока кнопка снова станет доступной.
  // Если ответ — переход на другую страницу, кнопки уже нет, и ждать нечего.
  await expect(page.getByRole('button', { name: 'Войти' })).toBeEnabled({ timeout: 3000 }).catch(() => undefined)
}

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth).toBe(360)
}

test('Э-1: шесть неверных входов — на шестом «Повторите через…»; логин остаётся в поле, пароль нет', async ({ browser }) => {
  const { context, page } = await visitor(browser)
  try {
    await page.goto('/login')
    const alert = page.locator('form').getByRole('alert')
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await submitLogin(page, student1.login, `${CANARY}-${attempt}`)
      await expect(alert, `попытка ${attempt}`).toHaveText('Неверный логин или пароль')
    }
    // Шестая попытка сразу за пятой: после пятой неверной пара ждёт секунду.
    await submitLogin(page, student1.login, `${CANARY}-6`)
    await expect(alert).toHaveText(/^Слишком много попыток\. Повторите через \d+ с$/)
    // Логин остался в поле, пароль очищен, сообщение связано с полями для экранных чтецов.
    await expect(page.getByLabel('Логин')).toHaveValue(student1.login)
    await expect(page.getByLabel('Пароль')).toHaveValue('')
    await expect(alert).toHaveAttribute('id', 'login-error')
    await expect(page.getByLabel('Логин')).toHaveAttribute('aria-describedby', 'login-error')
    await expect(page.getByLabel('Пароль')).toHaveAttribute('aria-describedby', 'login-error')
    await expect(page).toHaveURL(`${BASE_URL}/login`)
    await expectNoHorizontalScroll(page, 'Э-1 с отказом')

    // Журнал сервера: неудачные входы и отказ «подождите» записаны, пароля-метки в нём нет (В-03, Ж-02, Ж-03).
    await expect.poll(() => (server!.output().match(/"event":"login_failed"/g) ?? []).length).toBeGreaterThanOrEqual(5)
    await expect.poll(() => server!.output().includes('"event":"login_wait"')).toBe(true)
    expect(server!.output()).not.toContain(CANARY)
    expect(server!.output()).not.toContain(student1.password)
  } finally {
    await context.close()
  }
})

test('Э-1: пустые поля — подсказка без попытки входа; верный вход после неверного проходит', async ({ browser }) => {
  const { context, page } = await visitor(browser)
  try {
    await page.goto('/login')
    const before = (server!.output().match(/"event":"login_/g) ?? []).length
    await submitLogin(page, '', '')
    await expect(page.locator('form').getByRole('alert')).toHaveText('Введите логин и пароль')
    await submitLogin(page, student1.login, '')
    await expect(page.locator('form').getByRole('alert')).toHaveText('Введите логин и пароль')
    await expect(page.getByLabel('Логин')).toHaveValue(student1.login)
    // Пустые поля до базы не доходят: ни одной записи о попытке входа.
    expect((server!.output().match(/"event":"login_/g) ?? []).length).toBe(before)
    await submitLogin(page, student1.login, student1.password)
    await expect(page).toHaveURL(`${BASE_URL}/`)
  } finally {
    await context.close()
  }
})

test('Э-1: с одного адреса больше 30 попыток за 10 минут — «С вашего адреса слишком много попыток входа»', async ({ browser }) => {
  const { context, page } = await visitor(browser)
  try {
    await page.goto('/login')
    // Разные логины: пары «адрес и логин» не ждут, считается только адрес.
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      await submitLogin(page, `выдуманный-${attempt}`, `${CANARY}-${attempt}`)
    }
    await expect(page.locator('form').getByRole('alert')).toHaveText('Неверный логин или пароль')
    await submitLogin(page, student1.login, student1.password)
    await expect(page.locator('form').getByRole('alert')).toHaveText(/^С вашего адреса слишком много попыток входа\. Повторите через \d+ мин$/)
    await expect(page).toHaveURL(`${BASE_URL}/login`)
    await expectNoHorizontalScroll(page, 'Э-1 с лимитом адреса')
    await expect.poll(() => server!.output().includes('"event":"login_ip_limited"')).toBe(true)
    expect(server!.output()).not.toContain(CANARY)
  } finally {
    await context.close()
  }
})

test('В-08: до входа куки сессии нет, после входа она новая; повторный вход и вход с другого устройства дают другие', async ({ browser }) => {
  const { context, page } = await visitor(browser)
  const sessionCookie = async (ctx: BrowserContext) => (await ctx.cookies()).find((c) => c.name === '__Host-session')
  try {
    await page.goto('/login')
    expect(await sessionCookie(context), 'кука до входа').toBeUndefined()
    await fillLogin(page, student1.login, student1.password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/`)
    const first = await sessionCookie(context)
    expect(first, 'кука после входа').toBeDefined()
    expect(first!.value).toMatch(/^[A-Za-z0-9_-]{43}$/)

    // Выход гасит куку; новый вход выдаёт другой токен, а не прежний.
    await page.goto('/profile')
    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/login`)
    expect(await sessionCookie(context), 'кука после выхода').toBeUndefined()
    await fillLogin(page, student1.login, student1.password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/`)
    const again = await sessionCookie(context)
    expect(again!.value).not.toBe(first!.value)

    // Другое устройство под тем же аккаунтом — третий токен.
    const second = await visitor(browser)
    try {
      await second.page.goto('/login')
      await fillLogin(second.page, student1.login, student1.password)
      await second.page.getByRole('button', { name: 'Войти' }).click()
      await expect(second.page).toHaveURL(`${BASE_URL}/`)
      const other = await sessionCookie(second.context)
      expect(other!.value).not.toBe(again!.value)
      expect(other!.value).not.toBe(first!.value)
    } finally {
      await second.context.close()
    }

    // Подложенная до входа кука сессией не становится: сервер сессий по присланному значению не создаёт.
    const planted = await fetch(`${BASE_URL}/`, { headers: { cookie: '__Host-session=planted-before-login', ...addressHeaders() }, redirect: 'manual' })
    expect([302, 303, 307, 308]).toContain(planted.status)
    expect(new URL(planted.headers.get('location') ?? '', BASE_URL).pathname).toBe('/login')
  } finally {
    await context.close()
  }
})

for (const next of ['https://evil.example', '//evil.example', '/\\evil.example']) {
  test(`В-12: /login?next=${next} после входа ведёт на /`, async ({ browser }) => {
    const { context, page } = await visitor(browser)
    try {
      await page.goto(`/login?next=${encodeURIComponent(next)}`)
      await fillLogin(page, student2.login, student2.password)
      await page.getByRole('button', { name: 'Войти' }).click()
      await expect(page).toHaveURL(`${BASE_URL}/`)
      expect(new URL(page.url()).origin).toBe(BASE_URL)
    } finally {
      await context.close()
    }
  })
}

test('В-10: вход как серверное действие не принимает запрос с чужого сайта', async ({ browser }) => {
  const { context, page } = await visitor(browser)
  try {
    await page.goto('/login')
    // Настоящий запрос действия «войти» перехватывается и обрывается; потом его повторяют с другим Origin.
    let captured: { headers: Record<string, string>; body: Buffer } | null = null
    await page.route('**/login', async (route) => {
      const req = route.request()
      if (req.method() === 'POST' && req.headers()['next-action']) {
        captured = { headers: req.headers(), body: req.postDataBuffer() ?? Buffer.alloc(0) }
        await route.abort()
        return
      }
      await route.continue()
    })
    await fillLogin(page, student2.login, student2.password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect.poll(() => captured !== null).toBe(true)
    await page.unroute('**/login')
    const action = captured!

    async function replay(origin: string | null): Promise<{ status: number; setCookie: string }> {
      const headers: Record<string, string> = { ...addressHeaders() }
      for (const name of ['next-action', 'next-router-state-tree', 'content-type', 'accept']) {
        if (action.headers[name]) headers[name] = action.headers[name]
      }
      if (origin !== null) headers.origin = origin
      const res = await fetch(`${BASE_URL}/login`, { method: 'POST', headers, body: new Uint8Array(action.body), redirect: 'manual' })
      return { status: res.status, setCookie: res.headers.get('set-cookie') ?? '' }
    }

    // Чужой сайт и сайт с чужим хостом в начале адреса: Next.js сверяет Origin с Host и отвергает запрос.
    for (const origin of ['https://evil.example', 'null', `${BASE_URL}.evil.example`]) {
      const res = await replay(origin)
      expect(res.setCookie, `Origin ${origin}: сессия выдана чужому сайту, статус ${res.status}`).not.toContain('__Host-session=')
    }
    // Запрос совсем без Origin Next.js принимает: это находка В-10 (в документации поведение не описано), записана в отчёт
    // пакета. Тест её фиксирует, но не одобряет: защита здесь — кука SameSite=Lax (чужой сайт не отправляет её с POST),
    // а не проверка Origin. Браузер всегда присылает Origin с POST, поэтому такой запрос может прислать только не-браузер.
    const bare = await replay(null)
    const note = `без Origin: статус ${bare.status}, сессия ${bare.setCookie.includes('__Host-session=') ? 'выдана' : 'не выдана'}`
    test.info().annotations.push({ type: 'В-10', description: note })
    console.log(`В-10, ${note}`)
    // Контроль: тот же запрос со своим Origin проходит и выдаёт сессию, значит, отказы выше не из-за испорченного запроса.
    const own = await replay(BASE_URL)
    expect(own.setCookie, `свой Origin: статус ${own.status}`).toContain('__Host-session=')
  } finally {
    await context.close()
  }
})

test('Лимит записи: 11-я заявка с одного адреса — отказ текстом на экране новой заявки; отказ по роли записан в журнал', async ({ browser }) => {
  const { context, page } = await visitor(browser)
  try {
    await page.goto('/login')
    await fillLogin(page, student2.login, student2.password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/`)

    // Сотрудник на адресе студента и студент на адресе сотрудника: 403 и запись об отказе по роли.
    const denied = await page.goto('/staff/requests')
    expect(denied!.status()).toBe(403)
    await expect.poll(() => server!.output().includes('"event":"access_denied_role"')).toBe(true)

    for (let n = 1; n <= 10; n += 1) {
      await page.goto('/requests/new?type=dean_certificate')
      await page.getByRole('button', { name: 'Отправить' }).click()
      await expect(page, `заявка ${n}`).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    }
    await page.goto('/requests/new?type=dean_certificate')
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect(page).toHaveURL(/\/requests\/new\?type=dean_certificate&limit=pair$/)
    await expect(page.getByTestId('request-limit')).toHaveText('С вашего адреса сегодня подано слишком много заявок. Попробуйте завтра')
    await expect(page.getByTestId('request-limit')).toHaveAttribute('role', 'alert')
    await expectNoHorizontalScroll(page, 'Э-7 с отказом по лимиту')
    await expect.poll(() => server!.output().includes('"event":"request_limit"')).toBe(true)

    // Выдуманный код отказа в адресе текста не даёт.
    await page.goto('/requests/new?type=dean_certificate&limit=%3Cb%3Ex%3C%2Fb%3E')
    await expect(page.getByTestId('request-limit')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
