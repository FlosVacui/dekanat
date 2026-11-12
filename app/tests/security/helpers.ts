// Помощники атакующих тестов (пакет 2.6). Не тест: Playwright берёт только *.spec.ts.
// Вход — через настоящую форму в браузере; дальше запросы идут «сырыми» из Node.js с кукой, подставленной руками,
// как их отправил бы злоумышленник: без браузера, без страницы, без кнопок.
import { randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { addressHeaders } from '../e2e/helpers/address'
import { fillLogin } from '../e2e/helpers/auth'
import { BASE_URL } from '../e2e/helpers/server'

export const COOKIE = '__Host-session'

const [studentA, studentB] = MAIN_COHORT.students
if (!studentA || !studentB) throw new Error('В основном наборе должно быть два студента')
export const A = studentA
export const B = studentB
export const STAFF = MAIN_COHORT.staff

export interface Account {
  login: string
  password: string
}

/** Метки студента: ФИО и пять меток разделов из вымышленных данных. */
export function markersOf(student: typeof A): string[] {
  return [student.fullName, ...Object.values(student.markers)].filter((m) => m && m !== '—')
}

export interface Session {
  context: BrowserContext
  page: Page
  token: string
  /** Заголовок Set-Cookie ответа на вход — для проверки атрибутов куки (В-06). */
  setCookie: string | null
}

/** Вход через форму. Возвращает контекст браузера и значение куки сессии. */
export async function login(browser: Browser, account: Account): Promise<Session> {
  // Адрес посетителя шлёт тест, как прокси на сервере: у каждого входа свой, лимиты входа не меняются (пакет 3.1).
  const context = await browser.newContext({ extraHTTPHeaders: addressHeaders() })
  const page = await context.newPage()
  let setCookie: string | null = null
  page.on('response', async (res) => {
    const value = await res.headerValue('set-cookie').catch(() => null)
    if (value && value.includes(`${COOKIE}=`) && !value.includes(`${COOKIE}=;`)) setCookie = value
  })
  await page.goto('/login')
  await fillLogin(page, account.login, account.password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForURL((url) => url.pathname !== '/login')
  const cookie = (await context.cookies()).find((c) => c.name === COOKIE)
  if (!cookie) throw new Error(`Вход под ${account.login}: куки сессии нет`)
  return { context, page, token: cookie.value, setCookie }
}

export interface RawResponse {
  status: number
  headers: Headers
  text: string
  location: string | null
}

/** «Сырой» запрос к стенду. token — значение куки сессии; undefined — без куки. Перенаправления не выполняются. */
export async function raw(
  path: string,
  options: { token?: string; method?: string; headers?: Record<string, string>; body?: BodyInit } = {},
): Promise<RawResponse> {
  // Адрес посетителя — заголовком, как его ставит прокси (пакет 3.1). Явный заголовок теста главнее.
  const headers = new Headers({ ...addressHeaders(), ...options.headers })
  if (options.token !== undefined) headers.set('cookie', `${COOKIE}=${options.token}`)
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
    redirect: 'manual',
  })
  return { status: res.status, headers: res.headers, text: await res.text(), location: res.headers.get('location') }
}

/**
 * Данные страницы для клиента (RSC), как их запрашивает роутер Next.js: заголовок `rsc: 1`. Сервер сверяет
 * параметр `_rsc` с заголовками и при несовпадении перенаправляет на тот же адрес с верным `_rsc` — идём за ним.
 */
export async function rawRsc(path: string, token?: string): Promise<RawResponse> {
  let target = path
  for (let hop = 0; hop < 3; hop += 1) {
    const res = await raw(target, { token, headers: { rsc: '1' } })
    if (![307, 308].includes(res.status) || !res.location) return res
    const next = new URL(res.location, BASE_URL)
    if (next.pathname !== new URL(target, BASE_URL).pathname || !next.searchParams.has('_rsc')) return res
    target = next.pathname + next.search
  }
  throw new Error(`RSC ${path}: слишком много перенаправлений`)
}

/** Отказ или отправка на вход: 401/403/404 либо перенаправление на /login. */
export function isDenied(res: RawResponse): boolean {
  if ([401, 403, 404].includes(res.status)) return true
  if ([302, 303, 307, 308].includes(res.status) && res.location) {
    return new URL(res.location, BASE_URL).pathname === '/login'
  }
  return false
}

/** Номера заявок со страницы «Мои заявки» под данной кукой. */
export async function myRequestIds(token: string): Promise<string[]> {
  const res = await raw('/requests', { token })
  const ids = [...res.text.matchAll(/href="\/requests\/([0-9a-f-]{36})"/g)].map((m) => m[1]!)
  return [...new Set(ids)]
}

/** Номер своей заявки, на странице которой есть метка. */
export async function requestIdWithMarker(token: string, marker: string): Promise<string> {
  for (const id of await myRequestIds(token)) {
    const res = await raw(`/requests/${id}`, { token })
    if (res.status === 200 && res.text.includes(marker)) return id
  }
  throw new Error(`Заявки с меткой «${marker}» нет`)
}

/** Идентификатор серверного действия из формы без JavaScript: скрытое поле $ACTION_ID_<id>. */
export function actionIdFromHtml(html: string): string {
  const match = html.match(/name="\$ACTION_ID_([0-9a-f]+)"/)
  if (!match?.[1]) throw new Error('В странице нет формы с серверным действием')
  return match[1]
}

/**
 * Подача заявки «сырым» запросом формы без JavaScript, как её отправляет браузер с выключенными скриптами.
 * extra — лишние поля, которых в форме нет (П-04).
 */
export async function submitRequestRaw(
  token: string,
  kind: string,
  extra: Record<string, string> = {},
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  const page = await raw(`/requests/new?type=${kind}`, { token })
  const actionId = actionIdFromHtml(page.text)
  const form = new FormData()
  form.set(`$ACTION_ID_${actionId}`, '')
  form.set('kind', kind)
  for (const [key, value] of Object.entries(extra)) form.append(key, value)
  return raw(`/requests/new?type=${kind}`, {
    token,
    method: 'POST',
    headers: { origin: BASE_URL, ...headers },
    body: form,
  })
}

/** Номер новой заявки из ответа на подачу: перенаправление на /requests/<id>. */
export function createdRequestId(res: RawResponse): string | null {
  const target = res.location ?? res.headers.get('x-action-redirect')
  const match = target?.match(/\/requests\/([0-9a-f-]{36})/)
  return match?.[1] ?? null
}

/** Подача заявки через интерфейс: тот же путь, что у студента. Возвращает номер заявки. */
export async function submitRequestUi(page: Page, kind: string): Promise<string> {
  await page.goto(`/requests/new?type=${kind}`)
  await page.getByRole('button', { name: 'Отправить' }).click()
  await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/)
  const id = new URL(page.url()).pathname.split('/').pop()
  if (!id) throw new Error('Номер заявки не получен')
  return id
}

/** Статус заявки на странице студента (Э-8). */
export async function studentSeesStatus(token: string, requestId: string): Promise<string | null> {
  const res = await raw(`/requests/${requestId}`, { token })
  const match = res.text.match(/data-testid="request-status"[^>]*>([^<]+)</)
  return match?.[1]?.trim() ?? null
}

export interface CapturedAction {
  path: string
  headers: Record<string, string>
  body: string
}

/**
 * Перехват настоящего запроса серверного действия сотрудника «сменить статус»: сотрудник выбирает статус и
 * нажимает «Сохранить», запрос перехватывается и обрывается — заявка не меняется. Потом его повторяют под чужой кукой.
 */
export async function captureStatusAction(staff: Session, requestId: string, button: string): Promise<CapturedAction> {
  const { page } = staff
  await page.goto(`/staff/requests/${requestId}`)
  let captured: CapturedAction | null = null
  await page.route('**/*', async (route) => {
    const req = route.request()
    const headers = req.headers()
    if (req.method() === 'POST' && headers['next-action']) {
      captured = { path: new URL(req.url()).pathname + new URL(req.url()).search, headers, body: req.postData() ?? '' }
      await route.abort()
      return
    }
    await route.continue()
  })
  await page.getByRole('button', { name: button, exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  const deadline = Date.now() + 10_000
  while (!captured && Date.now() < deadline) await page.waitForTimeout(100)
  await page.unroute('**/*')
  if (!captured) throw new Error('Запрос смены статуса не перехвачен')
  return captured
}

/** Повтор перехваченного действия под другой кукой и с другим номером заявки. */
export async function replayStatusAction(
  action: CapturedAction,
  token: string | undefined,
  fromId: string,
  toId: string,
): Promise<RawResponse> {
  const headers: Record<string, string> = {}
  for (const name of ['next-action', 'next-router-state-tree', 'content-type', 'accept', 'origin']) {
    const value = action.headers[name]
    if (value) headers[name] = value
  }
  return raw(action.path, { token, method: 'POST', headers, body: action.body.split(fromId).join(toId) })
}

export function randomId(): string {
  return randomUUID()
}
