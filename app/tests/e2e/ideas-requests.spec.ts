// Заявки: одна фраза, фильтр «Требуют ответа», мгновенная справка с QR. Не запускалось исполнителем:
// e2e прогоняет оркестратор. Данные — основной набор вымышленных аккаунтов (ТР-5, ТР-11).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders } from './helpers/address'
import { fillLogin } from './helpers/auth'
import { BASE_URL, startServer, stopServer, type RunningServer } from './helpers/server'

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')

let server: RunningServer | null = null
test.beforeAll(async () => {
  server = await startServer()
})
test.afterAll(async () => {
  if (server) await stopServer(server)
  server = null
})

async function signIn(browser: Browser, login: string, password: string, home: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ extraHTTPHeaders: addressHeaders() })
  const page = await context.newPage()
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${BASE_URL}${home}`)
  return { context, page }
}

test('фраза → предзаполненная форма; студент подаёт сам', async ({ browser }) => {
  const { context, page } = await signIn(browser, student1.login, student1.password, '/')
  try {
    await page.goto('/requests/new?type=dean_certificate')
    await expect(page.getByText('Подбор по ключевым словам')).toBeVisible()
    await page.getByLabel('Опишите, что нужно').fill('справка в налоговую к пятнице, 2 экземпляра')
    await page.getByRole('button', { name: 'Заполнить' }).click()
    await expect(page).toHaveURL(/q=/)
    await expect(page.getByTestId('intent-result')).toContainText('Форма заполнена')
    await expect(page.getByLabel('Куда справка')).toHaveValue('tax_office')
    // Автоподачи нет: заявка появится только после «Отправить».
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    await expect(page.getByTestId('request-field')).toHaveText('Куда: В налоговую инспекцию')
  } finally {
    await context.close()
  }
})

test('фраза про оплату выбирает справку об оплате и год', async ({ browser }) => {
  const { context, page } = await signIn(browser, student1.login, student1.password, '/')
  try {
    await page.goto('/requests/new?type=dean_certificate')
    await page.getByLabel('Опишите, что нужно').fill('справка об оплате для налогового вычета за 2025 год')
    await page.getByRole('button', { name: 'Заполнить' }).click()
    await expect(page.getByLabel('Год оплаты')).toHaveValue('2025')
  } finally {
    await context.close()
  }
})

test('нераспознанная фраза: честная строка и выбор типа', async ({ browser }) => {
  const { context, page } = await signIn(browser, student1.login, student1.password, '/')
  try {
    await page.goto('/requests/new?type=dean_certificate')
    await page.getByLabel('Опишите, что нужно').fill('хочу пересдать физику')
    await page.getByRole('button', { name: 'Заполнить' }).click()
    await expect(page.getByTestId('intent-result')).toContainText('Не понял, выберите тип справки ниже')
    await expect(page.getByRole('link', { name: 'Справка об оплате обучения' })).toBeVisible()
  } finally {
    await context.close()
  }
})

test('фильтр «Требуют ответа» — параметр адреса, без скриптов', async ({ browser }) => {
  const { context, page } = await signIn(browser, student1.login, student1.password, '/')
  try {
    await page.goto('/requests')
    // Новая заявка «Подана»: ход у деканата, в «Требуют ответа» её нет, в «В работе» — есть.
    await page.goto('/requests/new?type=dean_certificate')
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/)
    await page.goto('/requests?filter=active')
    await expect(page.getByRole('link', { name: /Справка из деканата/ }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Требуют ответа' })).toHaveAttribute('href', '/requests?filter=action')
    await page.goto('/requests?filter=action')
    await expect(page.getByRole('link', { name: 'Требуют ответа' })).toHaveAttribute('aria-current', 'page')
    await page.goto('/requests?filter=мусор')
    await expect(page.getByRole('link', { name: 'Все' })).toHaveAttribute('aria-current', 'page')
  } finally {
    await context.close()
  }
})

test('«Получить сразу» → печатная страница с QR → /verify «действительна»; изменённый код и чужой студент — отказ', async ({ browser }) => {
  const { context, page } = await signIn(browser, student1.login, student1.password, '/')
  const other = await signIn(browser, student2.login, student2.password, '/')
  try {
    // В основном наборе у студента уже есть справка, которую готовил деканат: «Ждёт вас» просит её забрать. Новая такой строки не добавит.
    await page.goto('/')
    const pickupBefore = await page.getByText('Забрать справку').count()
    await page.goto('/requests/new?type=dean_certificate')
    await page.getByRole('button', { name: 'Получить сразу' }).click()
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}\/certificate$/)
    await expect(page.getByTestId('certificate-title')).toHaveText('Справка об обучении')
    await expect(page.getByTestId('certificate-qr')).toBeVisible()
    const text = (await page.getByText('Проверка подлинности:').textContent()) ?? ''
    const verifyUrl = text.replace('Проверка подлинности:', '').trim()
    expect(verifyUrl).toMatch(/\/verify\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const certificatePath = new URL(page.url()).pathname

    // Справка сразу «Выдана»: на странице заявки есть возврат к QR, а «Сегодня» не просит её забрать.
    const requestPath = certificatePath.replace(/\/certificate$/, '')
    await page.goto(requestPath)
    await expect(page.getByTestId('request-status')).toContainText('Выдана')
    await expect(page.getByRole('link', { name: 'Открыть справку с QR' })).toHaveAttribute('href', certificatePath)
    await page.goto('/')
    await expect(page.getByText('Забрать справку')).toHaveCount(pickupBefore)
    await page.goto(certificatePath)

    // Публичная страница: без входа.
    const anonymous = await browser.newContext()
    const anon = await anonymous.newPage()
    await anon.goto(new URL(verifyUrl).pathname)
    await expect(anon.getByTestId('verify-result')).toHaveText('Справка действительна')
    await expect(anon.getByText('Прототип. Данные вымышленные')).toBeVisible()
    // Сокращённое ФИО: «Фамилия И. О.», полного имени нет.
    await expect(anon.getByText(student1.fullName)).toHaveCount(0)
    const tampered = new URL(verifyUrl).pathname.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))
    const response = await anon.goto(tampered)
    expect(response?.status()).toBe(404)
    await expect(anon.getByTestId('verify-result')).toHaveText('Справка не найдена')
    await anonymous.close()

    // Чужой студент печатную страницу не получает.
    const foreign = await other.page.goto(certificatePath)
    expect(foreign?.status()).toBe(404)
  } finally {
    await context.close()
    await other.context.close()
  }
})
