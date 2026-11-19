// Атакующие тесты пакета 2.6 по HTTP на собранном приложении: чужие данные, роли, вход, сессия, кука.
// Проверки — R-1.5, раздел 4; таблица «когда» — ADR-0005. Доказательство — чужая метка в ответе, а не код ответа.
// Студент А и Б, сотрудник — основной набор (app/db/seed-data.ts). Тест сам поднимает и гасит сервер на порту 3100.
import { expect, test } from '@playwright/test'
import { MAIN_COHORT } from '../../db/seed-data'
import { buildCohortPlan } from '../../db/seed-plan'
import { addDays, todayIn } from '../../src/lib/dates'
import { BASE_URL, startServer, stopServer, type RunningServer } from '../e2e/helpers/server'
import {
  A,
  B,
  COOKIE,
  STAFF,
  captureStatusAction,
  createdRequestId,
  isDenied,
  login,
  markersOf,
  myRequestIds,
  randomId,
  raw,
  rawRsc,
  replayStatusAction,
  requestIdWithMarker,
  studentSeesStatus,
  submitReadyCertificateRaw,
  submitRequestRaw,
  submitRequestUi,
  type CapturedAction,
  type Session,
} from './helpers'

test.describe.configure({ mode: 'serial' })

let server: RunningServer | null = null
let a: Session
let b: Session
let staff: Session
/** Заявка Б из вымышленных данных: на её странице метка Б. */
let bSeedId = ''
/** Свежая заявка Б со статусом «Подана»: по ней пробуем смену статуса. */
let bFreshId = ''
/** Свежая заявка А со статусом «Подана». */
let aFreshId = ''
/** Настоящий запрос «сменить статус», перехваченный у сотрудника и оборванный. */
let statusAction: CapturedAction

const STUDENT_PAGES = ['/', '/profile', '/schedule', '/grades', '/notifications', '/requests', '/requests/new?type=dean_certificate']
const STAFF_PAGES = ['/staff/requests']
const NOT_SAVED = 'Статус сохранён'

// Пары набора с пакета 3.8 зависят от дня недели и от верхней или нижней недели: метка A.markers.schedule есть не в каждом дне.
// С 14.11.2026 до пакета 3.2 «своим на странице» был преподаватель первой сегодняшней пары или строка пустого дня — R-3.8-15.
const TODAY = todayIn('Europe/Moscow')
//
// IMP-027, 14.11.2026, смена 21: пакет 3.2 дал расписанию семь дней и параметр адреса `day`. Метка A.markers.schedule возвращена.
// В виде «Неделя» преподавателя нет — так велит задание B-3.2, — поэтому берётся вид «День» ближайшего из семи дней, где по плану
// набора у группы А есть пара с этой меткой. Такой день есть при любом дне запуска: проверка подмены группы больше не пуста по выходным.
const SCHEDULE_WINDOW = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i))
const markerLessonA = buildCohortPlan(MAIN_COHORT, TODAY)
  .lessons.filter((l) => l.groupName === A.groupName && SCHEDULE_WINDOW.includes(l.date) && l.teacher.includes(A.markers.schedule))
  .sort((x, y) => x.date.localeCompare(y.date))[0]
if (!markerLessonA) throw new Error('В семи днях от сегодня у группы А нет пары с меткой расписания: проверь набор данных')
const OWN_SCHEDULE_PATH = `/schedule?day=${markerLessonA.date}`

function expectNoMarkers(text: string, markers: string[], where: string): void {
  for (const m of markers) expect(text.includes(m), `${where}: найдена чужая метка «${m}»`).toBe(false)
}

test.beforeAll(async ({ browser }) => {
  server = await startServer()
  a = await login(browser, A)
  b = await login(browser, B)
  staff = await login(browser, STAFF)
  bSeedId = await requestIdWithMarker(b.token, B.markers.requests)
  bFreshId = await submitRequestUi(b.page, 'tuition_certificate')
  aFreshId = await submitRequestUi(a.page, 'dean_certificate')
  statusAction = await captureStatusAction(staff, bFreshId, 'В работе')
})

test.afterAll(async () => {
  for (const s of [a, b, staff]) await s?.context.close()
  if (server) await stopServer(server)
  server = null
})

test('контроль: стенд жив, вход под А работает, свои метки А видны', async () => {
  const pages: Record<string, string> = {
    '/profile': A.markers.profile,
    [OWN_SCHEDULE_PATH]: A.markers.schedule,
    '/grades': A.markers.grades,
    '/notifications': A.markers.notifications,
  }
  for (const [path, marker] of Object.entries(pages)) {
    const res = await raw(path, { token: a.token })
    expect(res.status, path).toBe(200)
    expect(res.text, path).toContain(marker)
  }
  const own = await requestIdWithMarker(a.token, A.markers.requests)
  expect(own).toMatch(/^[0-9a-f-]{36}$/)
  // Запрос данных RSC работает: в своей заявке метка А есть. Иначе проверки RSC ниже были бы пустыми.
  const rsc = await rawRsc(`/requests/${own}`, a.token)
  expect(rsc.text).toContain(A.markers.requests)
  expect(bSeedId).toMatch(/^[0-9a-f-]{36}$/)
  expect(await studentSeesStatus(b.token, bFreshId)).toBe('Подана')
})

test('контроль: перехваченный запрос смены статуса принимается сервером под сотрудником', async () => {
  // Номер подменён на несуществующий: действие отработало и ответило «нет такой заявки», заявка Б не тронута.
  const res = await replayStatusAction(statusAction, staff.token, bFreshId, randomId())
  expect(res.status).toBe(200)
  expect(res.text).toContain('Нет такой заявки')
  expect(await studentSeesStatus(b.token, bFreshId)).toBe('Подана')
})

test.describe('П-01: чужая запись по номеру в адресе', () => {
  test('А открывает заявку Б по номеру: отказ, метки Б нет', async () => {
    const variants = [
      `/requests/${bSeedId}`,
      `/requests/${bSeedId.toUpperCase()}`,
      `/requests/${bSeedId}/`,
      `/requests/${encodeURIComponent(bSeedId)}?studentId=${bSeedId}`,
      `/requests/${bFreshId}`,
    ]
    for (const path of variants) {
      const res = await raw(path, { token: a.token })
      expect(res.status === 200, `${path}: код ${res.status}`).toBe(false)
      expectNoMarkers(res.text, markersOf(B), path)
    }
  })

  test('данные страницы для клиента (RSC) по номеру заявки Б — без метки Б', async () => {
    const res = await rawRsc(`/requests/${bSeedId}`, a.token)
    expectNoMarkers(res.text, markersOf(B), 'RSC')
  })

  test('угаданный, случайный и испорченный номер — тот же ответ, без ошибки базы', async () => {
    const reference = await raw(`/requests/${bSeedId}`, { token: a.token })
    for (const id of [randomId(), 'abc', '1e99', "1' or '1'='1", '..%2F..%2Fprofile', '00000000-0000-0000-0000-000000000000']) {
      const res = await raw(`/requests/${id}`, { token: a.token })
      expect(res.status, id).toBe(reference.status)
      for (const leak of ['SELECT', 'postgres', 'node_modules', 'at async']) expect(res.text, id).not.toContain(leak)
    }
  })

  test('страницы А с подставленными параметрами Б не отдают данных Б (R-2.3-14: группа из профиля)', async () => {
    const tampered = [
      '/profile?studentId=x&userId=x',
      `/schedule?group=${B.groupName}&groupId=x&studentId=x`,
      `/grades?view=all&studentId=x&group=${B.groupName}`,
      '/notifications?studentId=x',
      `/requests?studentId=x&limit=1000&page=2`,
    ]
    for (const path of tampered) {
      const res = await raw(encodeURI(path), { token: a.token })
      expect(res.status, path).toBe(200)
      expectNoMarkers(res.text, markersOf(B), path)
    }
    const schedule = await raw(encodeURI(`${OWN_SCHEDULE_PATH}&group=${B.groupName}`), { token: a.token })
    expect(schedule.text).toContain(A.markers.schedule)
    expectNoMarkers(schedule.text, markersOf(B), 'расписание с подменой группы')
  })

  test('ни одна страница А не содержит меток Б, и наоборот', async () => {
    for (const path of STUDENT_PAGES) {
      expectNoMarkers((await raw(path, { token: a.token })).text, markersOf(B), `А ${path}`)
      expectNoMarkers((await raw(path, { token: b.token })).text, markersOf(A), `Б ${path}`)
    }
  })
})

test.describe('П-02: чужая запись через серверное действие', () => {
  test('А повторяет запрос «сменить статус» с номером заявки Б: отказ, у Б заявка не изменилась', async () => {
    const res = await replayStatusAction(statusAction, a.token, bFreshId, bFreshId)
    expect(res.status === 200, `код ${res.status}`).toBe(false)
    expect(res.text).not.toContain(NOT_SAVED)
    expectNoMarkers(res.text, markersOf(B), 'ответ действия')
    expect(await studentSeesStatus(b.token, bFreshId)).toBe('Подана')
  })

  test('А шлёт на адрес заявки Б запросы изменения и удаления: заявка Б цела, метки нет', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await raw(`/requests/${bSeedId}`, { token: a.token, method, body: method === 'DELETE' ? undefined : 'status=issued' })
      expect(res.status === 200, `${method}: код ${res.status}`).toBe(false)
      expectNoMarkers(res.text, markersOf(B), method)
    }
    expect(await myRequestIds(b.token)).toContain(bSeedId)
    expect(await studentSeesStatus(b.token, bFreshId)).toBe('Подана')
  })
})

test.describe('П-04: владелец берётся из сессии, а не из тела', () => {
  test('лишние поля studentId, userId, role, status в теле новой заявки не принимаются', async () => {
    const marker = `МЕТКА-П04-${randomId().slice(0, 8)}`
    const res = await submitRequestRaw(a.token, 'dean_certificate', {
      studentId: bSeedId,
      userId: bSeedId,
      ownerId: bSeedId,
      student_id: bSeedId,
      role: 'staff',
      isAdmin: 'true',
      status: 'ready',
      note: marker,
      cohort: 'test-alt',
    })
    const id = createdRequestId(res)
    expect(id, `код ${res.status}`).not.toBeNull()
    // Заявка — у А, статус «Подана», примечание из тела не записано.
    const mine = await raw(`/requests/${id}`, { token: a.token })
    expect(mine.status).toBe(200)
    expect(await studentSeesStatus(a.token, id!)).toBe('Подана')
    expect(mine.text).not.toContain(marker)
    // У Б этой заявки нет.
    expect(await myRequestIds(b.token)).not.toContain(id)
    expect((await raw(`/requests/${id}`, { token: b.token })).status).toBe(404)
    // Роль А не изменилась: адреса сотрудника — отказ.
    expect((await raw('/staff/requests', { token: a.token })).status).toBe(403)
    // Сотрудник видит заявку как заявку А.
    const staffView = await raw(`/staff/requests/${id}`, { token: staff.token })
    expect(staffView.text).toContain(A.fullName)
  })
})

test.describe('П-04: «Получить сразу» тоже берёт владельца из сессии', () => {
  test('лишние поля в теле не принимаются: справка у А, статус «Выдана», у Б её нет, чужой номер печатной страницы — отказ', async () => {
    const res = await submitReadyCertificateRaw(a.token, {
      studentId: bSeedId,
      userId: bSeedId,
      role: 'staff',
      status: 'submitted',
      purpose: 'military',
      kind: 'financial_aid',
      cohort: 'test-alt',
    })
    const id = createdRequestId(res)
    expect(id, `код ${res.status}`).not.toBeNull()
    expect(res.location ?? res.headers.get('x-action-redirect')).toContain(`/requests/${id}/certificate`)
    expect(await studentSeesStatus(a.token, id!)).toBe('Выдана')
    expect(await myRequestIds(a.token)).toContain(id)
    expect(await myRequestIds(b.token)).not.toContain(id)
    expect((await raw(`/requests/${id}`, { token: b.token })).status).toBe(404)
    expect((await raw(`/requests/${id}/certificate`, { token: b.token })).status).toBe(404)
    expect((await raw(`/requests/${id}/certificate`, { token: staff.token })).status).toBe(403)
    // Вид и назначение — свои, а не из тела: справка об обучении, «по месту требования».
    const staffView = await raw(`/staff/requests/${id}`, { token: staff.token })
    expect(staffView.text).toContain(A.fullName)
    expect(staffView.text).toContain('Справка из деканата')
    expect(staffView.text).not.toContain('материальную помощь')
  })
})

test.describe('П-05: роли — студент не делает действий сотрудника, сотрудник — студента', () => {
  test('студент на адресах сотрудника получает 403, а не пустой ответ 200', async () => {
    for (const path of [...STAFF_PAGES, `/staff/requests/${bSeedId}`, `/staff/requests/${aFreshId}`]) {
      const res = await raw(path, { token: a.token })
      expect(res.status, path).toBe(403)
      expectNoMarkers(res.text, [...markersOf(B), B.fullName], path)
    }
  })

  test('студент не меняет статус своей заявки действием сотрудника', async () => {
    const res = await replayStatusAction(statusAction, a.token, bFreshId, aFreshId)
    expect(res.status === 200, `код ${res.status}`).toBe(false)
    expect(res.text).not.toContain(NOT_SAVED)
    expect(await studentSeesStatus(a.token, aFreshId)).toBe('Подана')
  })

  test('сотрудник на адресах студента получает 403', async () => {
    for (const path of [...STUDENT_PAGES.filter((p) => p !== '/'), `/requests/${bSeedId}`]) {
      const res = await raw(path, { token: staff.token })
      expect(res.status, path).toBe(403)
      expectNoMarkers(res.text, markersOf(B), path)
    }
    // Главная для сотрудника — перенаправление в его кабинет.
    const home = await raw('/', { token: staff.token })
    expect(home.location ?? '').toContain('/staff/requests')
  })

  test('сотрудник не подаёт заявку от имени студента', async () => {
    const before = (await raw('/staff/requests', { token: staff.token })).text.match(/href="\/staff\/requests\//g)?.length ?? 0
    // Форма подачи сотруднику не отдаётся, поэтому идентификатор действия берётся из страницы студента.
    const page = await raw('/requests/new?type=dean_certificate', { token: a.token })
    const actionId = page.text.match(/name="\$ACTION_ID_([0-9a-f]+)"/)?.[1]
    expect(actionId).toBeTruthy()
    const form = new FormData()
    form.set(`$ACTION_ID_${actionId}`, '')
    form.set('kind', 'dean_certificate')
    const res = await raw('/requests/new?type=dean_certificate', { token: staff.token, method: 'POST', headers: { origin: BASE_URL }, body: form })
    expect(createdRequestId(res)).toBeNull()
    const after = (await raw('/staff/requests', { token: staff.token })).text.match(/href="\/staff\/requests\//g)?.length ?? 0
    expect(after).toBe(before)
  })
})

test.describe('П-06: без входа данных нет', () => {
  const protectedPaths = () => [
    ...STUDENT_PAGES,
    ...STAFF_PAGES,
    `/requests/${bSeedId}`,
    `/staff/requests/${bSeedId}`,
  ]
  const allMarkers = () => [...markersOf(A), ...markersOf(B)]

  test('без куки — перенаправление на вход, данных нет', async () => {
    for (const path of protectedPaths()) {
      const res = await raw(path)
      expect(isDenied(res), `${path}: код ${res.status}, адрес ${res.location}`).toBe(true)
      expectNoMarkers(res.text, allMarkers(), path)
    }
  })

  test('с недействительной кукой — то же', async () => {
    // Выдуманная, пустая, слишком длинная и «почти настоящая» кука (последний знак токена А заменён).
    const fakes = ['x'.repeat(43), '', 'a'.repeat(129), `${a.token.slice(0, -1)}${a.token.endsWith('A') ? 'B' : 'A'}`]
    for (const fake of fakes) {
      for (const path of ['/profile', '/requests', `/requests/${bSeedId}`, '/staff/requests']) {
        const res = await raw(path, { token: fake })
        expect(isDenied(res), `${path} с куки «${fake.slice(0, 6)}…»: код ${res.status}`).toBe(true)
        expectNoMarkers(res.text, allMarkers(), path)
      }
    }
  })

  test('с заголовком x-middleware-subrequest — то же', async () => {
    for (const value of ['middleware', 'src/middleware', 'middleware:middleware:middleware:middleware:middleware', 'src/proxy:proxy:proxy:proxy:proxy']) {
      for (const path of protectedPaths()) {
        const res = await raw(path, { headers: { 'x-middleware-subrequest': value } })
        expect(isDenied(res), `${path} [${value}]: код ${res.status}`).toBe(true)
        expectNoMarkers(res.text, allMarkers(), path)
      }
    }
  })

  test('данные для клиента (RSC) без куки — без меток', async () => {
    for (const path of ['/profile', '/requests', `/requests/${bSeedId}`]) {
      const res = await rawRsc(path)
      expectNoMarkers(res.text, allMarkers(), `RSC ${path}`)
    }
  })

  test('серверные действия без куки и с выдуманной кукой ничего не меняют', async () => {
    for (const token of [undefined, 'x'.repeat(43)]) {
      const res = await replayStatusAction(statusAction, token, bFreshId, bFreshId)
      expect(res.text).not.toContain(NOT_SAVED)
    }
    expect(await studentSeesStatus(b.token, bFreshId)).toBe('Подана')
    // Подача заявки без входа: идентификатор действия взят из страницы А, кука не передаётся.
    const before = (await myRequestIds(a.token)).length
    const page = await raw('/requests/new?type=dean_certificate', { token: a.token })
    const actionId = page.text.match(/name="\$ACTION_ID_([0-9a-f]+)"/)?.[1]
    expect(actionId).toBeTruthy()
    const form = new FormData()
    form.set(`$ACTION_ID_${actionId}`, '')
    form.set('kind', 'dean_certificate')
    const res = await raw('/requests/new?type=dean_certificate', { method: 'POST', headers: { origin: BASE_URL }, body: form })
    expect(createdRequestId(res)).toBeNull()
    expect((await myRequestIds(a.token)).length).toBe(before)
  })
})

test.describe('В-06, В-07, R-2.3-26, R-2.3-33: кука, выход, заявки после выхода', () => {
  test('кука сессии: __Host-, HttpOnly, Secure, SameSite=Lax, Path=/, без Domain, срок не больше 7 суток', async () => {
    expect(a.setCookie, 'ответ на вход без Set-Cookie').not.toBeNull()
    const header = a.setCookie!
    expect(header.startsWith(`${COOKIE}=`)).toBe(true)
    expect(header).toMatch(/;\s*HttpOnly/i)
    expect(header).toMatch(/;\s*Secure/i)
    expect(header).toMatch(/;\s*SameSite=Lax/i)
    expect(header).toMatch(/;\s*Path=\/(;|$)/i)
    expect(header).not.toMatch(/;\s*Domain=/i)
    const cookie = (await a.context.cookies()).find((c) => c.name === COOKIE)!
    const days = (cookie.expires * 1000 - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThanOrEqual(7.01)
    // Скрипт страницы куку не читает.
    const visible = await a.page.evaluate(() => document.cookie)
    expect(visible).not.toContain(COOKIE)
  })

  test('движок сквозных тестов — Chromium (R-2.3-33)', async () => {
    expect(test.info().project.use.browserName).toBe('chromium')
  })

  test('выход гасит сессию на сервере: старая кука больше не пускает; заявки студента целы', async ({ browser }) => {
    const second = await login(browser, A)
    const oldToken = second.token
    await second.page.goto('/profile')
    await second.page.getByRole('button', { name: 'Выйти' }).click()
    await second.page.waitForURL('**/login')
    for (const path of ['/profile', '/requests', `/requests/${aFreshId}`]) {
      const res = await raw(path, { token: oldToken })
      expect(isDenied(res), `${path} после выхода: код ${res.status}`).toBe(true)
      expectNoMarkers(res.text, markersOf(A), path)
    }
    await second.context.close()
    // R-2.3-26: выход удаляет сессию, но не заявки. Под другой живой сессией А заявка на месте.
    expect(await myRequestIds(a.token)).toContain(aFreshId)
    expect(await studentSeesStatus(a.token, aFreshId)).toBe('Подана')
  })
})

test.describe('В-10 (частично, полностью — пакет 3.1): подделка запроса с чужого сайта', () => {
  test('подача заявки с Origin чужого сайта не проходит', async () => {
    const before = (await myRequestIds(a.token)).length
    for (const origin of ['https://evil.example', 'null', `https://localhost.evil.example`]) {
      const res = await submitRequestRaw(a.token, 'dean_certificate', {}, { origin })
      expect(createdRequestId(res), `Origin ${origin}: код ${res.status}`).toBeNull()
    }
    expect((await myRequestIds(a.token)).length).toBe(before)
  })
})
