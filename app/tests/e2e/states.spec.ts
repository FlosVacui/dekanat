// Состояния «ошибка» и «загрузка» у экранов кабинета на 360×800 (пакет 3.7; D-2.2-system, 5.6 и 5.7; S-2.1, раздел 3, абзац «Три состояния»).
// Только локальная тестовая база и вымышленные данные.
//
// «Ошибка». Отказ базы вызывает запрос владельца: он отзывает у роли приложения право чтения одной таблицы (helpers/db.ts, `revokeRead`).
// Запрос слоя доступа падает, страница бросает ошибку, Next.js показывает error.tsx.
//
// «Загрузка». Граница ожидания `<Suspense>` стоит внутри страницы ниже проверки входа (файлов loading.tsx нет: ответ с ним всегда 200,
// а тесты безопасности требуют 307, 403 и 404). Задержку даёт база: владелец берёт блокировку таблицы, которую читает экран, но не читает
// проверка входа (helpers/db.ts, `holdTableLock`). Задержка ответа средствами Playwright не годится: она держит весь ответ целиком,
// и скелет не приходит раньше содержимого. Блокировка снимается в `finally` каждой проверки, по таймеру и в `afterAll`; запрос приложения,
// который ждёт дольше 10 секунд, база обрывает (server/dal/client.ts), поэтому ни одна блокировка не держится так долго.
//
// Состояние базы. Право возвращается в `finally` каждой проверки и в `afterAll`; в начале файла оно возвращается для каждой таблицы
// первым делом (после оборванного прогона оно могло остаться отозванным). Последняя проверка файла спрашивает у базы, что право чтения
// на месте у каждой таблицы, у которой оно отзывалось. Файл стоит после schedule.spec.ts и перед тестами безопасности.
// Каждая проверка в цикле ведёт счёт шагов и сверяет, что цикл шёл больше нуля раз.
import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page, type Request as PwRequest, type Response } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import {
  REVOCABLE_TABLES,
  appCanRead,
  firstRequestIdOf,
  holdTableLock,
  releaseAllLocks,
  restoreRead,
  revokeRead,
  type RevocableTable,
  type TableLock,
} from './helpers/db'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

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
  // Самолечение (R-3.7-13, а): прошлый прогон мог оборваться между отзывом права и возвратом, а `db:seed` его не возвращает.
  // Право возвращается для каждой таблицы списка первым делом, до запуска сервера и входа.
  for (const table of REVOCABLE_TABLES) await restoreRead(table)
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
  // Блокировки снимаются первыми: возврат права ждёт блокировку таблицы. Затем возврат права — для каждой таблицы:
  // он не зависит ни от упавшей проверки, ни от остановки сервера.
  await releaseAllLocks()
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

// Служебное в теле ответа (R-3.7-14): в ответ страницы и в ответ RSC не попадают текст отказа базы, запрос, имена таблиц в запросе,
// пути сборки и строки стека. Имена таблиц ищутся в виде, в каком они бывают в запросе (в кавычках, после from и join): сами слова
// «requests» и «notifications» стоят в адресах вкладок, и по ним проверять нельзя. Допустим только `digest` из цифр.
const TABLE_NAMES = [...REVOCABLE_TABLES, 'students', 'users', 'sessions'].join('|')
const SERVICE_PATTERNS: [string, RegExp][] = [
  ['permission denied', /permission denied/i],
  ['relation "', /relation\s+\\*"/i],
  ['запрос select', /\bselect\s+\\*"\w+/i],
  ['имя таблицы после from или join', new RegExp(`\\b(from|join)\\s+\\\\*"(${TABLE_NAMES})\\\\*"`, 'i')],
  ['имя таблицы с колонкой в кавычках', new RegExp(`\\\\*"(${TABLE_NAMES})\\\\*"\\.\\\\*"`, 'i')],
  ['.next', /\.next[\\/]/],
  ['node_modules', /node_modules/],
  ['строка стека at …:N:N', /\bat\s+(?:\S+\s+\()?[^\s()<>"]*:\d+:\d+\)?/],
  ['Error:', /Error:/],
]

/** Тело ответа без служебного: `digest` из цифр вырезается как допустимый, любой другой `digest` остаётся и считается служебным. */
function expectNoServiceBody(body: string, where: string): void {
  expect(body.length, `${where}: пустое тело ответа`).toBeGreaterThan(0)
  // Встроенная функция React `$RX` в ответе страницы — это код, а не данные: в нём стоят имена `dgst`, `msg`, `stck`, `cstck`.
  // Код вырезается, а вызовы `$RX(...)` проверяются отдельно: в них допустим только номер блока и `digest` из цифр, без текста и стека.
  const rest = body
    .replace(/\\*"digest\\*"\s*:\s*\\*"\d+\\*"/g, '')
    .replace(/data-dgst=\\*"\d+\\*"/g, '')
    .replace(/null!=c&&\(a\.dgst=c\),d&&\(a\.msg=d\),e&&\(a\.stck=e\),f&&\(a\.cstck=f\)/g, '')
  for (const call of rest.matchAll(/\$RX\(([^)]*)\)/g)) {
    const args = (call[1] ?? '').split(',')
    expect(args.length <= 2 && /^"B:\d+"$/.test(args[0] ?? '') && (args[1] === undefined || /^"\d+"$/.test(args[1])), `${where}: вызов $RX с текстом или стеком: ${call[0]}`).toBe(true)
  }
  let checked = 0
  for (const [name, pattern] of SERVICE_PATTERNS) {
    const found = pattern.exec(rest)
    expect(found, `${where}: в теле ответа служебное «${name}»: ${found ? rest.slice(Math.max(0, found.index - 40), found.index + 80) : ''}`).toBeNull()
    checked += 1
  }
  const digest = /digest|dgst/i.exec(rest)
  expect(digest, `${where}: в теле ответа digest не из цифр: ${digest ? rest.slice(Math.max(0, digest.index - 60), digest.index + 100) : ''}`).toBeNull()
  expect(checked, `${where}: проверено шаблонов тела`).toBe(SERVICE_PATTERNS.length)
}

/**
 * Служебного текста нет: ни на экране, ни в теле ответа страницы (`response` — ответ на переход), ни в ответе RSC того же адреса.
 * Тело ответа читается сразу после перехода, пока право чтения у базы отозвано.
 */
async function expectNoServiceText(page: Page, where: string, path: string, response: Response | null): Promise<void> {
  const text = (await page.evaluate(() => document.body.innerText)).toLowerCase()
  let checked = 0
  for (const word of FORBIDDEN) {
    expect(text.includes(word), `${where}: на экране служебное слово «${word}»`).toBe(false)
    checked += 1
  }
  expect(checked, `${where}: проверено слов`).toBe(FORBIDDEN.length)
  expect(response, `${where}: ответа на переход нет`).not.toBeNull()
  expectNoServiceBody(await response!.text(), `${where}, ответ страницы`)
  const rsc = await page.context().request.get(path, { headers: { RSC: '1' } })
  expectNoServiceBody(await rsc.text(), `${where}, ответ RSC (код ${rsc.status()})`)
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
async function expectFrame(page: Page, c: Pick<Case, 'name' | 'who' | 'tab'>): Promise<void> {
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

// Какие случаи ошибки начались и какие прошли до конца (R-3.7-13, б). Проверка «все случаи прошли» сверяет два набора, а не число
// со всем списком: при запуске части файла (`-g`, номер строки) она не падает ложно, а при полном прогоне видит каждый начатый случай.
const casesStarted = new Set<string>()
const casesChecked = new Set<string>()

for (const c of CASES) {
  test(`ошибка: ${c.name} — карточка, «Повторить», каркас на месте, служебного текста нет; после возврата права «Повторить» показывает экран`, async () => {
    const page = c.who === 'staff' ? staffPage : studentPage
    casesStarted.add(c.name)
    try {
      await revokeRead(c.table)
      const response = await page.goto(c.path())
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
      await expectNoServiceText(page, c.name, c.path(), response)
      await expectNoHorizontalScroll(page, c.name)

      // Причину устранили: «Повторить» заново просит страницу у сервера, и на экране содержимое, без ручной перезагрузки.
      await restoreRead(c.table)
      await retry.click()
      await expect(page.locator('main').getByRole('alert'), `${c.name}: после «Повторить» всё ещё ошибка`).toHaveCount(0)
      if (c.heading) await expect(page.getByRole('heading', { name: c.heading, level: 1 })).toBeVisible()
      else await expect(page.locator('main h1').first()).toBeVisible()
      await expect(page.getByText('Не удалось загрузить')).toHaveCount(0)
      casesChecked.add(c.name)
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
  expect(CASES.length, 'список случаев ошибки пуст').toBeGreaterThan(0)
  // Запуск части файла без случаев ошибки: проверять нечего, и тест не падает, а пропускается с названной причиной.
  test.skip(casesStarted.size === 0, 'в этом запуске не было ни одного случая ошибки')
  const unfinished = [...casesStarted].filter((name) => !casesChecked.has(name))
  expect(unfinished, 'случаи ошибки, которые начались и не дошли до конца').toEqual([])
  expect(casesChecked.size, 'случаев ошибки проверено').toBe(casesStarted.size)
})

// ---- Состояние «загрузка» (пакет 3.7, заход 2) ----

/** Страница с границей ожидания. `table` — таблица, которую читает экран (или шапка после экрана) и не читает проверка входа. */
interface LoadCase {
  name: string
  who: 'student' | 'staff'
  path: string
  table: RevocableTable
  /** Подпись карточки загрузки. */
  label: string
  tab: Case['tab']
  /** Заголовок страницы, когда содержимое пришло. */
  heading: string | RegExp
}

const LOAD_CASES: LoadCase[] = [
  { name: 'расписание', who: 'student', path: '/schedule', table: 'lessons', label: 'Загружаем расписание…', tab: 'schedule', heading: /^Расписание на/ },
  { name: 'заявки', who: 'student', path: '/requests', table: 'requests', label: 'Загружаем заявки…', tab: 'requests', heading: 'Заявки' },
  // На «Новой заявке» своих данных нет: ждёт шапка (число непрочитанных читается из `notifications`), а скелет стоит на месте содержимого.
  { name: 'новая заявка', who: 'student', path: '/requests/new?type=dean_certificate', table: 'notifications', label: 'Загружаем заявки…', tab: 'requests', heading: 'Новая заявка' },
  { name: 'профиль', who: 'student', path: '/profile', table: 'groups', label: 'Загружаем профиль…', tab: null, heading: 'Профиль' },
  { name: 'список заявок сотрудника', who: 'staff', path: '/staff/requests', table: 'requests', label: 'Загружаем заявки…', tab: null, heading: 'Заявки студентов' },
]

/**
 * Три страницы, у которых границы ожидания НЕТ: `/`, `/grades` и `/notifications`. Граница ожидания у них ломала чужие тесты
 * (tests/e2e/notifications.spec.ts): С-16 читает число у колокольчика сразу после входа на `/` и после перехода на `/grades`,
 * а скелет без данных числа не имеет; «Отметить прочитанным … без скриптов в браузере» открывает `/notifications` без скриптов,
 * где содержимое границы не показывается никогда. По правилу задания страницы возвращены к прежнему виду, вопрос — в отчёте.
 * Здесь они остаются только в проверках кода ответа: список из восьми страниц сохранён, код у них прежний
 * (без сессии 307, при отказе базы 500).
 */
const NO_BOUNDARY_CASES: Pick<LoadCase, 'name' | 'who' | 'path' | 'table'>[] = [
  { name: 'Сегодня', who: 'student', path: '/', table: 'lessons' },
  { name: 'оценки', who: 'student', path: '/grades', table: 'disciplines' },
  { name: 'уведомления', who: 'student', path: '/notifications', table: 'notifications' },
]

/** Все восемь страниц-списков: для проверок кода ответа. */
const ALL_PAGES = [...LOAD_CASES, ...NO_BOUNDARY_CASES]

/** Дольше блокировка не держится сама: запрос приложения, ждущий 10 секунд, база обрывает. Тест снимает её раньше, вручную. */
const LOCK_MAX_MS = 8000

const SKELETON = 'main [role="status"]'

function pageOf(c: Pick<LoadCase, 'who'>): Page {
  return c.who === 'staff' ? staffPage : studentPage
}

/** Верх `main` на странице: сдвиг при смене скелета на содержимое. */
async function mainTop(page: Page): Promise<number> {
  return page.locator('main').evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
}

/** Скелет виден (первую секунду его не видно: ждём), с подписью раздела; шапка и панель на месте, вкладка отмечена, числа у колокольчика нет. */
async function expectSkeleton(page: Page, c: LoadCase): Promise<void> {
  const card = page.locator(SKELETON)
  await expect(card, `${c.name}: скелета нет`).toBeVisible()
  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute('aria-busy', 'true')
  await expect(card).toContainText(c.label)
  await expect(page.locator('main [data-skeleton]').first()).toBeVisible()
  await expect(page.locator('main').getByRole('alert'), `${c.name}: вместо скелета ошибка`).toHaveCount(0)
  await expectFrame(page, c)
}

const loadStarted = new Set<string>()
const loadChecked = new Set<string>()

for (const c of LOAD_CASES) {
  test(`загрузка: ${c.name} — скелет с подписью «${c.label}», шапка и панель на месте; после снятия блокировки — содержимое, скелета нет`, async () => {
    const page = pageOf(c)
    loadStarted.add(c.name)
    let lock: TableLock | null = null
    try {
      lock = await holdTableLock(c.table, LOCK_MAX_MS)
      await page.goto(c.path, { waitUntil: 'commit' })
      await expectSkeleton(page, c)
      await expectNoHorizontalScroll(page, `${c.name}, скелет`)
      const skeletonTop = await mainTop(page)
      await lock.release()
      await expect(page.getByRole('heading', { name: c.heading, level: 1 }), `${c.name}: содержимого нет после снятия блокировки`).toBeVisible()
      await expect(page.locator(SKELETON), `${c.name}: скелет остался`).toHaveCount(0)
      await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
      await expectNoHorizontalScroll(page, `${c.name}, содержимое`)
      const contentTop = await mainTop(page)
      const note = `${c.name}: начало main ${skeletonTop} px в скелете, ${contentTop} px в содержимом, сдвиг ${contentTop - skeletonTop} px`
      test.info().annotations.push({ type: 'сдвиг main', description: note })
      console.log(`СДВИГ ${note}`)
      loadChecked.add(c.name)
    } finally {
      await lock?.release()
    }
  })
}

test('загрузка: расписание — переход нажатием вкладки показывает скелет, затем содержимое', async () => {
  let lock: TableLock | null = null
  try {
    await studentPage.goto('/grades')
    await expect(studentPage.getByRole('heading', { name: 'Успеваемость', level: 1 })).toBeVisible()
    lock = await holdTableLock('lessons', LOCK_MAX_MS)
    await studentPage.locator('[data-tabbar]').getByRole('link', { name: 'Расписание', exact: true }).click()
    const c = LOAD_CASES.find((x) => x.path === '/schedule')!
    await expectSkeleton(studentPage, c)
    await expect(studentPage).toHaveURL(/\/schedule$/)
    await lock.release()
    await expect(studentPage.getByRole('heading', { name: /^Расписание на/, level: 1 })).toBeVisible()
    await expect(studentPage.locator(SKELETON)).toHaveCount(0)
  } finally {
    await lock?.release()
  }
})

for (const c of ALL_PAGES) {
  test(`код при блокировке: ${c.name} — запрос без сессии, без следования переходам, даёт 307 на /login, пока блокировка держится`, async () => {
    let lock: TableLock | null = null
    try {
      lock = await holdTableLock(c.table, LOCK_MAX_MS)
      const res = await fetch(`${BASE_URL}${c.path}`, { redirect: 'manual', headers: addressHeaders(freshAddress()) })
      await res.arrayBuffer()
      expect(res.status, `${c.name}: код без сессии при блокировке`).toBe(307)
      expect(new URL(res.headers.get('location') ?? 'http://invalid/', BASE_URL).pathname, `${c.name}: куда ведёт`).toBe('/login')
    } finally {
      await lock?.release()
    }
  })
}

/** Образец вычисленного стиля скрытия: `visibility` и возраст анимации `skel-hidden` у элемента в миллисекундах (null — анимации нет). */
interface HideSample {
  visibility: string
  age: number | null
}

async function sampleHide(locator: ReturnType<Page['locator']>): Promise<HideSample> {
  return locator.evaluate((el) => {
    const animation = el.getAnimations().find((a) => (a as CSSAnimation).animationName === 'skel-hidden')
    return { visibility: getComputedStyle(el).visibility, age: animation ? Number(animation.currentTime ?? 0) : null }
  })
}

test('загрузка: первая секунда — карточку не видно по вычисленному стилю, после первой секунды видно', async () => {
  let lock: TableLock | null = null
  try {
    lock = await holdTableLock('lessons', LOCK_MAX_MS)
    await studentPage.goto('/schedule', { waitUntil: 'commit' })
    const card = studentPage.locator(SKELETON)
    await card.waitFor({ state: 'attached' })
    const samples: HideSample[] = []
    const started = Date.now()
    // Образцы берутся, пока не пройдёт полторы секунды: карточка не проскакивает мимо теста.
    while (Date.now() - started < 1800) {
      samples.push(await sampleHide(card))
      await studentPage.waitForTimeout(100)
    }
    const early = samples.filter((s) => s.age !== null && s.age < 900)
    const late = samples.filter((s) => s.age === null || s.age >= 1000)
    expect(early.length, 'не успели взять образец в первую секунду').toBeGreaterThan(0)
    expect(late.length, 'не дождались образца после первой секунды').toBeGreaterThan(0)
    expect(early.every((s) => s.visibility === 'hidden'), `в первую секунду карточка видна: ${JSON.stringify(early)}`).toBe(true)
    expect(late.every((s) => s.visibility === 'visible'), `после первой секунды карточка не видна: ${JSON.stringify(late)}`).toBe(true)
    await expect(card).toBeVisible()
  } finally {
    await lock?.release()
  }
})

test('загрузка: когда у посетителя анимации выключены целиком, карточка и строка «Загрузка идёт дольше обычного» видны сразу (R-3.7-12)', async () => {
  // Выключение анимаций у посетителя — расширением или правилами пользователя — моделируется стилем `animation: none`.
  // По умолчанию карточка видна, скрывает её только анимация: без анимации скрывать нечему.
  let lock: TableLock | null = null
  try {
    lock = await holdTableLock('lessons', LOCK_MAX_MS)
    await studentPage.goto('/schedule', { waitUntil: 'commit' })
    const card = studentPage.locator(SKELETON)
    await card.waitFor({ state: 'attached' })
    await studentPage.addStyleTag({ content: '*, *::before, *::after { animation: none !important; }' })
    const state = await card.evaluate((el) => ({
      card: getComputedStyle(el).visibility,
      slow: getComputedStyle(el.querySelector('.skel-slow') as Element).visibility,
      animations: el.getAnimations({ subtree: true }).length,
    }))
    expect(state.animations, 'анимации не выключены, проверка ничего не доказывает').toBe(0)
    expect(state.card, 'карточка без анимаций не видна').toBe('visible')
    expect(state.slow, 'строка «Загрузка идёт дольше обычного» без анимаций не видна').toBe('visible')
    await expect(card).toBeVisible()
    await expect(card.getByRole('link', { name: 'Обновить страницу' })).toBeVisible()
  } finally {
    await lock?.release()
  }
})

test('загрузка: дольше 10 секунд — до десятой секунды строки и ссылки «Обновить страницу» не видно, после видно', async () => {
  // Один запрос, который ждёт дольше 10 секунд, база обрывает, и на экране будет ошибка. Запросы внутри границы идут один за другим:
  // сначала данные экрана (`lessons`), потом данные шапки (`notifications`). Первая блокировка снимается сама через 6 секунд, вторая —
  // вручную после десятой секунды. Каждый запрос ждёт меньше 10 секунд, вместе проходит больше.
  let first: TableLock | null = null
  let second: TableLock | null = null
  try {
    second = await holdTableLock('notifications', 20_000)
    first = await holdTableLock('lessons', 6000)
    await studentPage.goto('/schedule', { waitUntil: 'commit' })
    const card = studentPage.locator(SKELETON)
    await card.waitFor({ state: 'attached' })
    const slow = card.locator('.skel-slow')
    const link = slow.locator('a')
    const samples: { slow: HideSample; link: HideSample }[] = []
    const started = Date.now()
    for (;;) {
      const sample = { slow: await sampleHide(slow), link: await sampleHide(link) }
      samples.push(sample)
      if (sample.slow.visibility === 'visible' && (sample.slow.age === null || sample.slow.age >= 10_000)) break
      expect(Date.now() - started, `строка не появилась за 13 секунд; образцы: ${JSON.stringify(samples.slice(-3))}`).toBeLessThan(13_000)
      await studentPage.waitForTimeout(250)
    }
    const early = samples.filter((s) => s.slow.age !== null && s.slow.age < 9500)
    expect(early.length, 'не взято ни одного образца до десятой секунды').toBeGreaterThan(5)
    expect(early.every((s) => s.slow.visibility === 'hidden' && s.link.visibility === 'hidden'), 'до десятой секунды строка или ссылка видны').toBe(true)
    // Скелет в это время на месте, ошибки нет: ни один запрос не прожил 10 секунд.
    await expect(slow).toContainText('Загрузка идёт дольше обычного')
    await expect(slow.getByRole('link', { name: 'Обновить страницу' })).toBeVisible()
    await expect(studentPage.locator('main').getByRole('alert')).toHaveCount(0)
    const link44 = await slow.getByRole('link', { name: 'Обновить страницу' }).boundingBox()
    expect(link44, 'ссылка «Обновить страницу» без размеров').not.toBeNull()
    expect(link44!.height, `высота ссылки ${link44!.height}`).toBeGreaterThanOrEqual(44)
    await expectNoHorizontalScroll(studentPage, 'загрузка дольше 10 секунд')
    await second.release()
    await expect(studentPage.getByRole('heading', { name: /^Расписание на/, level: 1 })).toBeVisible()
    await expect(studentPage.locator(SKELETON)).toHaveCount(0)
    await expect(studentPage.locator('main').getByRole('alert')).toHaveCount(0)
  } finally {
    await first?.release()
    await second?.release()
  }
})

test('загрузка: при запрете на движение пульса у полос нет, карточка при этом появляется; без запрета пульс есть', async ({ browser }) => {
  const calm = await browser.newContext({ storageState: await studentPage.context().storageState(), reducedMotion: 'reduce', extraHTTPHeaders: addressHeaders(freshAddress()) })
  contexts.push(calm)
  const calmPage = await calm.newPage()
  let lock: TableLock | null = null
  try {
    lock = await holdTableLock('lessons', LOCK_MAX_MS)
    await calmPage.goto('/schedule', { waitUntil: 'commit' })
    await expect(calmPage.locator(SKELETON), 'при запрете на движение карточка не появилась').toBeVisible()
    const still = await calmPage.locator('main [data-skeleton]').evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))
    expect(still.length, 'полос скелета нет').toBeGreaterThan(0)
    expect(still.every((name) => name === 'none'), `при запрете на движение у полос есть анимация: ${still.join(', ')}`).toBe(true)

    await studentPage.goto('/schedule', { waitUntil: 'commit' })
    await expect(studentPage.locator(SKELETON)).toBeVisible()
    const pulse = await studentPage.locator('main [data-skeleton]').evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))
    expect(pulse.length, 'полос скелета нет').toBeGreaterThan(0)
    expect(pulse.every((name) => name === 'skel-pulse'), `без запрета на движение пульса нет: ${pulse.join(', ')}`).toBe(true)
  } finally {
    await lock?.release()
  }
})

test('«Повторить» ждёт ответа: «Загружаем…», aria-busy, повторное нажатие ничего не делает; после снятия блокировки — содержимое', async () => {
  let lock: TableLock | null = null
  const refreshes: string[] = []
  const onRequest = (request: PwRequest) => {
    const headers = request.headers()
    if (headers['rsc'] === '1' && !headers['next-router-prefetch']) refreshes.push(request.url())
  }
  try {
    await revokeRead('lessons')
    await studentPage.goto('/schedule')
    const card = studentPage.locator('main').getByRole('alert')
    await expect(card).toBeVisible()
    const retry = card.getByRole('button', { name: 'Повторить' })
    await expect(retry).toBeVisible()
    await expect(retry).not.toHaveAttribute('aria-busy', /.*/)
    await restoreRead('lessons')
    // Блокировка — на `sessions`, которую читает проверка входа: ответ не начинается, пока блокировка держится, и кнопка стоит в ожидании.
    // Блокировка таблицы экрана («lessons») кнопку почти не держит: проверка входа проходит, поток начинается, и скелет сразу заменяет карточку.
    lock = await holdTableLock('sessions', LOCK_MAX_MS)
    studentPage.on('request', onRequest)
    await retry.click()
    const waiting = card.getByRole('button', { name: 'Загружаем…' })
    await expect(waiting, '«Повторить» не перешла в ожидание').toBeVisible()
    await expect(waiting).toHaveAttribute('aria-busy', 'true')
    await expect(waiting).toHaveAttribute('aria-disabled', 'true')
    // Не `disabled`: иначе фокус с кнопки пропадёт (5.1). Playwright считает «выключенной» и кнопку с aria-disabled, поэтому смотрим свойство.
    await expect(waiting, 'в ожидании кнопка стала disabled: фокус пропадёт').toHaveJSProperty('disabled', false)
    await waiting.click({ force: true })
    await studentPage.waitForTimeout(300)
    await lock.release()
    await expect(studentPage.getByRole('heading', { name: /^Расписание на/, level: 1 })).toBeVisible()
    await expect(studentPage.locator('main').getByRole('alert')).toHaveCount(0)
    expect(refreshes.length, `запросов страницы после нажатий: ${refreshes.join(' ')}`).toBe(1)
  } finally {
    studentPage.off('request', onRequest)
    await lock?.release()
    await restoreRead('lessons')
  }
})

test('«Повторить» после ответа с ошибкой снова «Повторить»: без «Загружаем…» и aria-busy, нажать можно', async () => {
  let lock: TableLock | null = null
  try {
    await revokeRead('lessons')
    await studentPage.goto('/schedule')
    const card = studentPage.locator('main').getByRole('alert')
    await expect(card).toBeVisible()
    // Право не возвращено: ответ придёт с той же ошибкой.
    lock = await holdTableLock('sessions', LOCK_MAX_MS)
    await card.getByRole('button', { name: 'Повторить' }).click()
    await expect(card.getByRole('button', { name: 'Загружаем…' }), '«Повторить» не перешла в ожидание').toBeVisible()
    await lock.release()
    // Ответ пришёл с ошибкой: карточка с «Повторить» без признаков ожидания.
    const again = studentPage.locator('main').getByRole('alert').getByRole('button', { name: 'Повторить' })
    await expect(again, 'после ответа с ошибкой кнопка не стала «Повторить»').toBeVisible()
    await expect(again).not.toHaveAttribute('aria-busy', /.*/)
    await expect(again).not.toHaveAttribute('aria-disabled', /.*/)
    // Причину устранили: нажатие работает, как в первый раз.
    await restoreRead('lessons')
    await again.click()
    await expect(studentPage.getByRole('heading', { name: /^Расписание на/, level: 1 })).toBeVisible()
    await expect(studentPage.locator('main').getByRole('alert')).toHaveCount(0)
  } finally {
    await lock?.release()
    await restoreRead('lessons')
  }
})

test('код ответа при отказе базы у каждой из восьми страниц записан; карточка ошибки показывается', async () => {
  // Способ «граница ожидания» отвечает 200, а не 500: код уходит вместе с первой частью потока (названный риск способа).
  // Тест код не чинит: записывает его и проверяет, что карточка ошибки на экране.
  const codes: string[] = []
  for (const c of ALL_PAGES) {
    const page = pageOf(c)
    try {
      await revokeRead(c.table)
      const res = await page.context().request.get(c.path, { maxRedirects: 0 })
      await res.body()
      const note = `${c.path} (${c.name}): код ${res.status()} при отозванном праве на «${c.table}»`
      codes.push(note)
      test.info().annotations.push({ type: 'код при отказе базы', description: note })
      console.log(`КОД ${note}`)
      expect([200, 500], note).toContain(res.status())
      await page.goto(c.path)
      await expect(page.locator('main').getByRole('alert'), `${c.name}: карточки ошибки нет`).toBeVisible()
      await expect(page.locator('main').getByRole('alert').getByRole('button', { name: 'Повторить' })).toBeVisible()
    } finally {
      await restoreRead(c.table)
    }
  }
  expect(codes.length, 'проверено страниц').toBe(8)
  expect(ALL_PAGES.length, 'в списке не восемь страниц').toBe(8)
})

test('все случаи загрузки прошли до конца', async () => {
  // Пять страниц с границей ожидания и три без неё (NO_BOUNDARY_CASES): вместе восемь страниц-списков.
  expect(LOAD_CASES.length, 'список случаев загрузки пуст или не пять страниц').toBe(5)
  expect(LOAD_CASES.length + NO_BOUNDARY_CASES.length, 'страниц-списков не восемь').toBe(8)
  // Как и у случаев ошибки (R-3.7-13, б): сверяются начатые и законченные случаи, запуск части файла не даёт ложного падения.
  test.skip(loadStarted.size === 0, 'в этом запуске не было ни одного случая загрузки')
  const unfinished = [...loadStarted].filter((name) => !loadChecked.has(name))
  expect(unfinished, 'случаи загрузки, которые начались и не дошли до конца').toEqual([])
  expect(loadChecked.size, 'случаев загрузки проверено').toBe(loadStarted.size)
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
