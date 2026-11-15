// Состояние «ошибка» у экранов кабинета на 360×800 (пакет 3.7; D-2.2-system, 5.6; S-2.1, раздел 3, абзац «Три состояния»).
// Отказ базы вызывает запрос владельца: он отзывает у роли приложения право чтения одной таблицы (helpers/db.ts, `revokeRead`).
// Запрос слоя доступа падает, страница бросает ошибку, Next.js показывает error.tsx. Только локальная тестовая база и вымышленные данные.
//
// Состояние базы. Право возвращается в `finally` каждой проверки и в `afterAll`; последняя проверка файла спрашивает у базы,
// что право чтения на месте у каждой таблицы, у которой оно отзывалось. Файл стоит после schedule.spec.ts и перед тестами безопасности.
// Каждая проверка в цикле ведёт счёт шагов и сверяет, что цикл шёл больше нуля раз.
//
// Состояние «загрузка» этим файлом не проверяется: файлов loading.tsx в пакете нет, см. отчёт по пакету 3.7 (ответ страницы с loading.tsx
// всегда 200, а тесты безопасности требуют 307, 403 и 404).
import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { REVOCABLE_TABLES, appCanRead, firstRequestIdOf, restoreRead, revokeRead, type RevocableTable } from './helpers/db'
import { startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
const staff = MAIN_COHORT.staff
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')

const EXPLANATION = 'Ошибка на нашей стороне. Ваши данные не потеряны.'
const TAB_LABELS = ['Сегодня', 'Расписание', 'Успеваемость', 'Заявки']

let server: RunningServer | null = null
const contexts: BrowserContext[] = []
let studentPage: Page
let staffPage: Page
let requestPath = ''
let disciplinePath = ''

async function signIn(browser: Browser, login: string, password: string, landing: RegExp): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: addressHeaders(freshAddress()) })
  contexts.push(context)
  const page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(landing)
  return page
}

test.beforeAll(async ({ browser }) => {
  server = await startServer()
  studentPage = await signIn(browser, student1.login, student1.password, /\/$/)
  staffPage = await signIn(browser, staff.login, staff.password, /\/staff\/requests$/)
  // Адреса записей берутся до того, как у базы отзывается право: после отзыва списки уже не открываются.
  await studentPage.goto('/requests')
  requestPath = (await studentPage.locator('a[href^="/requests/"]:not([href^="/requests/new"])').first().getAttribute('href')) ?? ''
  await studentPage.goto('/grades')
  disciplinePath = (await studentPage.locator('a[href^="/grades/"]').first().getAttribute('href')) ?? ''
})

test.afterAll(async () => {
  // Возврат права — первым делом и для каждой таблицы: он не зависит ни от упавшей проверки, ни от остановки сервера.
  for (const table of REVOCABLE_TABLES) await restoreRead(table)
  for (const context of contexts) await context.close()
  if (server) await stopServer(server)
  server = null
})

async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, `${where}: горизонтальная прокрутка (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth)
  expect(clientWidth, `${where}: ширина окна`).toBe(360)
}

// Слова, которых на экране ошибки быть не должно: текст ошибки, служебный номер, имена таблиц, запрос.
const FORBIDDEN = [
  'error',
  'permission denied',
  'digest',
  'application error',
  'something went wrong',
  'select ',
  ' from ',
  'relation',
  ...REVOCABLE_TABLES,
  'students',
  'users',
  'sessions',
]

async function expectNoServiceText(page: Page, where: string): Promise<void> {
  const text = (await page.evaluate(() => document.body.innerText)).toLowerCase()
  let checked = 0
  for (const word of FORBIDDEN) {
    expect(text.includes(word), `${where}: на экране служебное слово «${word}»`).toBe(false)
    checked += 1
  }
  expect(checked, `${where}: проверено слов`).toBe(FORBIDDEN.length)
}

interface Case {
  name: string
  who: 'student' | 'staff'
  path: () => string
  table: RevocableTable
  title: string
  /** Вкладка, которая отмечена в нижней панели; null — не отмечена ни одна (колокольчик, аватар). У сотрудника панели нет. */
  tab: 'today' | 'schedule' | 'grades' | 'requests' | null
  /** Заголовок страницы после «Повторить»; null — только то, что ошибки на экране уже нет. */
  heading: string | RegExp | null
}

const CASES: Case[] = [
  { name: 'Сегодня', who: 'student', path: () => '/', table: 'lessons', title: 'Не удалось загрузить страницу', tab: 'today', heading: 'Сегодня' },
  { name: 'расписание', who: 'student', path: () => '/schedule', table: 'lessons', title: 'Не удалось загрузить расписание', tab: 'schedule', heading: /^Расписание на/ },
  { name: 'оценки', who: 'student', path: () => '/grades', table: 'disciplines', title: 'Не удалось загрузить оценки', tab: 'grades', heading: 'Успеваемость' },
  { name: 'дисциплина', who: 'student', path: () => disciplinePath, table: 'disciplines', title: 'Не удалось загрузить оценки', tab: 'grades', heading: null },
  { name: 'заявки', who: 'student', path: () => '/requests', table: 'requests', title: 'Не удалось загрузить заявки', tab: 'requests', heading: 'Заявки' },
  { name: 'заявка', who: 'student', path: () => requestPath, table: 'requests', title: 'Не удалось загрузить заявки', tab: 'requests', heading: null },
  { name: 'уведомления', who: 'student', path: () => '/notifications', table: 'notifications', title: 'Не удалось загрузить уведомления', tab: null, heading: 'Уведомления' },
  { name: 'профиль', who: 'student', path: () => '/profile', table: 'groups', title: 'Не удалось загрузить профиль', tab: null, heading: 'Профиль' },
  { name: 'список заявок сотрудника', who: 'staff', path: () => '/staff/requests', table: 'requests', title: 'Не удалось загрузить заявки', tab: null, heading: 'Заявки студентов' },
]

/** Шапка и нижняя панель на месте, без данных: нет числа у колокольчика, нет группы и недели; нужная вкладка отмечена. */
async function expectFrame(page: Page, c: Case): Promise<void> {
  const header = page.locator('header')
  await expect(header).toContainText('Деканат в кармане')
  if (c.who === 'staff') {
    await expect(header.getByRole('button', { name: 'Выйти' })).toBeVisible()
    await expect(page.locator('[data-tabbar]')).toHaveCount(0)
    return
  }
  await expect(header.getByRole('link', { name: 'Уведомления', exact: true })).toBeVisible()
  await expect(header.getByRole('link', { name: 'Профиль', exact: true })).toBeVisible()
  await expect(page.getByTestId('bell-count')).toHaveCount(0)
  await expect(header).not.toContainText('неделя')
  const nav = page.locator('[data-tabbar]')
  await expect(nav).toBeVisible()
  let seen = 0
  for (const label of TAB_LABELS) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    seen += 1
  }
  expect(seen, `${c.name}: вкладок на панели`).toBe(TAB_LABELS.length)
  const current = nav.locator('[aria-current="page"]')
  if (c.tab) {
    await expect(current).toHaveCount(1)
    await expect(current).toHaveAttribute('data-tab', c.tab)
  } else {
    await expect(current).toHaveCount(0)
  }
}

let casesChecked = 0

for (const c of CASES) {
  test(`ошибка: ${c.name} — карточка, «Повторить», каркас на месте, служебного текста нет; после возврата права «Повторить» показывает экран`, async () => {
    const page = c.who === 'staff' ? staffPage : studentPage
    try {
      await revokeRead(c.table)
      await page.goto(c.path())
      const card = page.locator('main').getByRole('alert')
      await expect(card, `${c.name}: карточки ошибки нет`).toBeVisible()
      await expect(card.getByRole('heading', { name: c.title, level: 1 })).toBeVisible()
      await expect(card).toContainText(EXPLANATION)
      const retry = card.getByRole('button', { name: 'Повторить' })
      await expect(retry).toBeVisible()
      const box = await retry.boundingBox()
      expect(box, `${c.name}: кнопки «Повторить» нет на экране`).not.toBeNull()
      expect(box!.height, `${c.name}: высота «Повторить» ${box!.height}`).toBeGreaterThanOrEqual(44)
      expect(box!.width, `${c.name}: ширина «Повторить» ${box!.width}`).toBeGreaterThanOrEqual(44)
      await expectFrame(page, c)
      await expectNoServiceText(page, c.name)
      await expectNoHorizontalScroll(page, c.name)

      // Причину устранили: «Повторить» заново просит страницу у сервера, и на экране содержимое, без ручной перезагрузки.
      await restoreRead(c.table)
      await retry.click()
      await expect(page.locator('main').getByRole('alert'), `${c.name}: после «Повторить» всё ещё ошибка`).toHaveCount(0)
      if (c.heading) await expect(page.getByRole('heading', { name: c.heading, level: 1 })).toBeVisible()
      else await expect(page.locator('main h1').first()).toBeVisible()
      await expect(page.getByText('Не удалось загрузить')).toHaveCount(0)
      casesChecked += 1
    } finally {
      await restoreRead(c.table)
    }
  })
}

test('чужая и несуществующая запись — «не найдено», а не ошибка', async () => {
  const foreign = await firstRequestIdOf(student2.login)
  expect(foreign, 'у второго студента нет заявок').not.toBeNull()
  let checked = 0
  for (const id of [foreign!, randomUUID(), 'abc']) {
    await studentPage.goto(`/requests/${id}`)
    await expect(studentPage.getByRole('heading', { name: 'Нет такой заявки', level: 1 })).toBeVisible()
    await expect(studentPage.locator('main').getByRole('alert')).toHaveCount(0)
    await expect(studentPage.getByText('Не удалось загрузить')).toHaveCount(0)
    checked += 1
  }
  await staffPage.goto(`/staff/requests/${randomUUID()}`)
  await expect(staffPage.getByRole('heading', { name: 'Нет такой заявки', level: 1 })).toBeVisible()
  await expect(staffPage.locator('main').getByRole('alert')).toHaveCount(0)
  checked += 1
  expect(checked, 'проверено адресов').toBe(4)
})

test('все случаи ошибки прошли до конца', async () => {
  expect(casesChecked, 'случаев ошибки проверено').toBe(CASES.length)
})

// Последняя проверка файла: после неё идут тесты безопасности, и они не должны упасть из-за отозванного права.
test('в конце файла право чтения у роли приложения на месте у каждой таблицы', async () => {
  let checked = 0
  for (const table of REVOCABLE_TABLES) {
    expect(await appCanRead(table), `у роли приложения нет права чтения «${table}»`).toBe(true)
    checked += 1
  }
  expect(checked, 'таблиц проверено').toBe(REVOCABLE_TABLES.length)
})
