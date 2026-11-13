// Атакующие тесты пакета 2.6 на слое доступа и базе (Vitest, тестовая база с именем на _test).
// Проверки: В-01, П-06 (просроченная сессия), П-10, П-12, Т-02, ПР-1; дополнения аудита R-2.3-25, R-2.3-26,
// R-2.3-28, R-2.3-34. Действующее лицо получаем только настоящим входом: actorFor из tests/unit/helpers.ts.
import { createHash, scrypt } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { authenticate } from '@/server/auth/login'
import { Actor, destroySession, resolveActor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { ALT_COHORT, ALT_STUDENT, STAFF_ALT, STAFF_MAIN, STUDENT_A, STUDENT_B } from '../unit/fixtures'
import { actorFor, withOwner } from '../unit/helpers'

let a: Actor
let b: Actor
let altStudent: Actor
let staff: Actor
let altStaff: Actor

beforeAll(async () => {
  a = await actorFor(STUDENT_A)
  b = await actorFor(STUDENT_B)
  altStudent = await actorFor(ALT_STUDENT)
  staff = await actorFor(STAFF_MAIN)
  altStaff = await actorFor(STAFF_ALT)
})
afterAll(closeDb)

async function newRequest(owner: Actor, kind: 'dean_certificate' | 'tuition_certificate' | 'financial_aid' = 'dean_certificate') {
  const created = await studentDal.createMyRequest(owner, { kind }, 'test')
  if (!created) throw new Error('заявка не создана')
  return created.id
}

async function statusOf(owner: Actor, id: string): Promise<string | undefined> {
  return (await studentDal.getMyRequest(owner, id))?.status
}

function scryptAsync(password: string, salt: Buffer, keylen: number, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, { N, r, p, maxmem: 512 * 1024 * 1024 }, (e, d) => (e ? reject(e) : resolve(d))),
  )
}

// ---------- В-01 ----------

/** Допустимые наборы scrypt из R-1.5, таблица F13: (N, p) при r = 8. Набор допустим, если N и p не меньше одной строки. */
const SCRYPT_ROWS: [number, number][] = [
  [2 ** 17, 1],
  [2 ** 16, 2],
  [2 ** 15, 3],
  [2 ** 14, 5],
  [2 ** 13, 10],
]

/** Свой разбор строки хеша — независимо от кода продукта. */
function parse(stored: string) {
  const [alg, params, salt, hash] = stored.split('$')
  const map = Object.fromEntries((params ?? '').split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)]))
  return { alg, N: map.N ?? 0, r: map.r ?? 0, p: map.p ?? 0, salt: Buffer.from(salt ?? '', 'base64url'), hash: Buffer.from(hash ?? '', 'base64url') }
}

describe('В-01: пароль в базе — хеш стойкого алгоритма', () => {
  const known = new Map<string, string>(
    [MAIN_COHORT, ALT_COHORT].flatMap((c) => [c.staff, ...c.students]).map((acc) => [acc.login, acc.password]),
  )

  it('у каждой учётной записи — scrypt с параметрами не ниже строки таблицы F13 и своей солью; открытого пароля нет', async () => {
    const rows = await withOwner((c) => c.query('select * from users'))
    expect(rows.rowCount).toBeGreaterThanOrEqual(known.size)
    const salts = new Set<string>()
    for (const row of rows.rows as Record<string, unknown>[]) {
      const stored = String(row.password_hash)
      const h = parse(stored)
      expect(h.alg, String(row.login)).toBe('scrypt')
      expect(h.r, 'r не ниже 8').toBeGreaterThanOrEqual(8)
      expect(SCRYPT_ROWS.some(([n, p]) => h.N >= n && h.p >= p), `N=${h.N}, p=${h.p}`).toBe(true)
      expect(h.salt.length).toBeGreaterThanOrEqual(16)
      expect(h.hash.length).toBeGreaterThanOrEqual(32)
      salts.add(h.salt.toString('hex'))
      // Открытого пароля нет ни в одном поле строки.
      const password = known.get(String(row.login))
      if (password) expect(Object.values(row).map(String).join('|')).not.toContain(password)
    }
    expect(salts.size, 'одна соль на несколько паролей').toBe(rows.rowCount)
  })

  it('строка хеша — действительно scrypt пароля с записанными параметрами, а не надпись', async () => {
    const rows = await withOwner((c) => c.query('select password_hash from users where login = $1', [STUDENT_B.login]))
    const h = parse(String(rows.rows[0]?.password_hash))
    const derived = await scryptAsync(STUDENT_B.password.normalize('NFKC'), h.salt, h.hash.length, h.N, h.r, h.p)
    expect(derived.equals(h.hash)).toBe(true)
  })

  it('в таблице сессий нет ни пароля, ни токена в открытом виде', async () => {
    const outcome = await authenticate(STUDENT_A.login, STUDENT_A.password, 'test')
    if (!outcome.ok) throw new Error('вход не удался')
    const rows = await withOwner((c) => c.query('select * from sessions'))
    const dump = JSON.stringify(rows.rows)
    expect(dump).not.toContain(STUDENT_A.password)
    expect(dump).not.toContain(outcome.token)
  })
})

// ---------- П-06: просроченная сессия ----------

describe('П-06: просроченная сессия не пускает', () => {
  it('сессия со сроком в прошлом — не действующее лицо', async () => {
    const outcome = await authenticate(STUDENT_A.login, STUDENT_A.password, 'test')
    if (!outcome.ok) throw new Error('вход не удался')
    expect(await resolveActor(outcome.token)).not.toBeNull()
    const tokenHash = createHash('sha256').update(outcome.token).digest('hex')
    await withOwner((c) => c.query(`update sessions set expires_at = now() - interval '1 second' where token_hash = $1`, [tokenHash]))
    expect(await resolveActor(outcome.token)).toBeNull()
  })
})

// ---------- R-2.3-25, R-2.3-28: действующее лицо нельзя собрать руками ----------

describe('R-2.3-25, R-2.3-28: функцию слоя нельзя вызвать с самодельным действующим лицом', () => {
  it('контроль: настоящее лицо А получает свой профиль', async () => {
    expect((await studentDal.getMyProfile(a))?.fullName).toBe(STUDENT_A.fullName)
  })

  it('объект той же формы без прототипа не проходит', async () => {
    const forged = { userId: b.userId, role: 'student', cohort: 'main', groupId: b.groupId }
    await expect(studentDal.getMyProfile(forged as unknown as Actor)).rejects.toBeInstanceOf(ForbiddenError)
  })

  // Находка R-2.6-2: на день аудита, 12.11.2026, проверка isActor была instanceof. Объект с прототипом Actor,
  // собранный без конструктора, её проходил: ниже А «становился» Б без пароля Б. Исправлено в тот же день:
  // isActor сверяет закрытое поле #sealed. Пометка «ожидаемо падает» снята, тесты остались как проверка.
  test('R-2.6-2: объект, собранный через Object.create(Actor.prototype), не проходит проверку роли', async () => {
    const forged: Actor = Object.create(Actor.prototype)
    Object.assign(forged, { userId: b.userId, role: 'student', cohort: 'main', groupId: b.groupId })
    let profile: unknown = null
    let error: unknown = null
    try {
      profile = await studentDal.getMyProfile(forged)
    } catch (e) {
      error = e
    }
    expect(profile, 'самодельное лицо получило профиль Б').toBeNull()
    expect(error).toBeInstanceOf(ForbiddenError)
  })

  test('R-2.6-2: подмена прототипа у простого объекта не даёт прав сотрудника', async () => {
    const forged = Object.setPrototypeOf({ userId: a.userId, role: 'staff', cohort: 'main', groupId: null }, Actor.prototype) as Actor
    await expect(staffDal.listCohortRequests(forged)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

// ---------- П-04, R-2.3-34: студент передаёт только вид заявки ----------

describe('П-04, R-2.3-34: владелец и статус — от сервера', () => {
  it('лишние поля во входе слоя игнорируются: владелец — А, статус «Подана»', async () => {
    const input = { kind: 'dean_certificate', studentId: b.userId, userId: b.userId, status: 'ready', note: 'МЕТКА-П04-слой' }
    const created = await studentDal.createMyRequest(a, input as unknown as { kind: 'dean_certificate' }, 'test')
    expect(created).not.toBeNull()
    const mine = await studentDal.getMyRequest(a, created!.id)
    expect(mine?.status).toBe('submitted')
    expect(mine?.note).toBeNull()
    expect(mine?.studentName).toBe(STUDENT_A.fullName)
    expect(await studentDal.getMyRequest(b, created!.id)).toBeNull()
  })
})

// ---------- П-12: область сотрудника ----------

describe('П-12: сотрудник одного набора не видит и не меняет заявок другого', () => {
  it('контроль: сотрудник основного набора видит заявку А и меняет её статус', async () => {
    const id = await newRequest(a)
    expect((await staffDal.listCohortRequests(staff)).map((r) => r.id)).toContain(id)
    expect(await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' })).toEqual({ ok: true, status: 'in_progress' })
  })

  it('сотрудник второго набора не видит в списке заявок основного набора и их меток', async () => {
    const id = await newRequest(b)
    const list = await staffDal.listCohortRequests(altStaff)
    expect(list.map((r) => r.id)).not.toContain(id)
    const dump = JSON.stringify(list)
    for (const name of [STUDENT_A.fullName, STUDENT_B.fullName]) expect(dump).not.toContain(name)
    expect(await staffDal.getCohortRequest(altStaff, id)).toBeNull()
  })

  it('сотрудник второго набора не меняет заявку основного набора, и она не изменилась', async () => {
    const id = await newRequest(b)
    for (const target of ['in_progress', 'rejected'] as const) {
      const res = await staffDal.changeRequestStatus(altStaff, id, { target, reason: 'other' })
      expect(res).toEqual({ ok: false, reason: 'not_found' })
    }
    expect(await statusOf(b, id)).toBe('submitted')
  })

  it('сотрудник основного набора не видит и не меняет заявку второго набора', async () => {
    const altId = await newRequest(altStudent)
    expect((await staffDal.listCohortRequests(staff)).map((r) => r.id)).not.toContain(altId)
    expect(JSON.stringify(await staffDal.listCohortRequests(staff))).not.toContain(ALT_STUDENT.fullName)
    expect(await staffDal.getCohortRequest(staff, altId)).toBeNull()
    expect(await staffDal.changeRequestStatus(staff, altId, { target: 'in_progress' })).toEqual({ ok: false, reason: 'not_found' })
    expect(await statusOf(altStudent, altId)).toBe('submitted')
  })

  it('лишние поля при смене статуса не меняют ничего, кроме статуса', async () => {
    const id = await newRequest(a, 'tuition_certificate')
    const input = { target: 'in_progress', studentId: b.userId, kind: 'financial_aid', note: 'МЕТКА-П12', status: 'issued', grade: 5, password: 'x' }
    const res = await staffDal.changeRequestStatus(staff, id, input as unknown as { target: 'in_progress' })
    expect(res).toEqual({ ok: true, status: 'in_progress' })
    const after = await studentDal.getMyRequest(a, id)
    expect(after?.status).toBe('in_progress')
    expect(after?.kind).toBe('tuition_certificate')
    expect(after?.note).toBeNull()
    expect(await studentDal.getMyRequest(b, id)).toBeNull()
  })

  it('статус не из списка не принимается', async () => {
    const id = await newRequest(a)
    for (const target of ['approved', 'SUBMITTED', 'ready ', '', 'issued;--']) {
      const res = await staffDal.changeRequestStatus(staff, id, { target: target as 'ready' })
      expect(res, target).toEqual({ ok: false, reason: 'invalid_input' })
    }
    expect(await statusOf(a, id)).toBe('submitted')
  })

  it('уведомление о смене статуса приходит только владельцу заявки', async () => {
    const id = await newRequest(a)
    const aBefore = await studentDal.countMyUnreadNotifications(a)
    const bBefore = await studentDal.countMyUnreadNotifications(b)
    expect((await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' })).ok).toBe(true)
    expect((await studentDal.countMyUnreadNotifications(a)) - aBefore).toBe(1)
    expect(await studentDal.countMyUnreadNotifications(b)).toBe(bBefore)
    const links = (await studentDal.listMyNotifications(b)).map((n) => n.link)
    expect(links).not.toContain(`/requests/${id}`)
  })

  it('сотрудник не получает оценок, расписания и профиля студента: функции студента — отказ', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const calls = [
      () => studentDal.getMyProfile(staff),
      () => studentDal.listMyGrades(staff, today),
      () => studentDal.listMyLessons(staff, today, today),
      () => studentDal.listMyNotifications(staff),
      () => studentDal.listMyRequests(staff),
    ]
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(ForbiddenError)
    // В карточке заявки у сотрудника нет полей сверх решения проекта: ни оценок, ни примечания студента.
    const id = await newRequest(a)
    const card = await staffDal.getCohortRequest(staff, id)
    expect(Object.keys(card ?? {}).sort()).toEqual(
      // Пакет 3.4, решение пользователя 13.11.2026: к двенадцати полям добавлены два поля заявки — paymentYear и purpose.
      ['createdAt', 'dueDate', 'events', 'groupName', 'id', 'issuedOn', 'kind', 'paymentYear', 'pickupUntil', 'purpose', 'rejectReason', 'status', 'studentName', 'updatedAt'].sort(),
    )
  })
})

// ---------- ПР-1: порядок переходов статуса ----------

describe('ПР-1: порядок переходов статуса', () => {
  it('недопустимые переходы отклоняются и ничего не меняют', async () => {
    const id = await newRequest(a)
    for (const target of ['submitted', 'ready', 'issued'] as const) {
      expect(await staffDal.changeRequestStatus(staff, id, { target }), target).toEqual({ ok: false, reason: 'invalid_transition' })
    }
    expect(await statusOf(a, id)).toBe('submitted')
    expect((await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' })).ok).toBe(true)
    expect((await staffDal.changeRequestStatus(staff, id, { target: 'ready' })).ok).toBe(true)
    expect(await staffDal.changeRequestStatus(staff, id, { target: 'rejected', reason: 'other' })).toEqual({ ok: false, reason: 'invalid_transition' })
    expect((await staffDal.changeRequestStatus(staff, id, { target: 'issued' })).ok).toBe(true)
    for (const target of ['in_progress', 'ready', 'rejected', 'submitted'] as const) {
      expect((await staffDal.changeRequestStatus(staff, id, { target, reason: 'other' })).ok, target).toBe(false)
    }
    expect(await statusOf(a, id)).toBe('issued')
  })

  it('два сотрудника одновременно: «Готова» и «Отклонена» из «В работе» — проходит одно, путь допустимый', async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = await newRequest(a)
      expect((await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' })).ok).toBe(true)
      const results = await Promise.all([
        staffDal.changeRequestStatus(staff, id, { target: 'ready' }),
        staffDal.changeRequestStatus(staff, id, { target: 'rejected', reason: 'other' }),
      ])
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      const final = await studentDal.getMyRequest(a, id)
      expect(['ready', 'rejected']).toContain(final?.status)
      expect(final?.events.map((e) => e.status)).toEqual(['submitted', 'in_progress', final?.status])
    }
  })

  it('студент статус не меняет: функции сотрудника — отказ (П-05 на слое)', async () => {
    const id = await newRequest(a)
    await expect(staffDal.changeRequestStatus(a, id, { target: 'ready' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.listCohortRequests(a)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await statusOf(a, id)).toBe('submitted')
  })
})

// ---------- R-2.3-26: удаление сессии не трогает заявки ----------

describe('R-2.3-26: выход и удаление сессий не стирают заявок', () => {
  it('выход А и удаление всех его сессий: заявки А на месте', async () => {
    const id = await newRequest(a)
    const countRequests = async () =>
      Number((await withOwner((c) => c.query('select count(*)::int as n from requests where student_id = $1', [a.userId]))).rows[0]?.n)
    const before = await countRequests()
    const outcome = await authenticate(STUDENT_A.login, STUDENT_A.password, 'test')
    if (!outcome.ok) throw new Error('вход не удался')
    await destroySession(outcome.token)
    await withOwner((c) => c.query('delete from sessions where user_id = $1', [a.userId]))
    expect(await countRequests()).toBe(before)
    const again = await actorFor(STUDENT_A)
    expect((await studentDal.listMyRequests(again)).map((r) => r.id)).toContain(id)
  })
})

// ---------- П-10, Т-02: роль базы и права учётных записей ----------

describe('П-10, Т-02: права роли базы и учётных записей минимальны', () => {
  async function asApp<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      return await run(client)
    } finally {
      await client.end()
    }
  }

  it('роль приложения: не суперпользователь, без обхода политик, не меняет роли и пароли', async () => {
    const res = await asApp((c) => c.query('select current_user as name, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = current_user'))
    const row = res.rows[0]
    expect(row).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false })
    await expect(asApp((c) => c.query(`update users set role = 'staff' where login = $1`, [STUDENT_A.login]))).rejects.toThrow(/permission denied/)
    await expect(asApp((c) => c.query(`update users set password_hash = 'x'`))).rejects.toThrow(/permission denied/)
  })

  it('в базе только роли «студент» и «сотрудник»; администратора нет; у набора один сотрудник', async () => {
    const roles = await withOwner((c) => c.query('select role, cohort, count(*)::int as n from users group by role, cohort'))
    for (const row of roles.rows) expect(['student', 'staff']).toContain(row.role)
    const mainStaff = roles.rows.find((r) => r.role === 'staff' && r.cohort === 'main')
    expect(mainStaff?.n).toBe(1)
    await expect(
      withOwner((c) => c.query(`insert into users (login, password_hash, role, cohort) values ('probe-admin', 'x', 'admin', 'main')`)),
    ).rejects.toThrow(/users_role_check|violates check/)
  })
})
