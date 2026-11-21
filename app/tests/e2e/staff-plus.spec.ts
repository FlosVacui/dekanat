// 20.11, деканат: «Стипендии» с печатью, карточка студента (стипендия, рейтинг, фото), заявки пачкой, пункты положения в ответе,
// помощник для сотрудника, «Снять» объявление, оценки выдачи на сводке. Вымышленные аккаунты основного набора.
// Состояние, которое создают тесты (заявки, вопрос, объявление, фото), убирается в конце. Снимки 360 и 1280 пишутся в SCREENSHOT_DIR.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1] = MAIN_COHORT.students
const staff = MAIN_COHORT.staff
if (!student1) throw new Error('В основном наборе должен быть студент')

const SHOT_DIR = process.env.SCREENSHOT_DIR ?? join(process.env.LOCALAPPDATA ?? fileURLToPath(new URL('../../', import.meta.url)), 'dekanat-runs', 'staff-plus-shots')
const TAG = `Деканат-е2е ${Date.now()}`
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63000100000005000100', 'hex')

test.describe.configure({ mode: 'serial' })

let server: RunningServer | null = null
let studentId = ''
const requestIds: string[] = []
let questionId = ''

function ownerUrl(): string {
  if (!process.env.DATABASE_OWNER_URL) process.loadEnvFile(process.env.ENV_FILE || fileURLToPath(new URL('../../../.env', import.meta.url)))
  const url = process.env.DATABASE_OWNER_URL
  if (!url) throw new Error('Нет DATABASE_OWNER_URL')
  return url
}

async function withOwner<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ownerUrl() })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

test.beforeAll(async () => {
  server = await startServer()
  await withOwner(async (c) => {
    studentId = (await c.query(`select id from users where login = $1`, [student1.login])).rows[0].id
    for (let i = 0; i < 3; i += 1) {
      const res = await c.query(`insert into requests (student_id, kind, status, ip) values ($1, 'financial_aid', 'submitted', 'e2e-staff-plus') returning id`, [studentId])
      requestIds.push(res.rows[0].id)
    }
    questionId = (
      await c.query(`insert into questions (student_id, topic, body, status, ip) values ($1, 'documents', $2, 'sent', 'e2e-staff-plus') returning id`, [
        studentId,
        `${TAG}: Как оформить академический отпуск и какие нужны документы?`,
      ])
    ).rows[0].id
  })
})

test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
  await withOwner(async (c) => {
    await c.query(`delete from notifications where link = any($1::text[])`, [requestIds.map((id) => `/requests/${id}`)])
    await c.query(`delete from requests where id = any($1::uuid[])`, [requestIds])
    if (questionId) await c.query(`delete from questions where id = $1`, [questionId])
    await c.query(`delete from announcements where title like $1`, [`${TAG}%`])
    if (studentId) await c.query(`delete from user_avatars where user_id = $1`, [studentId])
  })
})

async function expectNoHorizontalScroll(page: Page, where: string, width = 360): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth, `${where}: ширина окна`).toBe(width)
}

async function shot(page: Page, name: string, width: 360 | 1280): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: join(SHOT_DIR, `${name}-${width}.png`), fullPage: true })
}

async function signIn(
  browser: Browser,
  login: string,
  password: string,
  width: 360 | 1280 = 360,
  javaScriptEnabled = true,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(
    width === 360
      ? { baseURL: BASE_URL, extraHTTPHeaders: addressHeaders(), viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow', javaScriptEnabled }
      : { baseURL: BASE_URL, extraHTTPHeaders: addressHeaders(), viewport: { width: 1280, height: 800 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow', javaScriptEnabled },
  )
  const page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  return { context, page }
}

const asStaff = (browser: Browser, width: 360 | 1280 = 360, js = true) => signIn(browser, staff.login, staff.password, width, js)

for (const width of [360, 1280] as const) {
  test(`«Стипендии» на ${width} px: пункт меню, статусы, фильтры, поиск, без прокрутки вбок`, async ({ browser }) => {
    const { context, page } = await asStaff(browser, width)
    try {
      const menu = page.getByRole('navigation', { name: 'Меню сотрудника' })
      await menu.getByRole('link', { name: 'Стипендии' }).click()
      await expect(page).toHaveURL(`${BASE_URL}/staff/scholarships`)
      await expect(page.getByRole('heading', { name: 'Стипендии', level: 1 })).toBeVisible()
      await expect(menu.getByRole('link', { name: 'Стипендии' })).toHaveAttribute('aria-current', 'page')
      await expectNoHorizontalScroll(page, `стипендии ${width}`, width)

      // Видна одна из двух раскладок: карточки на телефоне, таблица от 1024 px.
      const rows = page.getByTestId(width === 360 ? 'sch-card' : 'sch-row')
      expect(await rows.count()).toBeGreaterThan(2)
      // Студент 1 — с долгом: «Не назначена: есть долг», суммы нет.
      const own = rows.filter({ hasText: student1.fullName })
      await expect(own).toHaveCount(1)
      await expect(own).toContainText('Не назначена: есть долг')
      await expect(own).toContainText('—')
      await shot(page, 'staff-scholarships', width)

      // Фильтр «Назначена»: только назначенные. «Не назначена»: ровно те, кто остался. Число строк читается после перехода.
      const total = await rows.count()
      const pick = async (filter: string): Promise<number> => {
        await page.locator(`[data-filter="${filter}"]`).click()
        await expect(page.locator(`[data-filter="${filter}"]`)).toHaveAttribute('aria-current', 'page')
        await page.waitForLoadState('networkidle')
        return rows.count()
      }
      const assigned = await pick('assigned')
      await expect(page).toHaveURL(`${BASE_URL}/staff/scholarships?show=assigned`)
      await expect(rows.filter({ hasText: 'Не назначена' })).toHaveCount(0)
      const notAssigned = await pick('not_assigned')
      expect(assigned + notAssigned).toBe(total)
      await expect(rows.filter({ hasText: 'Назначена академическая' })).toHaveCount(0)
      const raised = await pick('raised')
      await expect(page).toHaveURL(`${BASE_URL}/staff/scholarships?show=raised`)
      expect(raised).toBeLessThanOrEqual(assigned)

      // Поиск по ФИО (форма GET, без скриптов): одна строка.
      await page.goto(`/staff/scholarships?q=${encodeURIComponent(student1.fullName.split(' ')[0]!)}`)
      await expect(rows.filter({ hasText: student1.fullName })).toHaveCount(1)
      await page.goto('/staff/scholarships?show=мусор&q=яяяяя')
      await expect(page.getByText('Ничего не найдено')).toBeVisible()
    } finally {
      await context.close()
    }
  })
}

test('«Стипендии»: печатная страница кандидатов — заголовок, без подписей, кнопка «Печать» скрыта при печати', async ({ browser }) => {
  const { context, page } = await asStaff(browser, 360)
  try {
    await page.goto('/staff/scholarships')
    await page.getByTestId('print-link').click()
    await expect(page).toHaveURL(`${BASE_URL}/staff/scholarships/print`)
    await expect(page.getByTestId('print-title')).toHaveText('Проект списка для стипендиальной комиссии · пример для прототипа')
    await expect(page.getByRole('button', { name: 'Печать' })).toBeVisible()
    await expectNoHorizontalScroll(page, 'печать 360')
    // Кандидаты — строки таблицы или пустое сообщение; подписей и реквизитов нет.
    expect((await page.getByTestId('print-row').count()) + (await page.getByTestId('print-empty').count())).toBeGreaterThan(0)
    await expect(page.locator('body')).not.toContainText(/подпись|М\.П\.|печать организации|ИНН|БИК/i)
    await shot(page, 'staff-scholarships-print', 360)
    // В режиме печати панель с кнопкой скрыта.
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByRole('button', { name: 'Печать' })).toBeHidden()
    await expect(page.getByTestId('print-title')).toBeVisible()
    // Кнопка вызывает диалог печати браузера.
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => {
      ;(window as unknown as { __printed: number }).__printed = 0
      window.print = () => {
        ;(window as unknown as { __printed: number }).__printed += 1
      }
    })
    await page.getByRole('button', { name: 'Печать' }).click()
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1)
  } finally {
    await context.close()
  }
})

for (const width of [360, 1280] as const) {
  test(`карточка студента на ${width} px: стипендия с пунктом, рейтинг, фото`, async ({ browser }) => {
    await withOwner((c) => c.query(`insert into user_avatars (user_id, mime, data) values ($1, 'image/png', $2) on conflict (user_id) do update set data = excluded.data`, [studentId, PNG]))
    const { context, page } = await asStaff(browser, width)
    try {
      await page.goto(`/staff/students/${studentId}`)
      await expect(page.getByRole('heading', { name: student1.fullName, level: 1 })).toBeVisible()
      await expect(page.getByTestId('student-scholarship')).toContainText('Не назначена: есть долг')
      const point = page.getByTestId('student-scholarship-point')
      await expect(point).toHaveText('п. 3.2')
      await expect(point).toHaveAttribute('href', '/rules#p-3-2')
      await expect(page.getByTestId('student-raised')).toContainText('нет')
      await expect(page.getByTestId('student-rating')).toContainText(/Рейтинг в группе: \d+ из \d+|Рейтинг появится/)
      await expect(page.getByTestId('student-photo')).toBeVisible()
      await expectNoHorizontalScroll(page, `карточка ${width}`, width)
      await shot(page, 'staff-student-card', width)

      // Фото: 200, личный ответ, тип не угадывается.
      const photo = await page.request.get(`/staff/students/${studentId}/photo`)
      expect(photo.status()).toBe(200)
      expect(photo.headers()['cache-control']).toBe('private, no-store')
      expect(photo.headers()['x-content-type-options']).toBe('nosniff')
      expect(photo.headers()['content-type']).toBe('image/png')
      // Несуществующий номер и мусор — 404, как чужой набор.
      expect((await page.request.get('/staff/students/00000000-0000-4000-8000-000000000000/photo')).status()).toBe(404)
      expect((await page.request.get('/staff/students/не-номер/photo')).status()).toBe(404)
    } finally {
      await context.close()
    }
  })
}

test('фото студента и экраны деканата: студенту 403, гостю 401 или вход', async ({ browser, request }) => {
  const guest = await request.get(`${BASE_URL}/staff/students/${studentId}/photo`, { headers: addressHeaders() })
  expect(guest.status()).toBe(401)
  const { context, page } = await signIn(browser, student1.login, student1.password)
  try {
    expect((await page.request.get(`/staff/students/${studentId}/photo`)).status()).toBe(403)
    for (const path of ['/staff/scholarships', '/staff/scholarships/print']) expect((await page.goto(path))?.status(), path).toBe(403)
  } finally {
    await context.close()
  }
})

async function markOnly(page: Page, ids: string[]): Promise<void> {
  for (const box of await page.getByTestId('bulk-check').all()) await box.uncheck()
  for (const id of ids) await page.locator(`input[name="id"][value="${id}"]`).check()
}

test('заявки пачкой: допустимые переходы проходят, недопустимые пропускаются с причиной; студент получает уведомления', async ({ browser }) => {
  const { context, page } = await asStaff(browser, 360)
  try {
    await page.goto(`/staff/requests?q=${encodeURIComponent(student1.fullName)}`)
    const [r1, r2, r3] = requestIds as [string, string, string]
    await markOnly(page, [r1, r2])
    await expect(page.getByTestId('bulk-count')).toHaveText('Отмечено: 2')
    await shot(page, 'staff-requests-bulk', 360)

    // «Выдана» из «Подана» недопустимо: ничего не меняется, обе пропущены.
    await page.getByTestId('bulk-issued').click()
    await expect(page.getByTestId('bulk-result')).toHaveText('Изменено 0, пропущено 2: в этот статус их нельзя перевести — 2')
    await expect(page).toHaveURL(/done=0&skipped=2/)
    // Поиск сохранился.
    await expect(page.getByRole('searchbox', { name: 'Поиск по ФИО студента' })).toHaveValue(student1.fullName)

    // «В работу» для двух: изменено 2.
    await markOnly(page, [r1, r2])
    await page.getByTestId('bulk-in_progress').click()
    await expect(page.getByTestId('bulk-result')).toHaveText('Изменено 2')

    // Смешанная пачка: две «В работе» и одна «Подана» → «Готова»: проходят две, третья пропущена.
    await markOnly(page, [r1, r2, r3])
    await page.getByTestId('bulk-ready').click()
    await expect(page.getByTestId('bulk-result')).toHaveText('Изменено 2, пропущено 1: в этот статус их нельзя перевести — 1')
    await expectNoHorizontalScroll(page, 'заявки пачкой 360')
    await shot(page, 'staff-requests-bulk-result', 360)

    // Каждая смена оставила историю и уведомление студенту — как у одиночной.
    const counts = await withOwner(async (c) => ({
      events: (await c.query(`select request_id, status from request_events where request_id = any($1::uuid[]) order by created_at`, [[r1, r2, r3]])).rows,
      notes: (await c.query(`select title from notifications where link = any($1::text[])`, [[r1, r2, r3].map((id) => `/requests/${id}`)])).rows,
      statuses: (await c.query(`select id, status from requests where id = any($1::uuid[])`, [[r1, r2, r3]])).rows,
    }))
    expect(counts.events).toHaveLength(4)
    expect(counts.notes).toHaveLength(4)
    const status = new Map(counts.statuses.map((r) => [r.id, r.status]))
    expect([status.get(r1), status.get(r2), status.get(r3)]).toEqual(['ready', 'ready', 'submitted'])

    // Пустая пачка и подмена целевого статуса: отказ, ничего не меняется.
    await markOnly(page, [])
    await page.getByTestId('bulk-ready').evaluate((el) => ((el as HTMLButtonElement).disabled = false))
    await page.getByTestId('bulk-ready').click()
    await expect(page.getByTestId('bulk-result')).toContainText('Отметьте хотя бы одну заявку')
  } finally {
    await context.close()
  }
})

test('заявки пачкой: разметка — обычная форма (флажки name="id", кнопки name="target"), без скриптов она отправляется как есть', async ({ browser }) => {
  // Список заявок стоит под границей ожидания (её требует loading-boundary.test.ts), и без скриптов браузер показывает «Загружаем…»:
  // это прежнее свойство страницы. Поэтому проверяется разметка, которую отдаёт сервер: поля и кнопки — части одной формы.
  const { context, page } = await asStaff(browser, 360)
  try {
    const html = await (await page.request.get(`/staff/requests?q=${encodeURIComponent(student1.fullName)}`)).text()
    const form = html.slice(html.indexOf('id="bulk-form"'))
    expect(form).toContain('name="id"')
    expect(form).toContain('type="checkbox"')
    for (const target of ['in_progress', 'ready', 'issued']) expect(form).toMatch(new RegExp(`name="target"[^>]*value="${target}"|value="${target}"[^>]*name="target"`))
    // Подтверждающей кнопки отклонения в пачке нет.
    expect(form).not.toMatch(/name="target"[^>]*value="rejected"/)
  } finally {
    await context.close()
  }
})

test('вопрос: пункты положения по теме, «Вставить в ответ» кладёт фразу в поле и ничего не отправляет; без скриптов — список ссылок', async ({ browser }) => {
  const { context, page } = await asStaff(browser, 360)
  try {
    await page.goto(`/staff/questions/${questionId}`)
    const hints = page.getByTestId('hints').locator('li')
    expect(await hints.count()).toBeGreaterThan(0)
    expect(await hints.count()).toBeLessThanOrEqual(3)
    await expect(page.locator('[data-point^="5."]').first()).toBeVisible()
    await expect(hints.first().getByRole('link')).toHaveAttribute('href', /^\/rules#p-\d-\d$/)
    await expectNoHorizontalScroll(page, 'вопрос 360')

    const field = page.getByLabel('Ответ студенту')
    await field.fill('Здравствуйте!')
    await hints.first().getByTestId('insert-point').click()
    const first = await field.inputValue()
    expect(first).toMatch(/^Здравствуйте!\n\nСогласно п. \d\.\d положения: /)
    // Вторая вставка — после первой; поле остаётся управляемым формой (текст виден и после перерисовки).
    await hints.nth(0).getByTestId('insert-point').click()
    expect((await field.inputValue()).split('Согласно п.').length).toBe(3)
    await shot(page, 'staff-question-hints', 360)
    // Автоотправки нет: вопрос по-прежнему без ответа.
    await expect(page.getByTestId('staff-question-status')).not.toContainText('Отвечен')
    const state = await withOwner((c) => c.query(`select status from questions where id = $1`, [questionId]))
    expect(state.rows[0].status).toBe('sent')
  } finally {
    await context.close()
  }

  const { context: plain, page: plainPage } = await asStaff(browser, 360, false)
  try {
    await plainPage.goto(`/staff/questions/${questionId}`)
    await expect(plainPage.getByTestId('hints').getByRole('link').first()).toBeVisible()
    await expect(plainPage.getByTestId('insert-point').first()).toBeHidden()
  } finally {
    await plain.close()
  }
})

test('помощник по правилам открыт сотруднику: в его оболочке, с пунктами, без «спросить деканат»; гость уходит на вход', async ({ browser }) => {
  const { context, page } = await asStaff(browser, 360)
  try {
    const response = await page.goto('/assistant?q=' + encodeURIComponent('справка'))
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Помощник по правилам', level: 1 })).toBeVisible()
    await expect(page.getByTestId('assistant-result')).toBeVisible()
    await expect(page.getByTestId('assistant-escalate')).toHaveCount(0)
    // Оболочка сотрудника: «Выйти» есть, нижней панели студента нет.
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Разделы' })).toHaveCount(0)
    await page.getByRole('link', { name: 'К сводке' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/staff`)
    await expectNoHorizontalScroll(page, 'помощник 360')
  } finally {
    await context.close()
  }
  const guest = await browser.newContext({ baseURL: BASE_URL, extraHTTPHeaders: addressHeaders() })
  try {
    const p = await guest.newPage()
    await p.goto('/assistant')
    await expect(p).toHaveURL(`${BASE_URL}/login`)
  } finally {
    await guest.close()
  }
})

test('объявление: «Снять» — подтверждение второй кнопкой на той же странице, без скриптов; «Отмена» ничего не снимает', async ({ browser }) => {
  const { context, page } = await asStaff(browser, 360, false)
  try {
    await page.goto('/staff/announcements')
    await page.getByLabel('Кому').selectOption({ label: student1.groupName })
    await page.getByLabel('Заголовок').fill(TAG)
    await page.getByLabel('Текст').fill('Проверка снятия')
    await page.getByRole('button', { name: 'Отправить объявление' }).click()
    await expect(page.getByTestId('announcement-result')).toContainText('Объявление отправлено')
    const item = page.getByTestId('announcement-list').locator('li', { hasText: TAG })
    await expect(item).toHaveCount(1)

    // Первое нажатие ничего не удаляет: появляется вопрос.
    await item.getByTestId('remove-link').click()
    await expect(page).toHaveURL(/\/staff\/announcements\?remove=/)
    await expect(item.getByTestId('remove-confirm')).toContainText('Снять объявление')
    await expectNoHorizontalScroll(page, 'снять 360')
    await shot(page, 'staff-announcement-remove', 360)
    await item.getByRole('link', { name: 'Отмена' }).click()
    await expect(page).toHaveURL(`${BASE_URL}/staff/announcements`)
    await expect(page.getByTestId('announcement-list').locator('li', { hasText: TAG })).toHaveCount(1)

    // Подтверждение: «Да, снять».
    await page.getByTestId('announcement-list').locator('li', { hasText: TAG }).getByTestId('remove-link').click()
    await page.getByTestId('remove-yes').click()
    await expect(page).toHaveURL(`${BASE_URL}/staff/announcements?result=removed`)
    await expect(page.getByTestId('announcement-result')).toContainText('Объявление снято')
    await expect(page.getByTestId('announcement-list').locator('li', { hasText: TAG })).toHaveCount(0)

    // Номер не из списка в адресе подтверждения не показывает ничего.
    await page.goto('/staff/announcements?remove=00000000-0000-4000-8000-000000000000')
    await expect(page.getByTestId('remove-confirm')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('сводка: оценка выдачи за 30 дней — 👍 и 👎 по оценкам студентов набора', async ({ browser }) => {
  const issued = await withOwner(async (c) => {
    const id = (await c.query(`insert into requests (student_id, kind, status, ip, issued_on, rating, rated_at) values ($1, 'financial_aid', 'issued', 'e2e-staff-plus', current_date, -1, now()) returning id`, [studentId])).rows[0].id as string
    requestIds.push(id)
    return id
  })
  expect(issued).toBeTruthy()
  const { context, page } = await asStaff(browser, 1280)
  try {
    await page.goto('/staff')
    const line = page.getByTestId('summary-ratings')
    await expect(line).toContainText('Оценка выдачи за 30 дней')
    await expect(line).toHaveText(/👍 \d+ · 👎 [1-9]\d*/)
    await expectNoHorizontalScroll(page, 'сводка 1280', 1280)
    await shot(page, 'staff-summary', 1280)
  } finally {
    await context.close()
  }
})
