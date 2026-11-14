// Сквозной сценарий М0 (S-2.1, раздел 7): вход, расписание, оценки, заявка, статус — на экране 360×800.
// Каждое касание — отдельный шаг теста. Десять шагов идут по порядку; номер шага стоит в названии.
// Данные — основной набор вымышленных аккаунтов (ТР-11); их пароли публичны по заданию (ТР-9.2).
import { expect, request as playwrightRequest, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { buildCohortPlan } from '../../db/seed-plan'
import { addDays, todayIn } from '../../src/lib/dates'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
const staff = MAIN_COHORT.staff
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')
// Расписание набора на сегодня считается тем же кодом, что заполнил базу (seed-plan.ts): пары зависят от дня недели и от верхней или
// нижней недели, поэтому тест при любом дне ждёт то, что в наборе, а не одну пару «на всякий день».
const today = todayIn('Europe/Moscow')
const tomorrow = addDays(today, 1)
const plan = buildCohortPlan(MAIN_COHORT, today)
const group1Lessons = plan.lessons.filter((l) => l.groupName === student1.groupName)
const todaysLessons = group1Lessons.filter((l) => l.date === today)
const lesson1 = todaysLessons[0]
// Экран «Сегодня» показывает изменения на дни Д и Д+1; смена аудитории студента 1 поставлена на ближайшую пару этих дней.
const roomChange = group1Lessons.find((l) => l.change?.kind === 'room_changed' && (l.date === today || l.date === tomorrow))

let server: RunningServer | null = null

// Адрес посетителя шлёт тест, как обратный прокси на сервере (пакет 3.1): стенд читает его из заголовка.
// Контексты браузера, созданные через browser.newContext(), получают этот заголовок тоже. Лимиты входа не меняются.
test.use({ extraHTTPHeaders: addressHeaders() })

test.beforeAll(async () => {
  server = await startServer()
})

test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
})

/** Касание: зона не меньше 44×44 пикселей (ЗД-5), затем одно нажатие. Счётчик считает тест сам. */
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

/** Горизонтальной прокрутки страницы нет. */
async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth, `${where}: ширина окна`).toBe(360)
}

async function newStudentContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  return { context, page: await context.newPage() }
}

test('сквозной сценарий М0: вход, расписание, оценки, заявка, статус', async ({ browser }) => {
  const { context: studentContext, page } = await newStudentContext(browser)
  const touches = { n: 0 }
  let requestId = ''
  let dueText = ''

  await test.step('Шаг 1. Э-1: вход студентом, пометка «концепт» видна', async () => {
    await page.goto('/login')
    const note = page.getByTestId('concept-note')
    await expect(note).toContainText('Концепт для конкурса, не официальный сервис вуза')
    // Пометка видна без прокрутки: внутри первого экрана 360×800 (ТР-6).
    const box = await note.boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(800)
    await expectNoHorizontalScroll(page, 'Э-1')

    await fillLogin(page, student1.login, student1.password)
    await touch(touches, page.getByRole('button', { name: 'Войти' }), 'Войти')
    await expect(page).toHaveURL(`${BASE_URL}/`)

    // Кука с префиксом `__Host-` и флагом Secure принимается Chromium на http://localhost (ловушка задания).
    const cookie = (await studentContext.cookies()).find((c) => c.name === '__Host-session')
    expect(cookie, 'кука __Host-session не сохранилась').toBeDefined()
    expect(cookie!.secure).toBe(true)
    expect(cookie!.httpOnly).toBe(true)
    expect(cookie!.sameSite).toBe('Lax')
    expect(cookie!.path).toBe('/')
    expect(cookie!.domain.startsWith('.'), 'у куки __Host- не должно быть Domain').toBe(false)
    // Вторая проверка: следующий запрос с этой кукой вошёл как студент (страница «Сегодня», а не экран входа).
    await expect(page.getByRole('heading', { name: 'Сегодня', level: 1 })).toBeVisible()
  })

  await test.step('Шаг 2. Э-2: «Сегодня» с пятью блоками; четыре вкладки, подписи не обрезаны', async () => {
    for (const title of [
      'Следующая пара',
      'Изменения в расписании',
      'Что сдать на этой неделе',
      'Заявки: новости и что сделать',
      'Непрочитанные объявления',
    ]) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
    }
    // Изменение расписания названо один раз: подпись вида, затем только новое сведение (R-2.4-1).
    const changes = page.locator('section', { has: page.getByRole('heading', { name: 'Изменения в расписании' }) })
    if (roomChange?.change) {
      // При Д-понедельнике это «Сменилась аудитория: 2-210 → 2-108»; при другом Д пара другая, новая аудитория та же.
      await expect(changes).toContainText(`Сменилась аудитория: ${roomChange.change.note}`)
    } else {
      // Единственный день без пар в Д и Д+1 — суббота нижней недели: показать смену аудитории экрану не на чем.
      expect(group1Lessons.filter((l) => l.date === today || l.date === tomorrow), 'пары есть, а смена аудитории не поставлена').toHaveLength(0)
      await expect(changes).toContainText('На сегодня и завтра изменений нет')
    }
    await expect(changes).not.toContainText('Аудитория изменена')
    const labels = ['Сегодня', 'Расписание', 'Успеваемость', 'Заявки']
    const nav = page.getByRole('navigation', { name: 'Разделы' })
    await expect(nav.getByRole('link')).toHaveCount(4)
    const measures: string[] = []
    for (const label of labels) {
      const tab = nav.getByRole('link', { name: label, exact: true })
      await expect(tab).toBeVisible()
      const m = await tab.evaluate((el) => {
        const span = el.querySelector('[data-tab-label]') as HTMLElement
        const range = document.createRange()
        range.selectNodeContents(span)
        return {
          tabWidth: el.getBoundingClientRect().width,
          // Ширина, отведённая подписи, и ширина самого текста подписи.
          available: span.clientWidth,
          clipped: span.scrollWidth - span.clientWidth,
          text: range.getBoundingClientRect().width,
          lines: range.getClientRects().length,
        }
      })
      measures.push(`${label}: вкладка ${m.tabWidth.toFixed(1)} px, под подпись ${m.available} px, текст ${m.text.toFixed(1)} px`)
      expect(m.clipped, `«${label}» обрезана (${m.text.toFixed(1)} px при ${m.available} px)`).toBeLessThanOrEqual(0)
      expect(m.text).toBeLessThanOrEqual(m.available)
      expect(m.lines, `«${label}» перенесена на вторую строку`).toBe(1)
    }
    test.info().annotations.push({ type: 'Ширина подписей вкладок на 360 px', description: measures.join('; ') })
    console.log(`Ширина подписей вкладок на 360 px:\n  ${measures.join('\n  ')}`)
    await expect(page.getByRole('link', { name: /^Уведомления, непрочитанных: \d+$/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Профиль' })).toBeVisible()
    await expect(page.getByTestId('bell-count')).toBeVisible()
    await expectNoHorizontalScroll(page, 'Э-2')
  })

  await test.step('Шаг 3. Э-3: расписание на сегодня — пара с аудиторией и преподавателем', async () => {
    await touch(touches, page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Расписание' }), 'вкладка «Расписание»')
    await expect(page).toHaveURL(`${BASE_URL}/schedule`)
    await expect(page.getByRole('heading', { name: /Расписание на сегодня/ })).toBeVisible()
    // Пары, перенесённые на сегодня с другого дня: экран показывает их на новом месте (пакет 3.2, R-3.2-2).
    const movedToToday = group1Lessons.filter((l) => l.date !== today && l.change?.kind === 'moved' && l.change.newDate === today)
    if (lesson1) {
      await expect(page.getByText(lesson1.discipline).first()).toBeVisible()
      // Пакет 3.2: при смене аудитории экран показывает новую, а прежнюю — строкой «Было»; при замене преподавателя новый стоит
      // на месте преподавателя (и в заметке изменения), а прежний — в «Было».
      const room1 = lesson1.change?.kind === 'room_changed' && lesson1.change.newRoom ? lesson1.change.newRoom : lesson1.room
      await expect(page.getByText(`Аудитория: ${room1}`).first()).toBeVisible()
      if (room1 !== lesson1.room) await expect(page.getByText(`ауд. ${lesson1.room}`).first()).toBeVisible()
      if (lesson1.change?.kind === 'teacher_changed') {
        const swap = /^Ведёт\s+(.+?)\s+вместо\s+(.+)$/.exec(lesson1.change.note)
        if (swap) {
          await expect(page.getByText(`Преподаватель: ${swap[1]}`).first()).toBeVisible()
          await expect(page.getByText(swap[2]!).first()).toBeVisible()
        } else await expect(page.getByText(lesson1.teacher).first()).toBeVisible()
      } else await expect(page.getByText(`Преподаватель: ${lesson1.teacher}`).first()).toBeVisible()
    } else if (movedToToday.length > 0) {
      // Пар по сетке на сегодня нет, но на сегодня перенесена пара с другого дня: «Сегодня пар нет» быть не должно.
      for (const l of movedToToday) await expect(page.getByText(l.discipline).first()).toBeVisible()
      await expect(page.getByText('Сегодня пар нет')).toHaveCount(0)
    } else {
      // Воскресенье и суббота нижней недели — без пар (черновик данных, раздел 3).
      await expect(page.getByText('Сегодня пар нет')).toBeVisible()
    }
    // Расписание принадлежит группе: метки группы второго студента здесь нет.
    await expect(page.locator('body')).not.toContainText(student2.markers.schedule)
    // Переключатель вида есть: две ссылки, «День» и «Неделя».
    const viewSwitch = page.getByRole('group', { name: 'Вид' }).getByRole('link')
    await expect(viewSwitch).toHaveCount(2)
    await expect(viewSwitch.nth(0)).toHaveText('День')
    await expect(viewSwitch.nth(1)).toHaveText('Неделя')
    await expectNoHorizontalScroll(page, 'Э-3')
  })

  await test.step('Шаг 4. Э-4: успеваемость — «как у меня дела», зачёт и оценка', async () => {
    await touch(touches, page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Успеваемость', exact: true }), 'вкладка «Успеваемость»')
    await expect(page).toHaveURL(`${BASE_URL}/grades`)
    const summary = page.locator('section', { has: page.getByRole('heading', { name: 'Как у меня дела' }) })
    for (const term of ['Сдано', 'Долг', 'Впереди', 'Средний балл']) {
      await expect(summary.getByText(term, { exact: true })).toBeVisible()
    }
    // Открыт вид «Семестр».
    await expect(page.getByRole('link', { name: 'Семестр' })).toHaveAttribute('aria-current', 'true')
    const credit = page.locator('li', { has: page.getByRole('heading', { name: student1.markers.grades }) })
    await expect(credit).toContainText('Итог: Зачтено')
    const graded = page.locator('li', { has: page.getByRole('heading', { name: 'Статистика' }) })
    await expect(graded).toContainText('Итог: Оценка 4')
    await expect(page.locator('body')).not.toContainText(student2.markers.grades)
    await expectNoHorizontalScroll(page, 'Э-4')
  })

  await test.step('Шаг 5. Э-6 → Э-7: справка из деканата за три касания от «Сегодня»', async () => {
    // Возврат на «Сегодня» — отдельное касание, в счёт заказа не входит.
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Сегодня', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Сегодня', level: 1 })).toBeVisible()

    const order = { n: 0 }
    await touch(order, page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Заявки', exact: true }), 'вкладка «Заявки»')
    await expect(page).toHaveURL(`${BASE_URL}/requests`)
    // Видов заявок три, у каждого своя кнопка; кнопки «Все виды» нет.
    await expect(page.getByRole('link', { name: 'Справка из деканата', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Справка об оплате обучения', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Заявление на материальную помощь', exact: true })).toBeVisible()
    await expect(page.getByText('Все виды')).toHaveCount(0)
    await expectNoHorizontalScroll(page, 'Э-6')

    await touch(order, page.getByRole('link', { name: 'Справка из деканата', exact: true }), 'кнопка «Справка из деканата»')
    await expect(page).toHaveURL(`${BASE_URL}/requests/new?type=dean_certificate`)
    await expect(page.getByText('Срок изготовления')).toBeVisible()
    await expect(page.getByText('Где и как получить')).toBeVisible()
    await expectNoHorizontalScroll(page, 'Э-7')

    await touch(order, page.getByRole('button', { name: 'Отправить' }), 'кнопка «Отправить»')
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    expect(order.n, 'число касаний заказа справки').toBe(3)
    requestId = new URL(page.url()).pathname.split('/').pop() ?? ''
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  await test.step('Шаг 6. Э-8: заявка в статусе «Подана»', async () => {
    await expect(page.getByTestId('request-status')).toHaveText('Подана')
    await expect(page.getByTestId('request-status-text')).toContainText('Заявка у деканата')
    await expectNoHorizontalScroll(page, 'Э-8')
  })

  await test.step('Шаг 7. Э-1 → Э-11 → Э-12: сотрудник ставит «В работе»', async () => {
    const { context, page: staffPage } = await newStudentContext(browser)
    try {
      const staffTouches = { n: 0 }
      await staffPage.goto('/login')
      await fillLogin(staffPage, staff.login, staff.password)
      await touch(staffTouches, staffPage.getByRole('button', { name: 'Войти' }), 'Войти (сотрудник)')
      await expect(staffPage).toHaveURL(`${BASE_URL}/staff/requests`)
      // Вкладок у сотрудника нет.
      await expect(staffPage.getByRole('navigation', { name: 'Разделы' })).toHaveCount(0)
      await expectNoHorizontalScroll(staffPage, 'Э-11')

      staffTouches.n = 0
      const row = staffPage.locator(`a[href="/staff/requests/${requestId}"]`)
      await expect(row).toContainText(student1.fullName)
      await expect(row).toContainText('Подана')
      await touch(staffTouches, row, 'заявка в списке')
      await expect(staffPage).toHaveURL(`${BASE_URL}/staff/requests/${requestId}`)
      await expectNoHorizontalScroll(staffPage, 'Э-12')
      await touch(staffTouches, staffPage.getByRole('button', { name: 'В работе', exact: true }), 'кнопка статуса «В работе»')
      await touch(staffTouches, staffPage.getByRole('button', { name: 'Сохранить' }), 'кнопка «Сохранить»')
      await expect(staffPage.getByRole('status')).toHaveText('Статус сохранён')
      await expect(staffPage.getByTestId('staff-request-status')).toHaveText('В работе')
      expect(staffTouches.n, 'касаний сотрудника от списка до сохранения').toBe(3)
    } finally {
      await context.close()
    }
    // Срок «до <дата>» студент видит сразу после «В работе». Тест запоминает увиденный текст и не считает дату сам (R-2.4-6):
    // прогон около полуночи по Москве не расходится с сервером. Шаг 8 сверяет текст после перезапуска с этим.
    await page.reload()
    await expect(page.getByTestId('request-status')).toHaveText('В работе')
    dueText = (await page.getByTestId('request-status-text').textContent()) ?? ''
    expect(dueText, 'текст «В работе» со сроком').toMatch(/^Пока ничего\. Срок — до \d{2}\.\d{2}\.\d{4}$/)
  })

  await test.step('Шаг 8. Э-8: после перезапуска приложения студент видит «В работе»', async () => {
    const oldPid = server!.pid
    await stopServer(server!)
    // Пока приложение остановлено, адрес не отвечает: перезапуск настоящий, а не притворный.
    await expect(fetch(`${BASE_URL}/login`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow()
    server = await startServer()
    expect(server.pid, 'процесс приложения новый').not.toBe(oldPid)

    // Кука студента пережила перезапуск: сессия лежит в базе. База не стиралась.
    await page.goto(`/requests/${requestId}`)
    await expect(page.getByTestId('request-status')).toHaveText('В работе')
    await expect(page.getByTestId('request-status-text')).toHaveText(dueText)
    await expectNoHorizontalScroll(page, 'Э-8 после перезапуска')
  })

  await test.step('Шаг 9. Второй студент не открывает заявку первого по её адресу', async () => {
    const { context, page: other } = await newStudentContext(browser)
    try {
      await other.goto('/login')
      await fillLogin(other, student2.login, student2.password)
      await other.getByRole('button', { name: 'Войти' }).click()
      await expect(other).toHaveURL(`${BASE_URL}/`)

      const foreign = await other.goto(`/requests/${requestId}`)
      expect(foreign!.status()).toBe(404)
      await expect(other.getByRole('heading', { name: 'Нет такой заявки' })).toBeVisible()
      const html = await foreign!.text()
      // Метки первого студента в ответе нет: ни в виде страницы, ни в данных, которые Next.js кладёт в HTML.
      for (const marker of [
        student1.markers.requests,
        student1.markers.profile,
        student1.fullName,
        'Справка из деканата',
        'Пока ничего',
      ]) {
        expect(html, `в ответе чужому есть «${marker}»`).not.toContain(marker)
      }
      await expect(other.locator('body')).not.toContainText(student1.markers.requests)

      // Несуществующая заявка выглядит так же: тот же код и тот же заголовок.
      const missing = await other.goto('/requests/00000000-0000-4000-8000-000000000000')
      expect(missing!.status()).toBe(404)
      await expect(other.getByRole('heading', { name: 'Нет такой заявки' })).toBeVisible()
      // Студенту закрыты и адреса сотрудника.
      const staffArea = await other.goto('/staff/requests')
      expect(staffArea!.status()).toBe(403)
      expect(await staffArea!.text()).not.toContain(student1.fullName)
      await expectNoHorizontalScroll(other, 'ответ «нет такой заявки»')
    } finally {
      await context.close()
    }
  })

  await test.step('Шаг 10. Э-10: профиль и «Выйти»', async () => {
    await page.goto('/')
    await touch(touches, page.getByRole('link', { name: 'Профиль' }), 'аватар')
    await expect(page).toHaveURL(`${BASE_URL}/profile`)
    const fields: [string, string][] = [
      ['ФИО', student1.fullName],
      ['Факультет', student1.faculty],
      ['Направление', student1.programme],
      ['Курс', String(student1.course)],
      ['Группа', student1.groupName],
    ]
    for (const [name, value] of fields) {
      await expect(page.locator(`dt:text-is("${name}") + dd`), `поле «${name}»`).toHaveText(value)
    }
    await expectNoHorizontalScroll(page, 'Э-10')
    // Значение куки запоминается до выхода: после выхода им проверяется, что сессия погашена на сервере (R-2.4-8).
    const oldToken = (await studentContext.cookies()).find((c) => c.name === '__Host-session')?.value
    expect(oldToken, 'кука сессии перед выходом').toBeTruthy()
    const replay = await playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { cookie: `__Host-session=${oldToken}` } })
    // Контроль способа: пока сессия жива, запрос с этой кукой открывает кабинет. Иначе перенаправление ниже ничего не доказывало бы.
    expect((await replay.get('/', { maxRedirects: 0 })).status(), 'запрос с живой кукой').toBe(200)
    await touch(touches, page.getByRole('button', { name: 'Выйти' }), 'кнопка «Выйти»')
    await expect(page).toHaveURL(`${BASE_URL}/login`)
    // Сессия закрыта: кабинет больше не открывается.
    await page.goto('/')
    await expect(page).toHaveURL(`${BASE_URL}/login`)
    expect((await studentContext.cookies()).find((c) => c.name === '__Host-session')).toBeUndefined()

    // Старая кука, отправленная вручную, больше не пускает: строка сессии удалена в базе, а не только кука в браузере.
    try {
      const response = await replay.get('/', { maxRedirects: 0 })
      expect([301, 302, 303, 307, 308], `статус ответа со старой кукой: ${response.status()}`).toContain(response.status())
      expect(new URL(response.headers()['location'] ?? '', BASE_URL).pathname, 'адрес перенаправления').toBe('/login')
    } finally {
      await replay.dispose()
    }
  })

  await studentContext.close()
})

test('Э-1: неверная пара — понятная ошибка, кабинет не открывается', async ({ page }) => {
  await page.goto('/login')
  await fillLogin(page, student1.login, 'неверный-пароль')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.locator('form').getByRole('alert')).toHaveText('Неверный логин или пароль')
  await expect(page).toHaveURL(`${BASE_URL}/login`)
  await page.goto('/grades')
  await expect(page).toHaveURL(`${BASE_URL}/login`)
})
