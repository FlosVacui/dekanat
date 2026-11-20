// Атакующие тесты аудита ворот 3, пакет 3.10 (SEC-3.10). Ядро целиком: расписание, успеваемость с экраном дисциплины,
// уведомления с отметкой «прочитано», «Сегодня», полный кабинет сотрудника, экраны ошибки.
// Проверки — R-1.5, раздел 4; что повторять — ADR-0005, «Повторы». Доказательство — чужая метка в ответе, а не код ответа.
// Второй набор (студент и сотрудник другой области) тест создаёт сам в локальной базе запросом владельца и сам удаляет:
// только вымышленные данные, логины с приставкой sec310-. Тест сам поднимает и гасит сервер на порту 3100.
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import pg from 'pg'
import { MAIN_COHORT } from '../../db/seed-data'
import { buildCohortPlan } from '../../db/seed-plan'
import { addDays, todayIn } from '../../src/lib/dates'
import { hashPassword } from '../../src/server/auth/password'
import { restoreFeedState, restoreRead, revokeRead, snapshotFeedState, appCanRead, REVOCABLE_TABLES, type FeedState } from '../e2e/helpers/db'
import { BASE_URL, startServer, stopServer, type RunningServer } from '../e2e/helpers/server'
import {
  A,
  B,
  STAFF,
  captureStatusAction,
  createdRequestId,
  isDenied,
  login,
  markersOf,
  myRequestIds,
  raw,
  rawRsc,
  requestIdWithMarker,
  studentSeesStatus,
  submitRequestRaw,
  submitRequestUi,
  type CapturedAction,
  type RawResponse,
  type Session,
} from './helpers'

test.describe.configure({ mode: 'serial' })

// ---------- База: запросы владельца, адрес — как в tests/e2e/helpers/db.ts (значения не печатаются) ----------

function ownerUrl(): string {
  if (!process.env.DATABASE_OWNER_URL) {
    process.loadEnvFile(process.env.ENV_FILE || fileURLToPath(new URL('../../../.env', import.meta.url)))
  }
  const url = process.env.DATABASE_OWNER_URL
  if (!url) throw new Error('Нет DATABASE_OWNER_URL')
  return url
}

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: ownerUrl() })
  await client.connect()
  try {
    return (await client.query(text, params)).rows as T[]
  } finally {
    await client.end()
  }
}

// ---------- Второй набор: своя область сотрудника и сохранённый «ввод» с полезной нагрузкой (П-12, Н-01) ----------

const ALT_COHORT = 'sec310-alt'
const ALT_MARKER = 'Альтов-SEC310'
const ALT_GROUP = 'SEC310-АЛЬТ'
// Нагрузки Н-01: выполнись любая — в окне появится window.__sec310 с номером нагрузки.
const XSS_NAME = `${ALT_MARKER} "><svg onload="window.__sec310=2"> <img src=x onerror="window.__sec310=1">`
const XSS_NOTE = 'Примечание <img src=x onerror="window.__sec310=4">'
const XSS_TITLE = '<script>window.__sec310=5</script>Уведомление'
const XSS_BODY = '<img src=x onerror="window.__sec310=6"> текст'
const XSS_LINK = 'javascript:window.__sec310=7'
const ALT_STUDENT = { login: 'sec310-alt-student', password: `sec310-${randomUUID()}` }
const ALT_STAFF = { login: 'sec310-alt-staff', password: `sec310-${randomUUID()}` }

async function dropAltCohort(): Promise<void> {
  await sql(`delete from users where cohort = $1`, [ALT_COHORT])
  await sql(`delete from groups where name like 'SEC310-%'`)
  await sql(`delete from login_attempts where login like 'sec310-%'`)
  await sql(`delete from login_streaks where login like 'sec310-%'`)
}

async function createAltCohort(): Promise<{ studentId: string; requestId: string }> {
  await dropAltCohort()
  const [student] = await sql<{ id: string }>(
    `insert into users (login, password_hash, role, cohort) values ($1, $2, 'student', $3) returning id`,
    [ALT_STUDENT.login, await hashPassword(ALT_STUDENT.password), ALT_COHORT],
  )
  await sql(`insert into users (login, password_hash, role, cohort) values ($1, $2, 'staff', $3)`, [
    ALT_STAFF.login,
    await hashPassword(ALT_STAFF.password),
    ALT_COHORT,
  ])
  const [group] = await sql<{ id: string }>(`insert into groups (name, faculty) values ($1, 'Факультет проверки SEC310') returning id`, [ALT_GROUP])
  await sql(
    `insert into students (user_id, full_name, faculty, programme, course, group_id) values ($1, $2, 'Факультет проверки SEC310', 'Проверка', 1, $3)`,
    [student!.id, XSS_NAME, group!.id],
  )
  const [request] = await sql<{ id: string }>(
    `insert into requests (student_id, kind, status, note, ip, purpose) values ($1, 'dean_certificate', 'submitted', $2, 'sec310', 'on_demand') returning id`,
    [student!.id, XSS_NOTE],
  )
  await sql(`insert into request_events (request_id, status, by_user_id, ip) values ($1, 'submitted', $2, 'sec310')`, [request!.id, student!.id])
  await sql(`insert into notifications (student_id, kind, title, body, link) values ($1, 'reminder', $2, $3, $4)`, [
    student!.id,
    XSS_TITLE,
    XSS_BODY,
    XSS_LINK,
  ])
  return { studentId: student!.id, requestId: request!.id }
}

// ---------- Формы без JavaScript: скрытые поля и идентификатор действия ----------

interface HtmlForm {
  actionId: string
  fields: Record<string, string>
  html: string
}

function formsOf(html: string): HtmlForm[] {
  const forms: HtmlForm[] = []
  for (const m of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)) {
    const inner = m[1] ?? ''
    const id = inner.match(/name="\$ACTION_ID_([0-9a-f]+)"/)?.[1]
    if (!id) continue
    const fields: Record<string, string> = {}
    for (const input of inner.matchAll(/<input\b[^>]*>/g)) {
      const name = input[0].match(/name="([^"]+)"/)?.[1]
      if (!name || name.startsWith('$ACTION')) continue
      fields[name] = input[0].match(/value="([^"]*)"/)?.[1] ?? ''
    }
    forms.push({ actionId: id, fields, html: inner })
  }
  return forms
}

/** Идентификатор действия «открыть запись ленты» — у формы со скрытым полем source. */
async function openFeedActionId(token: string): Promise<string> {
  const form = formsOf((await raw('/notifications', { token })).text).find((f) => 'source' in f.fields)
  if (!form) throw new Error('На ленте нет формы «открыть запись»: у студента нет непрочитанного')
  return form.actionId
}

/** Отправка формы ленты «сырым» запросом, как браузер без скриптов. headers.origin === null — без Origin. */
async function postFeedForm(
  token: string | undefined,
  actionId: string,
  fields: Record<string, string>,
  origin: string | null = BASE_URL,
): Promise<RawResponse> {
  const form = new FormData()
  form.set(`$ACTION_ID_${actionId}`, '')
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return raw('/notifications', { token, method: 'POST', headers: origin === null ? {} : { origin }, body: form })
}

/** Повтор перехваченного действия смены статуса с выбранным Origin; null — без заголовка. */
async function replayWithOrigin(action: CapturedAction, token: string | undefined, fromId: string, toId: string, origin: string | null): Promise<RawResponse> {
  const headers: Record<string, string> = {}
  for (const name of ['next-action', 'next-router-state-tree', 'content-type', 'accept']) {
    const value = action.headers[name]
    if (value) headers[name] = value
  }
  if (origin !== null) headers.origin = origin
  return raw(action.path, { token, method: 'POST', headers, body: action.body.split(fromId).join(toId) })
}

async function notificationRead(id: string): Promise<boolean> {
  const [row] = await sql<{ read: boolean }>('select read_at is not null as read from notifications where id = $1', [id])
  if (!row) throw new Error(`Уведомления ${id} нет`)
  return row.read
}

async function requestStatus(id: string): Promise<string | undefined> {
  return (await sql<{ status: string }>('select status from requests where id = $1', [id]))[0]?.status
}

function expectNoMarkers(text: string, markers: string[], where: string): void {
  for (const m of markers) expect(text.includes(m), `${where}: найдена чужая метка «${m}»`).toBe(false)
}

// Служебное в теле ответа при отказе базы: текст отказа, запрос, имена таблиц в запросе, пути сборки, строки стека.
// Шаблоны — те же по смыслу, что в tests/e2e/states.spec.ts (R-3.7-14); `digest` из цифр допустим.
const SERVICE_PATTERNS: [string, RegExp][] = [
  ['permission denied', /permission denied/i],
  ['relation "', /relation\s+\\*"/i],
  ['запрос select', /\bselect\s+\\*"\w+/i],
  ['имя таблицы после from/join/update', /\b(from|join|update|into)\s+\\*"(requests|notifications|announcements|announcement_reads|users|students|sessions|groups|disciplines|lessons)\\*"/i],
  ['.next', /\.next[\\/]/],
  ['node_modules', /node_modules/],
  ['строка стека', /\bat\s+(?:\S+\s+\()?[^\s()<>"]*:\d+:\d+\)?/],
  ['Error:', /Error:/],
  ['postgres', /postgres/i],
]

function expectNoServiceText(body: string, where: string, params: string[]): void {
  const rest = body.replace(/\\*"digest\\*"\s*:\s*\\*"\d+\\*"/g, '').replace(/data-dgst=\\*"\d+\\*"/g, '')
  for (const [name, pattern] of SERVICE_PATTERNS) {
    const found = pattern.exec(rest)
    expect(found, `${where}: служебное «${name}»: ${found ? rest.slice(Math.max(0, found.index - 40), found.index + 80) : ''}`).toBeNull()
  }
  // Параметры запроса к базе: номер пользователя из сессии в ответ не попадает.
  for (const p of params) expect(rest.includes(p), `${where}: в ответе параметр запроса ${p}`).toBe(false)
}

// ---------- Подготовка ----------

const TODAY = todayIn('Europe/Moscow')
const WINDOW = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i))
const PLAN = buildCohortPlan(MAIN_COHORT, TODAY)
/** День из ближайших семи, где у группы студента есть пара с его меткой расписания (как в access.spec.ts, IMP-027). */
function markerDay(student: typeof A): string {
  const lesson = PLAN.lessons
    .filter((l) => l.groupName === student.groupName && WINDOW.includes(l.date) && l.teacher.includes(student.markers.schedule))
    .sort((x, y) => x.date.localeCompare(y.date))[0]
  if (!lesson) throw new Error(`В семи днях у группы ${student.groupName} нет пары с меткой расписания`)
  return lesson.date
}

let server: RunningServer | null = null
let a: Session
let b: Session
let staff: Session
let altStudent: Session
let altStaff: Session
let alt: { studentId: string; requestId: string }
let userIdA = ''
let userIdB = ''
/** Дисциплина Б, на экране которой метка оценок Б («Линейная алгебра»). */
let bDisciplineId = ''
/** Своя дисциплина А с меткой оценок А. */
let aDisciplineId = ''
/** Заявка Б «справка об оплате» из набора: по ней «Подать снова» подставил бы год оплаты Б. */
let bTuitionId = ''
/** Непрочитанное уведомление Б со ссылкой и непрочитанное уведомление А. */
let bUnreadNotification = { id: '', link: '' }
let aUnreadNotification = ''
/** Объявление только для факультета Б (a8, «Олимпиада»): А его не адресовано. */
let bOnlyAnnouncement = ''
let aFresh = ''
let bFresh = ''
let statusAction: CapturedAction
let feedBefore: FeedState
const created: string[] = []

test.beforeAll(async ({ browser }) => {
  feedBefore = await snapshotFeedState([A.login, B.login])
  for (const table of REVOCABLE_TABLES) await restoreRead(table)
  alt = await createAltCohort()
  server = await startServer()
  a = await login(browser, A)
  b = await login(browser, B)
  staff = await login(browser, STAFF)
  altStudent = await login(browser, ALT_STUDENT)
  altStaff = await login(browser, ALT_STAFF)

  const ids = await sql<{ login: string; id: string }>('select login, id from users where login = any($1)', [[A.login, B.login]])
  userIdA = ids.find((r) => r.login === A.login)!.id
  userIdB = ids.find((r) => r.login === B.login)!.id

  for (const [token, marker, set] of [
    [b.token, B.markers.grades, (id: string) => (bDisciplineId = id)],
    [a.token, A.markers.grades, (id: string) => (aDisciplineId = id)],
  ] as const) {
    const list = await raw('/grades?view=all', { token })
    const found = [...new Set([...list.text.matchAll(/href="\/grades\/([0-9a-f-]{36})"/g)].map((m) => m[1]!))]
    for (const id of found) {
      if ((await raw(`/grades/${id}`, { token })).text.includes(marker)) {
        set(id)
        break
      }
    }
  }
  bTuitionId = await requestIdWithMarker(b.token, B.markers.requests)

  const bNote = await sql<{ id: string; link: string }>(
    `select n.id, n.link from notifications n join users u on u.id = n.student_id where u.login = $1 and n.read_at is null and n.link like '/requests/%' order by n.created_at limit 1`,
    [B.login],
  )
  bUnreadNotification = bNote[0] ?? { id: '', link: '' }
  const aNote = await sql<{ id: string }>(
    `select n.id from notifications n join users u on u.id = n.student_id where u.login = $1 and n.read_at is null order by n.created_at limit 1`,
    [A.login],
  )
  aUnreadNotification = aNote[0]?.id ?? ''
  const ann = await sql<{ id: string }>(`select id from announcements where faculty = $1 and group_id is null and title like 'Олимпиада%' limit 1`, [B.faculty])
  bOnlyAnnouncement = ann[0]?.id ?? ''

  aFresh = await submitRequestUi(a.page, 'dean_certificate')
  bFresh = await submitRequestUi(b.page, 'tuition_certificate')
  created.push(aFresh, bFresh)
  statusAction = await captureStatusAction(staff, aFresh, 'В работе')
})

test.afterAll(async () => {
  for (const table of REVOCABLE_TABLES) await restoreRead(table)
  for (const s of [a, b, staff, altStudent, altStaff]) await s?.context.close()
  if (server) await stopServer(server)
  server = null
  await dropAltCohort()
  if (created.length) {
    await sql('delete from notifications where link = any($1)', [created.map((id) => `/requests/${id}`)])
    await sql('delete from requests where id = any($1::uuid[])', [created])
  }
  if (feedBefore) await restoreFeedState(feedBefore, [A.login, B.login])
})

test('контроль: стенд жив, вход А, Б, сотрудника и второго набора работает, номера записей Б найдены', async () => {
  const profile = await raw('/profile', { token: a.token })
  expect(profile.status).toBe(200)
  expect(profile.text).toContain(A.markers.profile)
  expect(bDisciplineId, 'дисциплина Б с меткой не найдена').toMatch(/^[0-9a-f-]{36}$/)
  expect(aDisciplineId, 'дисциплина А с меткой не найдена').toMatch(/^[0-9a-f-]{36}$/)
  expect((await raw(`/grades/${bDisciplineId}`, { token: b.token })).text).toContain(B.markers.grades)
  expect((await raw(`/grades/${aDisciplineId}`, { token: a.token })).text).toContain(A.markers.grades)
  expect(bUnreadNotification.id, 'у Б нет непрочитанного уведомления со ссылкой на заявку').toMatch(/^[0-9a-f-]{36}$/)
  expect(aUnreadNotification, 'у А нет непрочитанного уведомления').toMatch(/^[0-9a-f-]{36}$/)
  expect(bOnlyAnnouncement, 'нет объявления только для факультета Б').toMatch(/^[0-9a-f-]{36}$/)
  // Свой второй набор: сотрудник видит свою заявку, студент — свою.
  expect((await raw('/staff/requests', { token: altStaff.token })).text).toContain(ALT_MARKER)
  expect((await raw(`/requests/${alt.requestId}`, { token: altStudent.token })).status).toBe(200)
  // Своя заявка Б открывает «Подать снова» с годом оплаты Б: иначе проверка ниже пуста.
  const own = await raw(`/requests/new?type=tuition_certificate&from=${bTuitionId}`, { token: b.token })
  expect(own.status).toBe(200)
  expect(own.text).toMatch(/<option[^>]*value="2025"[^>]*selected|<option[^>]*selected[^>]*value="2025"/)
})

// ---------- П-01: новые адреса с номером записи ----------

test.describe('П-01: экран дисциплины, «Подать снова», расписание Б', () => {
  test('А открывает дисциплину Б по номеру: 404, меток Б нет — и в HTML, и в данных RSC', async () => {
    const bMarkers = [...markersOf(B), 'Математический анализ', 'Линейная алгебра', 'Информатика']
    for (const path of [`/grades/${bDisciplineId}`, `/grades/${bDisciplineId.toUpperCase()}`, `/grades/${bDisciplineId}/`, `/grades/${bDisciplineId}?studentId=${userIdB}&group=${encodeURIComponent(B.groupName)}`]) {
      const res = await raw(path, { token: a.token })
      expect([404, 308].includes(res.status), `${path}: код ${res.status}`).toBe(true)
      expectNoMarkers(res.text, bMarkers, path)
    }
    expectNoMarkers((await rawRsc(`/grades/${bDisciplineId}`, a.token)).text, bMarkers, 'RSC дисциплины Б')
  })

  test('А открывает «Подать снова» с номером заявки Б: 404, значения полей Б не подставлены', async () => {
    for (const type of ['tuition_certificate', 'dean_certificate', 'financial_aid']) {
      const path = `/requests/new?type=${type}&from=${bTuitionId}`
      const res = await raw(path, { token: a.token })
      expect(res.status, path).toBe(404)
      expectNoMarkers(res.text, markersOf(B), path)
      expect(res.text, `${path}: подставлен год оплаты Б`).not.toMatch(/value="2025"[^>]*selected|selected[^>]*value="2025"/)
    }
  })

  test('IMP-030: у Б на дне с его парой — его метка и ни одной метки А; у А на том же дне — ни одной метки Б', async () => {
    const dayB = markerDay(B)
    const pageB = await raw(`/schedule?day=${dayB}`, { token: b.token })
    expect(pageB.text).toContain(B.markers.schedule)
    expectNoMarkers(pageB.text, markersOf(A), `Б /schedule?day=${dayB}`)
    const pageA = await raw(encodeURI(`/schedule?day=${dayB}&group=${B.groupName}`), { token: a.token })
    expect(pageA.status).toBe(200)
    expectNoMarkers(pageA.text, markersOf(B), `А /schedule?day=${dayB}`)
    // Неделя целиком — тоже без чужих меток.
    for (const [token, foreign, who] of [[a.token, B, 'А'], [b.token, A, 'Б']] as const) {
      expectNoMarkers((await raw(`/schedule?view=week&day=${dayB}`, { token })).text, markersOf(foreign), `${who} неделя`)
    }
  })
})

test.describe('П-01, П-02: отметка «прочитано» с номером чужой записи', () => {
  test('А отмечает уведомление Б: у Б оно непрочитано, переход не на ссылку Б, метки Б нет', async () => {
    const actionId = await openFeedActionId(a.token)
    expect(await notificationRead(bUnreadNotification.id)).toBe(false)
    const res = await postFeedForm(a.token, actionId, { source: 'notification', id: bUnreadNotification.id, filter: '' })
    expect(res.location ?? '', `код ${res.status}`).not.toContain(bUnreadNotification.link)
    expectNoMarkers(res.text, markersOf(B), 'ответ действия')
    expect(await notificationRead(bUnreadNotification.id), 'уведомление Б отмечено под А').toBe(false)
  })

  test('А отмечает объявление, адресованное только факультету Б: отметки нет', async () => {
    const actionId = await openFeedActionId(a.token)
    await postFeedForm(a.token, actionId, { source: 'announcement', id: bOnlyAnnouncement, filter: '' })
    const rows = await sql('select 1 from announcement_reads where announcement_id = $1 and student_id = $2', [bOnlyAnnouncement, userIdA])
    expect(rows.length, 'отметка чужого объявления записана').toBe(0)
  })

  test('контроль: своё уведомление А той же формой отмечается', async () => {
    const actionId = await openFeedActionId(a.token)
    const res = await postFeedForm(a.token, actionId, { source: 'notification', id: aUnreadNotification, filter: '' })
    expect([303, 307, 302].includes(res.status), `код ${res.status}`).toBe(true)
    expect(await notificationRead(aUnreadNotification)).toBe(true)
  })

  test('сотрудник и вход без куки шлют отметку: отказ, у Б ничего не отмечено', async () => {
    const actionId = await openFeedActionId(b.token)
    for (const token of [staff.token, altStaff.token, undefined, 'x'.repeat(43)]) {
      const res = await postFeedForm(token, actionId, { source: 'notification', id: bUnreadNotification.id, filter: '' })
      expect(isDenied(res) || res.status === 403, `код ${res.status}, адрес ${res.location}`).toBe(true)
    }
    expect(await notificationRead(bUnreadNotification.id)).toBe(false)
  })
})

// ---------- П-05, П-12: полный кабинет сотрудника ----------

test.describe('П-05: роли на полном кабинете сотрудника', () => {
  test('сотрудник на новых адресах студента — 403, метки нет', async () => {
    for (const path of [`/grades/${bDisciplineId}`, `/requests/new?type=tuition_certificate&from=${bTuitionId}`, '/schedule?view=week', '/notifications?filter=news']) {
      for (const token of [staff.token, altStaff.token]) {
        const res = await raw(path, { token })
        expect(res.status, path).toBe(403)
        expectNoMarkers(res.text, markersOf(B), path)
      }
    }
  })

  test('студент на списке и карточке сотрудника своего и чужого набора — 403, имён нет', async () => {
    for (const token of [a.token, altStudent.token]) {
      for (const path of ['/staff/requests', `/staff/requests/${bFresh}`, `/staff/requests/${alt.requestId}`, '/staff/requests?cohort=main']) {
        const res = await raw(path, { token })
        expect(res.status, path).toBe(403)
        expectNoMarkers(res.text, [A.fullName, B.fullName, ALT_MARKER], path)
      }
    }
  })

  test('студент второго набора шлёт смену статуса: отказ, заявка Б «Подана»', async () => {
    const res = await replayWithOrigin(statusAction, altStudent.token, aFresh, bFresh, BASE_URL)
    expect(res.text).not.toContain('Статус сохранён')
    expect(await studentSeesStatus(b.token, bFresh)).toBe('Подана')
  })
})

test.describe('П-12 по HTTP: сотрудник одного набора не видит и не меняет заявок другого', () => {
  test('список и карточка: сотрудник второго набора не видит студентов основного, основной — второго', async () => {
    const altList = await raw('/staff/requests', { token: altStaff.token })
    expect(altList.text).toContain(ALT_MARKER)
    expectNoMarkers(altList.text, [A.fullName, B.fullName, A.groupName, B.groupName], 'список сотрудника второго набора')
    const mainList = await raw('/staff/requests', { token: staff.token })
    expect(mainList.text).toContain(A.fullName)
    expectNoMarkers(mainList.text, [ALT_MARKER, ALT_GROUP], 'список основного сотрудника')
    for (const [token, id, foreign] of [
      [altStaff.token, bFresh, [B.fullName, B.groupName]],
      [altStaff.token, aFresh, [A.fullName, A.groupName]],
      [staff.token, alt.requestId, [ALT_MARKER, ALT_GROUP]],
    ] as const) {
      for (const res of [await raw(`/staff/requests/${id}`, { token }), await rawRsc(`/staff/requests/${id}`, token)]) {
        expect(res.status === 200 && res.text.includes(foreign[0]), `карточка ${id}: чужая заявка открыта`).toBe(false)
        expectNoMarkers(res.text, [...foreign], `карточка ${id}`)
      }
    }
    // Параметры адреса область не меняют.
    const tampered = await raw(`/staff/requests?cohort=main&studentId=${userIdB}`, { token: altStaff.token })
    expectNoMarkers(tampered.text, [A.fullName, B.fullName], 'список с подменой набора')
  })

  test('смена статуса чужой заявки сотрудником другого набора: «Нет такой заявки», статус прежний', async () => {
    const r1 = await replayWithOrigin(statusAction, altStaff.token, aFresh, bFresh, BASE_URL)
    expect(r1.text).toContain('Нет такой заявки')
    expect(r1.text).not.toContain('Статус сохранён')
    expect(await requestStatus(bFresh)).toBe('submitted')
    const r2 = await replayWithOrigin(statusAction, staff.token, aFresh, alt.requestId, BASE_URL)
    expect(r2.text).toContain('Нет такой заявки')
    expect(await requestStatus(alt.requestId)).toBe('submitted')
  })

  test('контроль: сотрудник второго набора меняет статус своей заявки тем же запросом', async () => {
    const res = await replayWithOrigin(statusAction, altStaff.token, aFresh, alt.requestId, BASE_URL)
    expect(res.text).toContain('Статус сохранён')
    expect(await requestStatus(alt.requestId)).toBe('in_progress')
    // Уведомление ушло владельцу заявки второго набора, а не студентам основного.
    const notes = await sql<{ login: string }>(
      `select u.login from notifications n join users u on u.id = n.student_id where n.link = $1`,
      [`/requests/${alt.requestId}`],
    )
    expect(notes.map((n) => n.login)).toEqual([ALT_STUDENT.login])
  })
})

// ---------- П-03, П-07, П-08, П-09 ----------

test.describe('П-03: списки и параметры не возвращают чужого', () => {
  test('список заявок А с номером пользователя Б, поиском по метке Б и большой страницей — только заявки А', async () => {
    const own = await sql<{ n: number }>('select count(*)::int as n from requests where student_id = $1', [userIdA])
    for (const path of [
      `/requests?studentId=${userIdB}`,
      `/requests?userId=${userIdB}&limit=100000&page=0&sort=student_id`,
      encodeURI(`/requests?q=${B.markers.requests}&search=${B.fullName}`),
      `/notifications?studentId=${userIdB}&filter=reminders`,
      `/grades?view=all&studentId=${userIdB}`,
    ]) {
      const res = await raw(path, { token: a.token })
      expect(res.status, path).toBe(200)
      expectNoMarkers(res.text, markersOf(B), path)
    }
    const ids = await myRequestIds(a.token)
    expect(ids.length).toBe(own[0]!.n)
  })
})

test.describe('П-07: в ответах нет лишних полей', () => {
  test('HTML и RSC страниц студента и сотрудника: нет номеров пользователей, хеша, токена, адреса посетителя', async () => {
    const forbidden = [userIdA, userIdB, alt.studentId, 'scrypt$', 'password', 'token_hash', 'passwordHash', '"ip"', 'cohort']
    const student = ['/', '/profile', '/schedule', '/grades?view=all', `/grades/${aDisciplineId}`, '/notifications', '/requests', `/requests/${aFresh}`]
    for (const path of student) {
      for (const res of [await raw(path, { token: a.token }), await rawRsc(path, a.token)]) {
        expect(res.status, path).toBe(200)
        for (const f of forbidden) expect(res.text.includes(f), `${path}: лишнее «${f}»`).toBe(false)
      }
    }
    for (const path of ['/staff/requests', `/staff/requests/${aFresh}`]) {
      for (const res of [await raw(path, { token: staff.token }), await rawRsc(path, staff.token)]) {
        for (const f of forbidden) expect(res.text.includes(f), `${path}: лишнее «${f}»`).toBe(false)
        // Сотрудник не получает оценок и расписания студента: ни дисциплин, ни преподавателей.
        expectNoMarkers(res.text, [A.markers.grades, A.markers.schedule, A.markers.notifications], path)
      }
    }
  })
})

test.describe('П-08: кэш не отдаёт данные одного другому', () => {
  test('20 повторов поочерёдно и залпом: на страницах А нет меток Б, и наоборот', async () => {
    const paths = ['/', '/profile', '/requests', '/notifications']
    let checked = 0
    for (let round = 0; round < 20; round += 1) {
      const batch = paths.flatMap((path) => [
        raw(path, { token: a.token }).then((res) => ({ res, foreign: B, who: 'А', path })),
        raw(path, { token: b.token }).then((res) => ({ res, foreign: A, who: 'Б', path })),
      ])
      for (const { res, foreign, who, path } of await Promise.all(batch)) {
        expect(res.status, `${who} ${path}`).toBe(200)
        expectNoMarkers(res.text, markersOf(foreign), `${who} ${path}, повтор ${round}`)
        checked += 1
      }
    }
    expect(checked).toBe(20 * paths.length * 2)
  })
})

test.describe('П-09: после выхода «Назад» не показывает личного', () => {
  test('профиль, выход, «Назад» в браузере: ФИО А на экране нет', async ({ browser }) => {
    const s = await login(browser, A)
    try {
      await s.page.goto('/profile')
      // С 20.11 (шлифовка) данные студента показаны один раз — в студенческом билете.
      await expect(s.page.getByText(A.fullName)).toBeVisible()
      await s.page.getByRole('button', { name: 'Выйти' }).click()
      await s.page.waitForURL('**/login')
      await s.page.goBack()
      await s.page.waitForLoadState('networkidle')
      await s.page.waitForTimeout(500)
      const text = await s.page.evaluate(() => document.body.innerText)
      expect(text.includes(A.fullName), `после «Назад» на экране ФИО А, адрес ${s.page.url()}`).toBe(false)
      expect(text.includes(A.markers.profile)).toBe(false)
    } finally {
      await s.context.close()
    }
  })
})

// ---------- Н-01, Н-03, Н-04: ввод и вывод ----------

async function expectInert(page: Page, path: string): Promise<void> {
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  const state = await page.evaluate(() => ({
    flag: (window as unknown as { __sec310?: number }).__sec310 ?? null,
    imgs: document.querySelectorAll('img[src="x"]').length,
    svgs: document.querySelectorAll('svg[onload]').length,
    js: document.querySelectorAll('a[href^="javascript:"]').length,
  }))
  expect(dialogs, `${path}: окно dialog`).toEqual([])
  expect(state, `${path}: нагрузка исполнилась или стала разметкой`).toEqual({ flag: null, imgs: 0, svgs: 0, js: 0 })
}

test.describe('Н-01: сохранённый и отражённый текст выводится без исполнения', () => {
  test('ФИО, примечание заявки, заголовок, текст и ссылка уведомления с нагрузкой — на экранах студента и сотрудника', async () => {
    let checked = 0
    for (const path of ['/', '/profile', '/requests', `/requests/${alt.requestId}`, '/notifications']) {
      await expectInert(altStudent.page, path)
      checked += 1
    }
    // Нагрузка видна как текст: значит, она дошла до экрана, а не была отброшена.
    await altStudent.page.goto(`/requests/${alt.requestId}`)
    await expect(altStudent.page.getByText('Примечание <img src=x', { exact: false })).toBeVisible()
    for (const path of ['/staff/requests', `/staff/requests/${alt.requestId}`]) {
      await expectInert(altStaff.page, path)
      checked += 1
    }
    await expect(altStaff.page.getByText(XSS_NAME, { exact: true }).first()).toBeVisible()
    expect(checked).toBe(7)
  })

  test('параметры адреса и поле логина с нагрузкой не исполняются', async ({ browser }) => {
    const p = encodeURIComponent('"><img src=x onerror="window.__sec310=8"><script>window.__sec310=9</script>')
    for (const path of [`/notifications?filter=${p}`, `/schedule?day=${p}&view=${p}`, `/grades?view=${p}`, `/requests/new?type=dean_certificate&limit=${p}`, `/grades/${p}`, `/requests/${p}`]) {
      await expectInert(a.page, path)
    }
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto('/login')
      await page.getByLabel('Логин').fill('<img src=x onerror="window.__sec310=10">')
      await page.getByLabel('Пароль').fill('неверный')
      await page.getByRole('button', { name: 'Войти' }).click()
      await expect(page.getByText('Неверный логин или пароль')).toBeVisible()
      const state = await page.evaluate(() => ({
        flag: (window as unknown as { __sec310?: number }).__sec310 ?? null,
        imgs: document.querySelectorAll('img[src="x"]').length,
      }))
      expect(state).toEqual({ flag: null, imgs: 0 })
    } finally {
      await context.close()
    }
  })
})

test.describe('Н-03, Н-04, Ж-01: подстановка SQL, неверный ввод, ошибки без устройства', () => {
  const LEAKS = ['SELECT', 'postgres', 'node_modules', 'at async', 'syntax error', 'invalid input syntax', 'Error:']

  test('кавычки и SQL в номерах и параметрах — тот же отказ, без 500 и без текста базы', async () => {
    const payloads = ["1' or '1'='1", "'; drop table requests; --", '1e99', '../profile', '00000000-0000-0000-0000-000000000000']
    for (const p of payloads) {
      const e = encodeURIComponent(p)
      for (const path of [`/grades/${e}`, `/requests/new?type=tuition_certificate&from=${e}`, `/schedule?day=${e}`, `/notifications?filter=${e}`, `/grades?view=${e}`]) {
        const res = await raw(path, { token: a.token })
        expect(res.status, `${path}: код`).not.toBe(500)
        for (const leak of LEAKS) expect(res.text, path).not.toContain(leak)
        expectNoMarkers(res.text, markersOf(B), path)
      }
      const staffRes = await raw(`/staff/requests/${e}`, { token: staff.token })
      expect(staffRes.status, `сотрудник ${p}`).toBe(404)
    }
    // Номер записи ленты и источник с подстановкой: ничего не отмечено, без 500.
    const actionId = await openFeedActionId(b.token)
    for (const [source, id] of [['notification', "' or 1=1 --"], ["notification' or '1'='1", bUnreadNotification.id], ['announcement', `${bOnlyAnnouncement}' or '1'='1`]]) {
      const res = await postFeedForm(a.token, actionId, { source: source!, id: id!, filter: "news' --" })
      expect(res.status, `${source} ${id}`).not.toBe(500)
    }
    expect(await notificationRead(bUnreadNotification.id)).toBe(false)
    // Смена статуса с подстановкой в номер: «Нет такой заявки».
    const res = await replayWithOrigin(statusAction, staff.token, aFresh, "' or '1'='1", BASE_URL)
    expect(res.text).not.toContain('Статус сохранён')
    expect(await requestStatus(bFresh)).toBe('submitted')
  })

  test('подача заявки с неверными и длинными полями: заявка не создана, ответ не 500', async () => {
    const before = (await myRequestIds(a.token)).length
    const bad: [string, Record<string, string>][] = [
      ['dean_certificate', { purpose: 'x'.repeat(10_000) }],
      ['dean_certificate', { purpose: "on_demand' --" }],
      ['tuition_certificate', { paymentYear: '1e99' }],
      ['tuition_certificate', { paymentYear: '-1' }],
      ['tuition_certificate', { paymentYear: '2025.5' }],
      ['tuition_certificate', { paymentYear: '2023' }],
    ]
    for (const [kind, extra] of bad) {
      const res = await submitRequestRaw(a.token, kind, extra)
      expect(res.status, `${kind} ${JSON.stringify(extra).slice(0, 60)}`).not.toBe(500)
      const id = createdRequestId(res)
      if (id) created.push(id)
      expect(id, `${kind}: заявка создана с неверным полем`).toBeNull()
    }
    expect((await myRequestIds(a.token)).length).toBe(before)
  })

  test('несуществующий адрес, мусор вместо действия и тело больше предела — без стека и текста ошибки; сервер жив', async () => {
    const cases: [string, Parameters<typeof raw>[1]][] = [
      ['/api/nonexistent', { token: a.token }],
      ['/api/nonexistent', {}],
      ['/notifications', { token: a.token, method: 'POST', headers: { 'next-action': 'deadbeef'.repeat(5), origin: BASE_URL, 'content-type': 'text/plain' }, body: '{"broken json' }],
      ['/notifications', { token: a.token, method: 'POST', headers: { origin: BASE_URL, 'content-type': 'multipart/form-data; boundary=x' }, body: '--x\r\nbroken' }],
      ['/login', { method: 'POST', headers: { origin: BASE_URL, 'content-type': 'application/x-www-form-urlencoded' }, body: `login=${'a'.repeat(3_000_000)}&password=x` }],
    ]
    for (const [path, options] of cases) {
      const res = await raw(path, options)
      for (const leak of LEAKS) expect(res.text, `${options?.method ?? 'GET'} ${path} (${res.status})`).not.toContain(leak)
    }
    expect((await raw('/profile', { token: a.token })).text).toContain(A.markers.profile)
  })
})

// ---------- В-10 и пункт 7 задания: подделка запроса к действиям ----------

test.describe('В-10: подделка запроса к отметке «прочитано» и к смене статуса', () => {
  const FOREIGN_ORIGINS = ['https://evil.example', 'null', 'http://localhost:3100.evil.example', 'http://localhost.evil.example:3100']

  test('отметка с чужим Origin не проходит: уведомление Б непрочитано', async () => {
    const actionId = await openFeedActionId(b.token)
    for (const origin of FOREIGN_ORIGINS) {
      await postFeedForm(b.token, actionId, { source: 'notification', id: bUnreadNotification.id, filter: '' }, origin)
      expect(await notificationRead(bUnreadNotification.id), `Origin ${origin}`).toBe(false)
    }
  })

  test('смена статуса с чужим Origin не проходит: заявка Б «Подана»', async () => {
    for (const origin of FOREIGN_ORIGINS) {
      const res = await replayWithOrigin(statusAction, staff.token, aFresh, bFresh, origin)
      expect(res.text, `Origin ${origin}`).not.toContain('Статус сохранён')
      expect(await requestStatus(bFresh), `Origin ${origin}`).toBe('submitted')
    }
  })

  test('браузер не прикладывает куку сессии к запросу формы с чужого сайта (SameSite=Lax)', async () => {
    // Чужая страница — about:blank с формой на кабинет; запрос перехватывается и обрывается, смотрим, что ушло.
    const page = await b.context.newPage()
    try {
      let cookieHeader: string | null = null
      let sent = false
      await page.route(`${BASE_URL}/**`, async (route) => {
        if (route.request().method() === 'POST') {
          sent = true
          cookieHeader = (await route.request().allHeaders()).cookie ?? ''
          await route.abort()
          return
        }
        await route.continue()
      })
      await page.setContent(
        `<form method="post" action="${BASE_URL}/notifications" enctype="multipart/form-data"><input name="source" value="notification"><input name="id" value="${bUnreadNotification.id}"><button>go</button></form>`,
      )
      await page.click('button')
      const deadline = Date.now() + 5000
      while (!sent && Date.now() < deadline) await page.waitForTimeout(100)
      expect(sent, 'запрос формы не ушёл').toBe(true)
      expect(cookieHeader ?? '', 'кука сессии ушла с чужого сайта').not.toContain('__Host-session')
    } finally {
      await page.close()
    }
    expect(await notificationRead(bUnreadNotification.id)).toBe(false)
  })

  test('R-3.10-1: действие без заголовка Origin с действующей кукой не выполняется — отметка, подача, смена статуса, выход', async ({ browser }) => {
    // Отметка «прочитано»: своё уведомление Б без Origin.
    const actionId = await openFeedActionId(b.token)
    await postFeedForm(b.token, actionId, { source: 'notification', id: bUnreadNotification.id, filter: '' }, null)
    const markedWithoutOrigin = await notificationRead(bUnreadNotification.id)
    // Смена статуса без Origin.
    await replayWithOrigin(statusAction, staff.token, aFresh, bFresh, null)
    const statusWithoutOrigin = await requestStatus(bFresh)
    // Подача заявки без Origin.
    const page = await raw('/requests/new?type=dean_certificate', { token: a.token })
    const form = new FormData()
    form.set(`$ACTION_ID_${formsOf(page.text)[0]!.actionId}`, '')
    form.set('kind', 'dean_certificate')
    const sub = await raw('/requests/new?type=dean_certificate', { token: a.token, method: 'POST', body: form })
    const createdId = createdRequestId(sub)
    if (createdId) created.push(createdId)
    // Выход без Origin: отдельная сессия А.
    const s = await login(browser, A)
    const profile = await raw('/profile', { token: s.token })
    const logoutForm = formsOf(profile.text).find((f) => f.html.includes('Выйти'))
    const out = new FormData()
    out.set(`$ACTION_ID_${logoutForm!.actionId}`, '')
    await raw('/profile', { token: s.token, method: 'POST', body: out })
    const sessionAlive = (await raw('/profile', { token: s.token })).status === 200
    await s.context.close()
    expect({ markedWithoutOrigin, statusWithoutOrigin, created: createdId !== null, sessionAlive }).toEqual({
      markedWithoutOrigin: false,
      statusWithoutOrigin: 'submitted',
      created: false,
      sessionAlive: true,
    })
  })

  test('R-3.10-9: Origin «null» и мусор — 403 от посредника, а не 500 от Next.js; действие не выполняется', async () => {
    const actionId = await openFeedActionId(b.token)
    for (const origin of ['null', 'garbage']) {
      const mark = await postFeedForm(b.token, actionId, { source: 'notification', id: bUnreadNotification.id, filter: '' }, origin)
      expect(mark.status, `отметка, Origin ${origin}`).toBe(403)
      const status = await replayWithOrigin(statusAction, staff.token, aFresh, bFresh, origin)
      expect(status.status, `смена статуса, Origin ${origin}`).toBe(403)
    }
    expect(await notificationRead(bUnreadNotification.id)).toBe(false)
    expect(await requestStatus(bFresh)).toBe('submitted')
  })
})

// ---------- Пункт 5 задания: экраны ошибки и действия при отказе базы ----------

test.describe('Ж-01 при отказе базы: в ответ не уходят текст ошибки, стек, запрос и его параметры', () => {
  test('карточка заявки сотрудника, «Подать снова», смена статуса — при отказе таблицы requests', async () => {
    try {
      await revokeRead('requests')
      for (const [path, token] of [[`/staff/requests/${aFresh}`, staff.token], [`/requests/new?type=dean_certificate&from=${aFresh}`, a.token], [`/requests/${aFresh}`, a.token]] as const) {
        const html = await raw(path, { token })
        expect(html.status, `${path}: при отказе базы`).toBeGreaterThanOrEqual(200)
        expectNoServiceText(html.text, `${path} HTML (${html.status})`, [userIdA])
        expectNoServiceText((await rawRsc(path, token)).text, `${path} RSC`, [userIdA])
      }
      const action = await replayWithOrigin(statusAction, staff.token, aFresh, aFresh, BASE_URL)
      expectNoServiceText(action.text, `смена статуса (${action.status})`, [userIdA])
      expect(action.text).not.toContain('Статус сохранён')
    } finally {
      await restoreRead('requests')
    }
    expect(await appCanRead('requests')).toBe(true)
  })

  test('отметка «прочитано» и экран дисциплины — при отказе таблиц notifications и disciplines', async () => {
    const actionId = await openFeedActionId(b.token)
    try {
      await revokeRead('notifications')
      const res = await postFeedForm(b.token, actionId, { source: 'notification', id: bUnreadNotification.id, filter: '' })
      expectNoServiceText(res.text, `отметка, форма (${res.status})`, [userIdB])
      const page = await raw('/notifications', { token: b.token })
      expectNoServiceText(page.text, `лента (${page.status})`, [userIdB])
    } finally {
      await restoreRead('notifications')
    }
    try {
      await revokeRead('disciplines')
      const res = await raw(`/grades/${bDisciplineId}`, { token: b.token })
      // Номер дисциплины стоит в самом адресе страницы и в данных маршрута — это не утечка; проверяется номер пользователя.
      expectNoServiceText(res.text, `дисциплина (${res.status})`, [userIdB])
    } finally {
      await restoreRead('disciplines')
    }
    for (const table of REVOCABLE_TABLES) expect(await appCanRead(table), table).toBe(true)
  })
})

// ---------- Известные замечания: подтверждение (R-3.3-3, R-3.5-4, R-3.5-5) и новое R-3.10-2 ----------

test.describe('известные замечания — живы ли', () => {
  test('контроль: журнал событий сервера собирается, отказ по чужой заявке пишет access_denied_record', async () => {
    const before = server!.output().split('access_denied_record').length
    await raw(`/requests/${bFresh}`, { token: a.token })
    await expect.poll(() => server!.output().split('access_denied_record').length).toBeGreaterThan(before)
  })

  test('R-3.3-3: адрес с битой процентной кодировкой — «не найдено», а не 500', async () => {
    for (const [path, token] of [['/grades/%E0%A4%A', a.token], ['/requests/%E0%A4%A', a.token], ['/staff/requests/%E0%A4%A', staff.token], ['/grades/%', undefined]] as const) {
      const res = await raw(path, { token })
      expect(res.status, path).toBe(404)
    }
  })

  test('R-3.5-4: ссылка уведомления со знаком U+2028 — переход на ленту, а не 500', async () => {
    const [row] = await sql<{ id: string }>(
      `insert into notifications (student_id, kind, title, body, link) values ($1, 'reminder', 'SEC310 U+2028', 'проверка', $2) returning id`,
      [userIdA, '/requests/\u2028x'],
    )
    try {
      const res = await postFeedForm(a.token, await openFeedActionId(a.token), { source: 'notification', id: row!.id, filter: '' })
      expect(res.status).not.toBe(500)
      // Переход — на ленту, а не по непригодной ссылке (R-3.10-5, ревью RV-В5-1).
      expect(res.location ?? '', `код ${res.status}`).toMatch(/^(https?:\/\/[^/]+)?\/notifications(\?|$)/)
    } finally {
      await sql('delete from notifications where id = $1', [row!.id])
    }
  })

  test('R-3.5-5: отметка с номером чужой записи пишет access_denied_record', async () => {
    const count = () => server!.output().split('\n').filter((l) => l.includes('access_denied_record') && l.includes(userIdA)).length
    const before = count()
    await postFeedForm(a.token, await openFeedActionId(a.token), { source: 'notification', id: bUnreadNotification.id, filter: '' })
    await new Promise((r) => setTimeout(r, 500))
    expect(count()).toBeGreaterThan(before)
  })

  test('R-3.10-2: смена статуса с номером заявки другого набора пишет access_denied_record', async () => {
    const [row] = await sql<{ id: string }>('select id from users where login = $1', [ALT_STAFF.login])
    const count = () => server!.output().split('\n').filter((l) => l.includes('access_denied_record') && l.includes(row!.id)).length
    const before = count()
    await replayWithOrigin(statusAction, altStaff.token, aFresh, bFresh, BASE_URL)
    await new Promise((r) => setTimeout(r, 500))
    expect(count()).toBeGreaterThan(before)
  })
})
