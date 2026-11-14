// Заявки студента на экране 360×800 (пакет 3.4, S-2.1: Э-6, Э-7, Э-8; сценарии С-8 и С-9, ядро задания ЯД-4):
// поле «Куда справка» и «Год оплаты» со значением по умолчанию, «Подать снова» с прежними значениями,
// экран заявки со словами «Что сделать вам» и шагами. Данные — основной набор вымышленных аккаунтов (ТР-5, ТР-11).
// Каждый вход идёт со своим адресом посетителя (helpers/address.ts): лимиты входа и записи не выключаются.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { currentYearIn, DEAN_PURPOSES } from '../../src/lib/requests'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
const staff = MAIN_COHORT.staff
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')

let server: RunningServer | null = null
test.beforeAll(async () => {
  server = await startServer()
})
test.afterAll(async () => {
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

/** Вход под своим адресом посетителя: у каждого входа свои счётчики. Возвращает контекст и страницу уже вошедшего. */
async function signIn(browser: Browser, login: string, password: string, home: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ extraHTTPHeaders: addressHeaders() })
  const page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}${home}`)
  return { context, page }
}

const asStudent = (browser: Browser, who: typeof student1) => signIn(browser, who.login, who.password, '/')

/** Сотрудник ставит заявке статус тем же путём, что в жизни: кнопка статуса, при отклонении — причина, «Сохранить». */
async function staffSets(browser: Browser, requestId: string, status: string, reasonLabel?: string): Promise<void> {
  const { context, page } = await signIn(browser, staff.login, staff.password, '/staff/requests')
  try {
    await page.goto(`/staff/requests/${requestId}`)
    // Форма оживает после загрузки скриптов: нажатие повторяется, пока кнопка статуса не окажется нажатой.
    const pick = page.getByRole('button', { name: status, exact: true })
    await expect(async () => {
      await pick.click()
      await expect(pick).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
    }).toPass({ timeout: 15_000 })
    if (reasonLabel) await page.getByLabel(reasonLabel).check()
    await page.getByRole('button', { name: 'Сохранить' }).click()
    // После «Выдана» и «Отклонена» форма исчезает вместе с сообщением («дальнейших переходов нет»), поэтому смотрим на статус.
    await expect(page.getByTestId('staff-request-status')).toHaveText(status)
  } finally {
    await context.close()
  }
}

/** Подача справки из деканата: вкладка «Заявки» → кнопка вида → поле → «Отправить». Возвращает номер заявки. */
async function submitDean(page: Page, purposeKey?: string): Promise<string> {
  await page.goto('/requests/new?type=dean_certificate')
  if (purposeKey) await page.getByLabel('Куда справка').selectOption(purposeKey)
  await page.getByRole('button', { name: 'Отправить' }).click()
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
  return new URL(page.url()).pathname.split('/').pop() ?? ''
}

async function submitTuition(page: Page, year?: string): Promise<string> {
  await page.goto('/requests/new?type=tuition_certificate')
  if (year) await page.getByLabel('Год оплаты').selectOption(year)
  await page.getByRole('button', { name: 'Отправить' }).click()
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
  return new URL(page.url()).pathname.split('/').pop() ?? ''
}

const stepsOf = (page: Page) => page.getByRole('list', { name: 'Шаги заявки' }).getByRole('listitem')

test('Э-7 и Э-8: студент меняет «Куда справка», отправляет и видит своё значение на экране заявки и в списке', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    await page.goto('/requests/new?type=dean_certificate')
    const select = page.getByLabel('Куда справка')
    await expect(select).toBeVisible()
    // Настоящий выпадающий список, 17 значений, по умолчанию выбрано «По месту требования».
    expect(await select.evaluate((el) => el.tagName)).toBe('SELECT')
    await expect(select.locator('option')).toHaveCount(17)
    await expect(select).toHaveValue('on_demand')
    await expect(select.locator('option:checked')).toHaveText('По месту требования')
    const last = DEAN_PURPOSES[DEAN_PURPOSES.length - 1]!
    await expect(select.locator('option').last()).toHaveText(last.label)
    const box = await select.boundingBox()
    expect(box!.height, 'высота поля').toBeGreaterThanOrEqual(44)
    await expectNoHorizontalScroll(page, 'Э-7, справка из деканата')

    await select.selectOption('tax_office')
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    await expect(page.getByTestId('request-field')).toHaveText('Куда: В налоговую инспекцию')
    await expect(page.getByTestId('request-status')).toHaveText('Подана')
    await expectNoHorizontalScroll(page, 'Э-8')

    // Э-6: то же поле в строке заявки.
    await page.goto('/requests')
    await expect(page.locator('a[href^="/requests/"]', { hasText: 'Куда: В налоговую инспекцию' }).first()).toBeVisible()
  } finally {
    await context.close()
  }
})

test('Э-7: справка об оплате — поле «Год оплаты» с годами от 2024 до текущего; по умолчанию прошлый год', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    const year = currentYearIn('Europe/Moscow')
    await page.goto('/requests/new?type=tuition_certificate')
    const select = page.getByLabel('Год оплаты')
    expect(await select.evaluate((el) => el.tagName)).toBe('SELECT')
    await expect(select.locator('option')).toHaveCount(year - 2024 + 1)
    await expect(select.locator('option').first()).toHaveText('2024')
    await expect(select.locator('option').last()).toHaveText(String(year))
    await expect(select).toHaveValue(String(Math.max(2024, year - 1)))
    await expectNoHorizontalScroll(page, 'Э-7, справка об оплате')

    await select.selectOption('2024')
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    await expect(page.getByTestId('request-field')).toHaveText('Год оплаты: 2024')

    // У материальной помощи поля нет.
    await page.goto('/requests/new?type=financial_aid')
    await expect(page.locator('select')).toHaveCount(0)
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    await expect(page.getByTestId('request-field')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('Э-8: отклонённая заявка — «Подать снова» открывает Э-7 с прежним значением; кнопки и шаги по правилам 5.8 и 5.12', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    const embassy = DEAN_PURPOSES.find((p) => p.key === 'embassy')!
    const deanId = await submitDean(page, 'embassy')
    await staffSets(browser, deanId, 'Отклонена', 'Другая причина, уточните в деканате')

    await page.goto(`/requests/${deanId}`)
    await expect(page.getByTestId('request-status')).toHaveText('Отклонена')
    await expect(page.getByRole('heading', { name: 'Что сделать вам', level: 2 })).toBeVisible()
    await expect(page.getByTestId('request-status-text')).toHaveText('Заявка отклонена. Причину уточните в деканате. Можно подать снова')
    // Шаги: «Подана» — сделано; затем один шаг «Отклонена» с aria-current; непройденных шагов нет.
    const steps = stepsOf(page)
    await expect(steps).toHaveCount(2)
    await expect(steps.nth(0)).toContainText('СДЕЛАНО')
    await expect(steps.nth(0)).toContainText('Подана')
    await expect(steps.nth(0)).toContainText(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}\. Деканат её получил\./)
    await expect(steps.nth(1)).toContainText('ОТКЛОНЕНО')
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step')
    await expect(steps.nth(0)).not.toHaveAttribute('aria-current', /.*/)
    await expect(page.getByText('ДАЛЬШЕ')).toHaveCount(0)
    await expect(page.getByText('СЕЙЧАС')).toHaveCount(0)

    // Кнопки: «Подать снова», под ней «К списку заявок»; зона касания не меньше 44 пикселей.
    const again = page.getByRole('link', { name: 'Подать снова' })
    const toList = page.getByRole('link', { name: 'К списку заявок' })
    const [againBox, listBox] = [await again.boundingBox(), await toList.boundingBox()]
    expect(againBox!.height).toBeGreaterThanOrEqual(44)
    expect(listBox!.height).toBeGreaterThanOrEqual(44)
    expect(listBox!.y, '«К списку заявок» под «Подать снова»').toBeGreaterThan(againBox!.y)
    await expectNoHorizontalScroll(page, 'Э-8, отклонена')

    await again.click()
    await expect(page).toHaveURL(`${BASE_URL}/requests/new?type=dean_certificate&from=${deanId}`)
    // Значение в адрес не кладётся, но в поле стоит прежнее.
    expect(page.url()).not.toContain('embassy')
    expect(page.url()).not.toContain('посольство')
    await expect(page.getByLabel('Куда справка')).toHaveValue('embassy')
    await expect(page.getByLabel('Куда справка').locator('option:checked')).toHaveText(embassy.label)
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    expect(new URL(page.url()).pathname.split('/').pop()).not.toBe(deanId)
    await expect(page.getByTestId('request-field')).toHaveText('Куда: В посольство')

    // То же у справки об оплате: прежний год.
    const tuitionId = await submitTuition(page, '2024')
    await staffSets(browser, tuitionId, 'Отклонена', 'Не хватает данных')
    await page.goto(`/requests/${tuitionId}`)
    await expect(page.getByTestId('request-status-text')).toHaveText('Заявка отклонена. Причина: Не хватает данных. Можно подать снова')
    await page.getByRole('link', { name: 'Подать снова' }).click()
    await expect(page.getByLabel('Год оплаты')).toHaveValue('2024')
  } finally {
    await context.close()
  }
})

test('Э-7: «Подать снова» с чужим номером — «нет такой заявки»; вид не совпал — на список', async ({ browser }) => {
  const first = await asStudent(browser, student1)
  let foreignId: string
  let ownTuitionId: string
  try {
    foreignId = await submitDean(first.page, 'embassy')
    ownTuitionId = await submitTuition(first.page, '2024')
    // Прежняя заявка того же студента, но вид в адресе другой: переход на список заявок.
    await first.page.goto(`/requests/new?type=dean_certificate&from=${ownTuitionId}`)
    await expect(first.page).toHaveURL(`${BASE_URL}/requests`)
  } finally {
    await first.context.close()
  }

  const second = await asStudent(browser, student2)
  try {
    const foreign = await second.page.goto(`/requests/new?type=dean_certificate&from=${foreignId}`)
    expect(foreign!.status()).toBe(404)
    await expect(second.page.getByRole('heading', { name: 'Нет такой заявки' })).toBeVisible()
    const html = await foreign!.text()
    // Ни прежнего значения, ни слов первого студента в ответе нет.
    for (const text of ['В посольство', 'embassy', student1.fullName, student1.markers.requests]) {
      expect(html, `в ответе чужому есть «${text}»`).not.toContain(text)
    }
    await expect(second.page.locator('select')).toHaveCount(0)
    await expectNoHorizontalScroll(second.page, 'нет такой заявки')

    // Несуществующая и не-номер выглядят так же, как чужая.
    for (const from of ['00000000-0000-4000-8000-000000000000', 'abc', encodeURIComponent('1; drop table requests')]) {
      const res = await second.page.goto(`/requests/new?type=dean_certificate&from=${from}`)
      expect(res!.status(), from).toBe(404)
      await expect(second.page.getByRole('heading', { name: 'Нет такой заявки' })).toBeVisible()
    }
    // Без `from` форма открывается со значением по умолчанию.
    await second.page.goto('/requests/new?type=dean_certificate')
    await expect(second.page.getByLabel('Куда справка')).toHaveValue('on_demand')
  } finally {
    await second.context.close()
  }
})

test('Э-8 во всех видах: подана, в работе, готова, выдана — ссылка, блок «Что сделать вам», шаги с пояснениями', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    const id = await submitDean(page, 'library')
    const state = async (status: string) => {
      await page.goto(`/requests/${id}`)
      await expect(page.getByTestId('request-status')).toHaveText(status)
      await expectNoHorizontalScroll(page, `Э-8, ${status}`)
    }

    // Все виды: «Все заявки» — первая ссылка в содержимом, зона касания не меньше 44 пикселей.
    await state('Подана')
    const back = page.getByRole('link', { name: 'Все заявки', exact: true })
    await expect(back).toHaveAttribute('href', '/requests')
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(page.getByTestId('request-field')).toHaveText('Куда: В библиотеку')
    await expect(page.getByRole('heading', { name: 'Что сделать вам', level: 2 })).toBeVisible()
    await expect(page.getByTestId('request-status-text')).toHaveText('Заявка у деканата. Пока ничего делать не нужно')
    let steps = stepsOf(page)
    await expect(steps).toHaveCount(4)
    await expect(steps.nth(0)).toContainText('СЕЙЧАС')
    await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step')
    await expect(steps.nth(0)).toContainText('Деканат её получил.')
    for (const i of [1, 2, 3]) await expect(steps.nth(i)).toContainText('ДАЛЬШЕ')
    await expect(steps.nth(2)).not.toContainText('ДАЛЬШЕ — ВАМ')
    await expect(steps.nth(2)).toContainText('Забрать в деканате лично, кабинет 105, 1 корпус')
    await expect(page.getByRole('link', { name: 'Подать снова' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'К списку заявок' })).toBeVisible()

    await staffSets(browser, id, 'В работе')
    await state('В работе')
    await expect(page.getByTestId('request-status-text')).toHaveText(/^Пока ничего\. Срок — до \d{2}\.\d{2}\.\d{4}$/)
    steps = stepsOf(page)
    await expect(steps.nth(0)).toContainText('СДЕЛАНО')
    await expect(steps.nth(1)).toContainText('СЕЙЧАС')
    await expect(steps.nth(1)).toContainText(/Срок — до \d{2}\.\d{2}\.\d{4}\./)
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step')
    await expect(steps.nth(2)).toContainText('ДАЛЬШЕ — ВАМ')
    await expect(steps.nth(3)).toContainText('ДАЛЬШЕ')
    // Блок «Куда / До какого дня» стоит только на шаге «Готова» при статусе «Готова».
    await expect(page.getByText('До какого дня')).toHaveCount(0)

    await staffSets(browser, id, 'Готова')
    await state('Готова')
    await expect(page.getByTestId('request-status-text')).toContainText('кабинет 105, 1 корпус')
    steps = stepsOf(page)
    await expect(steps.nth(2)).toContainText('СЕЙЧАС')
    await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step')
    await expect(steps.nth(2).getByText('Куда', { exact: true })).toBeVisible()
    await expect(steps.nth(2).getByText('105, 1 корпус')).toBeVisible()
    await expect(steps.nth(2).getByText('До какого дня')).toBeVisible()
    await expect(page.getByText('До какого дня')).toHaveCount(1)

    await staffSets(browser, id, 'Выдана')
    await state('Выдана')
    // Выдана: блока «Что сделать вам» нет; четыре шага «сделано»; aria-current нет ни у одного.
    await expect(page.getByRole('heading', { name: 'Что сделать вам' })).toHaveCount(0)
    await expect(page.getByTestId('request-status-text')).toHaveCount(0)
    steps = stepsOf(page)
    await expect(steps).toHaveCount(4)
    for (const i of [0, 1, 2, 3]) await expect(steps.nth(i)).toContainText('СДЕЛАНО')
    await expect(page.locator('[aria-current="step"]')).toHaveCount(0)
    await expect(steps.nth(3)).toContainText(/Вы получили документ \d{2}\.\d{2}\.\d{4}\./)
    await expect(page.getByText('До какого дня')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Подать снова' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('Э-7 и Э-8: длинное значение «Куда справка» не вылезает за экран на 360 и 320 пикселей', async ({ browser }) => {
  const { context, page } = await asStudent(browser, student1)
  try {
    const longest = DEAN_PURPOSES[DEAN_PURPOSES.length - 1]!
    const id = await submitDean(page, longest.key)
    await expect(page.getByTestId('request-field')).toHaveText(`Куда: ${longest.label}`)
    for (const width of [360, 320]) {
      await page.setViewportSize({ width, height: 800 })
      for (const path of [`/requests/${id}`, '/requests', `/requests/new?type=dean_certificate&from=${id}`]) {
        await page.goto(path)
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))
        expect(scrollWidth, `${path} на ${width} px`).toBeLessThanOrEqual(clientWidth)
      }
      // Значение переносится, а не обрезается: на экране заявки высота строки больше одной строки текста.
      await page.goto(`/requests/${id}`)
      const field = page.getByTestId('request-field')
      const lines = await field.evaluate((el) => Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)))
      expect(lines, `на ${width} px длинное значение в несколько строк`).toBeGreaterThan(1)
      const clipped = await field.evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(clipped).toBeLessThanOrEqual(0)
    }
  } finally {
    await context.close()
  }
})
