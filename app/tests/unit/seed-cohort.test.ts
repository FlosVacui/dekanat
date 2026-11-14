// Заполнение базы набором (пакет 3.8): возврат в исходное состояние без следов прежнего набора, режим «освежить»,
// резервные наборы. База — тестовая; в конце набор возвращается к состоянию, которого ждут остальные тесты.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { seedCohort } from '../../db/seed-lib'
import { buildCohortPlan, detId } from '../../db/seed-plan'
import {
  RESERVES,
  ReserveConfigError,
  buildReserveCohort,
  readReserveAccounts,
  readReserveSets,
  refreshReserves,
  reserveEnvNames,
  seedReserves,
} from '../../db/seed-reserve-lib'
import { addDays, todayIn } from '@/lib/dates'
import { authenticate } from '@/server/auth/login'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { ALT_COHORT, STAFF_MAIN, STUDENT_A } from './fixtures'
import { actorFor, freshIp, withOwner } from './helpers'

const today = todayIn('Europe/Moscow')
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url))
const [student1, student2] = MAIN_COHORT.students
const [group1] = MAIN_COHORT.groups
if (!student1 || !student2 || !group1) throw new Error('В основном наборе нет данных')

const full = (client: pg.Client, date = today) => seedCohort(client, MAIN_COHORT, date)
const refresh = (client: pg.Client, date = today) => seedCohort(client, MAIN_COHORT, date, { mode: 'refresh' })

/** Отпечаток таблиц основного набора и общих таблиц: что изменилось и что нет. Пароли в отпечаток входят. */
async function fingerprint(client: pg.Client, cohort = 'main'): Promise<Record<string, string>> {
  const students = `SELECT id FROM users WHERE cohort = '${cohort}' AND role = 'student'`
  const groups = `SELECT group_id FROM students WHERE user_id IN (${students})`
  const queries: Record<string, string> = {
    users: `SELECT t::text AS r FROM users t WHERE cohort = '${cohort}'`,
    students: `SELECT t::text AS r FROM students t WHERE user_id IN (${students})`,
    groups: `SELECT t::text AS r FROM groups t WHERE id IN (${groups})`,
    lessons: `SELECT t::text AS r FROM lessons t WHERE group_id IN (${groups})`,
    changes: `SELECT t::text AS r FROM lesson_changes t WHERE lesson_id IN (SELECT id FROM lessons WHERE group_id IN (${groups}))`,
    disciplines: `SELECT t::text AS r FROM disciplines t WHERE group_id IN (${groups})`,
    assignments: `SELECT t::text AS r FROM assignments t WHERE discipline_id IN (SELECT id FROM disciplines WHERE group_id IN (${groups}))`,
    grades: `SELECT t::text AS r FROM grades t WHERE student_id IN (${students})`,
    requests: `SELECT t::text AS r FROM requests t WHERE student_id IN (${students})`,
    events: `SELECT t::text AS r FROM request_events t WHERE request_id IN (SELECT id FROM requests WHERE student_id IN (${students}))`,
    notifications: `SELECT t::text AS r FROM notifications t WHERE student_id IN (${students})`,
    announcements: `SELECT t::text AS r FROM announcements t WHERE group_id IN (${groups})
       OR faculty IN (SELECT faculty FROM students WHERE user_id IN (${students}))`,
  }
  const result: Record<string, string> = {}
  for (const [name, sql] of Object.entries(queries)) {
    const rows = await client.query(`SELECT coalesce(md5(string_agg(r, '|' ORDER BY r)), 'пусто') AS h FROM (${sql}) x`)
    result[name] = rows.rows[0].h as string
  }
  return result
}

async function count(client: pg.Client, sql: string, values: unknown[] = []): Promise<number> {
  return (await client.query(`SELECT count(*)::int AS n FROM (${sql}) x`, values)).rows[0].n as number
}

const LEGACY_GROUPS = [
  { name: 'Э-21-1', faculty: 'Факультет экономики и управления' },
  { name: 'П-22-1', faculty: 'Факультет права и политики' },
]

/** Состояние базы, где лежал прежний набор: группы «Э-21-1» и «П-22-1», их пары, дисциплины, работы, оценки и объявления. */
async function installLegacy(client: pg.Client): Promise<void> {
  for (const [i, g] of LEGACY_GROUPS.entries()) {
    const groupId = detId('group', 'main', g.name)
    await client.query('INSERT INTO groups (id, name, faculty) VALUES ($1, $2, $3)', [groupId, g.name, g.faculty])
    await client.query(
      `INSERT INTO lessons (id, group_id, lesson_date, starts_at, ends_at, discipline, kind, room, teacher)
       VALUES ($1, $2, $3, '09:00', '10:30', 'Прежняя дисциплина', 'lecture', 'Б-311', 'Прежний Т. Т.')`,
      [detId('lesson', 'main', g.name, '0', '0'), groupId, today],
    )
    await client.query(`INSERT INTO lesson_changes (id, lesson_id, kind, note) VALUES ($1, $2, 'room_changed', 'Б-311 → Б-312')`, [
      detId('lesson-change', 'legacy', g.name),
      detId('lesson', 'main', g.name, '0', '0'),
    ])
    const disciplineId = detId('discipline', 'main', g.name, 'Прежняя дисциплина')
    await client.query(
      `INSERT INTO disciplines (id, group_id, name, control_kind, semester) VALUES ($1, $2, 'Прежняя дисциплина', 'exam', 3)`,
      [disciplineId, groupId],
    )
    await client.query(`INSERT INTO assignments (id, discipline_id, title, due_date, max_points) VALUES ($1, $2, 'Прежняя работа', $3, 10)`, [
      detId('assignment', disciplineId, '0'),
      disciplineId,
      today,
    ])
    const student = [student1, student2][i]!
    // Студент учился в прежней группе и имел по прежней дисциплине оценку.
    await client.query('UPDATE students SET group_id = $2 WHERE user_id = $1', [detId('user', student.login), groupId])
    await client.query(`INSERT INTO grades (id, student_id, discipline_id, points, outcome) VALUES ($1, $2, $3, 90, '5')`, [
      detId('grade', 'legacy', g.name),
      detId('user', student.login),
      disciplineId,
    ])
    await client.query(`INSERT INTO announcements (id, group_id, faculty, title, body) VALUES ($1, NULL, $2, 'Прежнее объявление', 'Текст')`, [
      detId('announcement', 'main', `legacy-faculty-${i}`),
      g.faculty,
    ])
    await client.query(`INSERT INTO announcements (id, group_id, faculty, title, body) VALUES ($1, $2, NULL, 'Прежнее групповое', 'Текст')`, [
      detId('announcement', 'main', `legacy-group-${i}`),
      groupId,
    ])
  }
}

afterAll(async () => {
  // Набор возвращается к состоянию, которого ждут остальные тесты; резервы убираются.
  await withOwner(async (client) => {
    await cleanReserves(client)
    await full(client)
    await seedCohort(client, ALT_COHORT, today)
  })
  await closeDb()
})

async function cleanReserves(client: pg.Client): Promise<void> {
  const faculties = RESERVES.flatMap((r) => r.faculties)
  const groups = RESERVES.flatMap((r) => r.groups)
  await client.query('DELETE FROM announcements WHERE faculty = ANY($1::text[])', [faculties])
  await client.query(`DELETE FROM users WHERE cohort = ANY($1::text[])`, [RESERVES.map((r) => r.cohort)])
  await client.query('DELETE FROM groups WHERE name = ANY($1::text[])', [groups])
}

describe('прежний набор не оставляет следов (db:seed)', () => {
  it('после заполнения нет групп, пар, дисциплин, работ, оценок и объявлений прежнего набора; другие наборы не тронуты', async () => {
    await withOwner(async (client) => {
      await full(client)
      await seedCohort(client, ALT_COHORT, today)
      const altBefore = await fingerprint(client, 'test-alt')
      await installLegacy(client)
      expect(await count(client, `SELECT 1 FROM groups WHERE name = ANY($1::text[])`, [LEGACY_GROUPS.map((g) => g.name)])).toBe(2)

      await full(client)

      expect(await count(client, `SELECT 1 FROM groups WHERE name = ANY($1::text[])`, [LEGACY_GROUPS.map((g) => g.name)])).toBe(0)
      expect(await count(client, `SELECT 1 FROM lessons WHERE discipline = 'Прежняя дисциплина'`)).toBe(0)
      expect(await count(client, `SELECT 1 FROM lesson_changes WHERE note = 'Б-311 → Б-312'`)).toBe(0)
      expect(await count(client, `SELECT 1 FROM disciplines WHERE name = 'Прежняя дисциплина'`)).toBe(0)
      expect(await count(client, `SELECT 1 FROM assignments WHERE title = 'Прежняя работа'`)).toBe(0)
      expect(await count(client, `SELECT 1 FROM grades WHERE points = 90`)).toBe(0)
      expect(await count(client, `SELECT 1 FROM announcements WHERE title LIKE 'Прежнее%'`)).toBe(0)
      // Студенты в новых группах.
      const groups = await client.query(
        `SELECT u.login, g.name FROM students s JOIN users u ON u.id = s.user_id JOIN groups g ON g.id = s.group_id
         WHERE u.cohort = 'main' ORDER BY u.login`,
      )
      expect(groups.rows).toEqual([
        { login: 'belozerov', name: 'ЦЭ-24-03' },
        { login: 'nesterova', name: 'ЦИ-25-01' },
      ])
      expect(await fingerprint(client, 'test-alt')).toEqual(altBefore)
    })
  })

  it('повторное заполнение в тот же день ничего не меняет, кроме паролей (хеш с новой солью)', async () => {
    await withOwner(async (client) => {
      await full(client)
      const first = await fingerprint(client)
      await full(client)
      const second = await fingerprint(client)
      const { users, ...rest } = second
      const { users: firstUsers, ...firstRest } = first
      expect(rest).toEqual(firstRest)
      expect(users).not.toBe(firstUsers) // каждое заполнение хеширует пароли заново
    })
  })

  it('заполнение возвращает заявку набора к её шагам: статус, срок и история', async () => {
    const plan = buildCohortPlan(MAIN_COHORT, today)
    const residence = plan.students[1]!.requests.find((r) => r.key === 'cert-residence')!
    const staff: Actor = await actorFor(STAFF_MAIN)
    await withOwner((client) => full(client))
    const changed = await staffDal.changeRequestStatus(staff, residence.id, { target: 'in_progress' })
    expect(changed).toEqual({ ok: true, status: 'in_progress' })
    await withOwner(async (client) => {
      const mid = await client.query('SELECT status, due_date FROM requests WHERE id = $1', [residence.id])
      expect(mid.rows[0].status).toBe('in_progress')
      await full(client)
      const after = await client.query('SELECT status, due_date, reject_reason FROM requests WHERE id = $1', [residence.id])
      expect(after.rows[0]).toMatchObject({ status: 'submitted', due_date: null, reject_reason: null })
      expect(await count(client, 'SELECT 1 FROM request_events WHERE request_id = $1', [residence.id])).toBe(1)
    })
  })

  it('у каждой заявки в базе — по строке request_events на шаг, срок и день выдачи из набора', async () => {
    await withOwner(async (client) => {
      await full(client)
      const plan = buildCohortPlan(MAIN_COHORT, today)
      for (const r of plan.students.flatMap((s) => s.requests)) {
        const events = await client.query(`SELECT status FROM request_events WHERE request_id = $1 ORDER BY created_at`, [r.id])
        expect(events.rows.map((e) => e.status), r.key).toEqual(r.steps.map((s) => s.status))
        const row = (
          await client.query(
            `SELECT status, due_date::text AS due, pickup_until::text AS pickup, issued_on::text AS issued, reject_reason, purpose, payment_year,
                    note FROM requests WHERE id = $1`,
            [r.id],
          )
        ).rows[0]
        expect(row, r.key).toEqual({
          status: r.status,
          due: r.dueDate,
          pickup: r.pickupUntil,
          issued: r.issuedOn,
          reject_reason: r.rejectReason,
          purpose: r.purpose,
          payment_year: r.paymentYear,
          note: r.note,
        })
      }
      const rejected = await client.query(`SELECT note FROM request_events WHERE status = 'rejected' AND request_id IN (SELECT id FROM requests WHERE ip = 'seed')`)
      expect(rejected.rows).toEqual([{ note: 'Такую справку выдают по заявлению в деканате. Подайте заявление лично' }])
    })
  })
})

describe('режим «освежить» (db:refresh)', () => {
  it('переносит даты набора на другой день, не трогает заявку посетителя, уведомление, пароли и счётчики входа', async () => {
    const a = await actorFor(STUDENT_A)
    const staff = await actorFor(STAFF_MAIN)
    await withOwner((client) => full(client))

    // «Посетитель» подал заявку, сотрудник перевёл её в работу: появились история и уведомление.
    const mine = await studentDal.createMyRequest(a, { kind: 'tuition_certificate', paymentYear: 2025 }, 'refresh-test')
    expect(mine).not.toBeNull()
    expect((await staffDal.changeRequestStatus(staff, mine!.id, { target: 'in_progress' })).ok).toBe(true)
    const visitorNotifications = (await studentDal.listMyNotifications(a)).filter((n) => n.title.startsWith('Справка об оплате обучения'))
    expect(visitorNotifications.length).toBeGreaterThan(0)

    const later = addDays(today, 3)
    await withOwner(async (client) => {
      await client.query(`INSERT INTO login_attempts (ip, login, fails, next_allowed_at, last_attempt_at) VALUES ('refresh-probe', 'x', 3, now(), now())`)
      await client.query(`INSERT INTO login_streaks (login, fails) VALUES ('refresh-probe', 3)`)
      const hashes = (await client.query(`SELECT login, password_hash FROM users WHERE cohort = 'main' ORDER BY login`)).rows
      const planNow = buildCohortPlan(MAIN_COHORT, today)

      await refresh(client, later)

      // Заявка и уведомление посетителя на месте, не изменены.
      const request = await client.query('SELECT status, ip, payment_year FROM requests WHERE id = $1', [mine!.id])
      expect(request.rows[0]).toMatchObject({ status: 'in_progress', ip: 'refresh-test', payment_year: 2025 })
      expect(await count(client, 'SELECT 1 FROM request_events WHERE request_id = $1', [mine!.id])).toBe(2)
      const stillThere = (await studentDal.listMyNotifications(a)).filter((n) => n.title.startsWith('Справка об оплате обучения'))
      expect(stillThere.map((n) => n.id).sort()).toEqual(visitorNotifications.map((n) => n.id).sort())
      // Счётчики входа и пароли не тронуты.
      expect(await count(client, `SELECT 1 FROM login_attempts WHERE ip = 'refresh-probe'`)).toBe(1)
      expect(await count(client, `SELECT 1 FROM login_streaks WHERE login = 'refresh-probe'`)).toBe(1)
      expect((await client.query(`SELECT login, password_hash FROM users WHERE cohort = 'main' ORDER BY login`)).rows).toEqual(hashes)

      // Даты набора сдвинулись: пар старше Д-7 нет, всё окно считано от нового дня.
      const planLater = buildCohortPlan(MAIN_COHORT, later)
      const lessons = await client.query(`SELECT min(lesson_date)::text AS first, max(lesson_date)::text AS last FROM lessons WHERE group_id = $1`, [
        planLater.groups[0]!.id,
      ])
      const dates = planLater.lessons.filter((l) => l.groupName === group1.name).map((l) => l.date).sort()
      expect(lessons.rows[0]).toEqual({ first: dates[0], last: dates[dates.length - 1] })
      expect(dates[0]! >= addDays(later, -7)).toBe(true)
      expect(await count(client, `SELECT 1 FROM lessons WHERE group_id = ANY($1::uuid[]) AND lesson_date < $2`, [planLater.groups.map((g) => g.id), addDays(later, -7)])).toBe(0)
      const aid = planLater.students[0]!.requests.find((r) => r.key === 'aid')!
      expect((await client.query('SELECT due_date::text AS d FROM requests WHERE id = $1', [aid.id])).rows[0].d).toBe(aid.dueDate)
      expect(aid.dueDate).not.toBe(planNow.students[0]!.requests.find((r) => r.key === 'aid')!.dueDate)
      const exam = await client.query(`SELECT exam_date::text AS d FROM disciplines WHERE name = 'Микроэкономика'`)
      expect(exam.rows[0].d).toBe(addDays(later, 36))
      const due = await client.query(`SELECT due_date::text AS d FROM assignments WHERE title = 'Расчётная работа №3'`)
      expect(due.rows[0].d).toBe(planLater.disciplines.flatMap((d) => d.assignments).find((w) => w.key === 'rz3')!.dueDate)
      const published = await client.query(`SELECT (published_at AT TIME ZONE 'Europe/Moscow')::date::text AS d FROM announcements WHERE title = 'Оценки за экзамены' LIMIT 1`)
      expect(published.rows[0].d).toBe(addDays(later, -7))
      const reminder = planLater.students[0]!.notifications[1]!
      expect((await client.query('SELECT title FROM notifications WHERE id = $1', [reminder.id])).rows[0].title).toBe(reminder.title)

      // Повторный запуск в тот же день ничего не меняет.
      const afterFirst = await fingerprint(client)
      await refresh(client, later)
      expect(await fingerprint(client)).toEqual(afterFirst)

      await client.query(`DELETE FROM login_attempts WHERE ip = 'refresh-probe'`)
      await client.query(`DELETE FROM login_streaks WHERE login = 'refresh-probe'`)
    })
  })

  it('заявки набора возвращаются к набору, прочитанность уведомлений набора остаётся', async () => {
    const plan = buildCohortPlan(MAIN_COHORT, today)
    const residence = plan.students[1]!.requests.find((r) => r.key === 'cert-residence')!
    const staff = await actorFor(STAFF_MAIN)
    await withOwner((client) => full(client))
    expect((await staffDal.changeRequestStatus(staff, residence.id, { target: 'in_progress' })).ok).toBe(true)
    await withOwner(async (client) => {
      const unread = plan.students[1]!.notifications.find((n) => n.unread)!
      await client.query('UPDATE notifications SET read_at = now() WHERE id = $1', [unread.id])
      await refresh(client)
      const row = await client.query('SELECT status FROM requests WHERE id = $1', [residence.id])
      expect(row.rows[0].status).toBe('submitted')
      // Прочитанное посетителем остаётся прочитанным: «освежить» состояние чтения не сбрасывает.
      expect((await client.query('SELECT read_at FROM notifications WHERE id = $1', [unread.id])).rows[0].read_at).not.toBeNull()
      // Заявка, созданная приложением (ответ сотрудника — уведомление), в основном наборе остаётся: полное заполнение её убрало бы.
      expect(await count(client, `SELECT 1 FROM notifications WHERE student_id = $1 AND id <> ALL($2::uuid[])`, [
        plan.students[1]!.userId,
        plan.students[1]!.notifications.map((n) => n.id),
      ])).toBeGreaterThan(0)
      // Полное заполнение возвращает всё.
      await full(client)
      expect(await count(client, `SELECT 1 FROM notifications WHERE student_id = $1 AND id <> ALL($2::uuid[])`, [
        plan.students[1]!.userId,
        plan.students[1]!.notifications.map((n) => n.id),
      ])).toBe(0)
      expect((await client.query('SELECT read_at FROM notifications WHERE id = $1', [unread.id])).rows[0].read_at).toBeNull()
    })
  })

  it('освежение убирает группы и объявления прежнего набора так же, как заполнение', async () => {
    await withOwner(async (client) => {
      await full(client)
      await installLegacy(client)
      await refresh(client)
      expect(await count(client, `SELECT 1 FROM groups WHERE name = ANY($1::text[])`, [LEGACY_GROUPS.map((g) => g.name)])).toBe(0)
      expect(await count(client, `SELECT 1 FROM announcements WHERE title LIKE 'Прежнее%'`)).toBe(0)
      await full(client)
    })
  })
})

describe('резервные наборы', () => {
  // Пароли-метки: настоящих не бывает в тестах и в git. Длина 20 и больше.
  const envFor = (n: number, suffix = ''): Record<string, string> => {
    const names = reserveEnvNames(n)
    return {
      [names.staff[0]]: `res${n}-staff${suffix}`,
      [names.staff[1]]: `метка-пароль-сотрудника-${n}-${'с'.repeat(20)}`,
      [names.students[0][0]]: `res${n}-student-one${suffix}`,
      [names.students[0][1]]: `метка-пароль-студента-1-${n}-${'а'.repeat(20)}`,
      [names.students[1][0]]: `res${n}-student-two${suffix}`,
      [names.students[1][1]]: `метка-пароль-студента-2-${n}-${'б'.repeat(20)}`,
    }
  }
  const env = { ...envFor(1), ...envFor(2) }

  beforeAll(async () => {
    await withOwner(async (client) => {
      await cleanReserves(client)
      await full(client)
    })
  })

  it('отказ без записи: нет переменной, короткий пароль, повторный логин, логин основного набора', () => {
    const missing = { ...env }
    delete missing[reserveEnvNames(1).students[1][1]]
    expect(() => readReserveSets(missing, [1, 2])).toThrow(ReserveConfigError)
    expect(() => readReserveSets(missing, [1, 2])).toThrow(/RESERVE_1_STUDENT_2_PASSWORD/)
    // Короткий пароль — 19 знаков; сообщение называет переменную и не содержит ни пароля, ни логина.
    const shortPassword = 'я'.repeat(19)
    const short = { ...env, [reserveEnvNames(2).staff[1]]: shortPassword }
    let message = ''
    try {
      readReserveSets(short, [1, 2])
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('RESERVE_2_STAFF_PASSWORD')
    expect(message).not.toContain(shortPassword)
    for (const value of Object.values(short)) expect(message).not.toContain(value)
    expect(() => readReserveAccounts({ ...env, [reserveEnvNames(1).staff[1]]: 'x'.repeat(20) }, 1)).not.toThrow()
    const same = { ...env, [reserveEnvNames(1).students[1][0]]: env[reserveEnvNames(1).students[0][0]]! }
    expect(() => readReserveSets(same, [1])).toThrow(/различаться/)
    expect(() => readReserveSets({ ...env, [reserveEnvNames(1).staff[0]]: 'Dekanat ' }, [1])).toThrow(/основного набора/)
    expect(() => readReserveSets({ ...env, [reserveEnvNames(2).staff[0]]: env[reserveEnvNames(1).staff[0]]! }, [1, 2])).toThrow(/различаться/)
    expect(() => readReserveSets(env, [3])).toThrow(/Набора резерва 3 нет/)
    expect(() => readReserveSets({}, [1])).toThrow(ReserveConfigError)
  })

  it('команда db:seed:reserve без переменных или с коротким паролем отказывает и ничего не пишет', async () => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RESERVE_')))
    const run = (extra: Record<string, string>) =>
      spawnSync(process.execPath, ['./node_modules/tsx/dist/cli.mjs', 'db/seed-reserve.ts'], {
        cwd: APP_DIR,
        env: { ...clean, DATABASE_OWNER_URL: process.env.TEST_DATABASE_OWNER_URL ?? '', ...extra } as unknown as NodeJS.ProcessEnv,
        encoding: 'utf8',
        timeout: 120_000,
      })
    const usersBefore = await withOwner((c) => count(c, 'SELECT 1 FROM users'))
    const secret = 'короткий-пароль' // 15 знаков
    const results = [run({}), run({ ...envFor(1), ...envFor(2), [reserveEnvNames(2).students[1][1]]: secret })]
    for (const r of results) {
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('В базу ничего не записано')
      expect(r.stdout + r.stderr).not.toContain(secret)
    }
    expect(results[1]!.stderr).toContain('RESERVE_2_STUDENT_2_PASSWORD')
    expect(await withOwner((c) => count(c, 'SELECT 1 FROM users'))).toBe(usersBefore)
    expect(await withOwner((c) => count(c, `SELECT 1 FROM users WHERE cohort LIKE 'reserve-%'`))).toBe(0)
  })

  it('резервы создаются рядом с основным: свои группы и факультеты, основной набор и счётчики входа не тронуты', async () => {
    const sets = readReserveSets(env, [1, 2])
    await withOwner(async (client) => {
      await client.query(`INSERT INTO login_attempts (ip, login, fails, next_allowed_at, last_attempt_at) VALUES ('reserve-probe', 'x', 3, now(), now())`)
      const mainBefore = await fingerprint(client)

      await seedReserves(client, sets, today)

      expect(await fingerprint(client)).toEqual(mainBefore)
      expect(await count(client, `SELECT 1 FROM login_attempts WHERE ip = 'reserve-probe'`)).toBe(1)
      await client.query(`DELETE FROM login_attempts WHERE ip = 'reserve-probe'`)
      const groups = await client.query(`SELECT name, faculty FROM groups WHERE name = ANY($1::text[]) ORDER BY name`, [
        RESERVES.flatMap((r) => r.groups),
      ])
      expect(groups.rows).toHaveLength(4)
      const users = await client.query(`SELECT cohort, role, password_published FROM users WHERE cohort LIKE 'reserve-%' ORDER BY cohort, role`)
      expect(users.rows).toHaveLength(6)
      expect(users.rows.every((u) => u.password_published === false)).toBe(true)
      // Состав тот же: шесть заявок, пары, оценки, девять объявлений (15 строк) на набор.
      for (const { def } of sets) {
        const plan = buildCohortPlan(buildReserveCohort(MAIN_COHORT, def, sets.find((s) => s.def === def)!.accounts), today)
        expect(plan.students.map((s) => s.requests.length)).toEqual([3, 3])
        expect(plan.announcements).toHaveLength(15)
        const own = plan.groups.map((g) => g.id)
        expect(await count(client, 'SELECT 1 FROM lessons WHERE group_id = ANY($1::uuid[])', [own])).toBe(plan.lessons.length)
      }
    })
  })

  it('под каждым аккаунтом резерва проходит проверка пароля, неверный пароль не проходит', async () => {
    for (const { accounts } of readReserveSets(env, [1, 2])) {
      for (const account of [accounts.staff, ...accounts.students]) {
        const ok = await authenticate(account.login, account.password, freshIp())
        expect(ok.ok, account.login).toBe(true)
        expect((await authenticate(account.login, `${account.password}!`, freshIp())).ok).toBe(false)
      }
    }
  })

  it('студент резерва не получает объявлений основного набора, и наоборот; названия не смешиваются', async () => {
    const sets = readReserveSets(env, [1, 2])
    const mainActors = [await actorFor(STUDENT_A), await actorFor(student2)]
    const mainIds = new Set(buildCohortPlan(MAIN_COHORT, today).announcements.map((a) => a.id))
    const mainTitles = (await Promise.all(mainActors.map((m) => studentDal.listMyUnreadAnnouncements(m)))).map((l) => l.length)
    expect(mainTitles.every((n) => n > 0)).toBe(true)
    for (const { def, accounts } of sets) {
      const plan = buildCohortPlan(buildReserveCohort(MAIN_COHORT, def, accounts), today)
      const ownIds = new Set(plan.announcements.map((a) => a.id))
      for (const [i, student] of accounts.students.entries()) {
        const actor = await actorFor(student)
        const seen = await studentDal.listMyUnreadAnnouncements(actor)
        const expected = plan.announcements.filter((a) => a.groupId === plan.students[i]!.groupId || a.faculty === plan.students[i]!.spec.faculty)
        expect(seen.map((a) => a.id).sort()).toEqual(expected.map((a) => a.id).sort())
        expect(seen.length).toBeGreaterThan(0)
        for (const a of seen) {
          expect(mainIds.has(a.id)).toBe(false)
          expect(ownIds.has(a.id)).toBe(true)
        }
        const profile = await studentDal.getMyProfile(actor)
        expect(profile).toMatchObject({ fullName: def.studentNames[i], groupName: def.groups[i], faculty: def.faculties[i] })
        // Объявления основного набора названий резерва не содержат и наоборот.
        const text = JSON.stringify(seen)
        for (const old of [...MAIN_COHORT.groups.flatMap((g) => [g.name, g.faculty]), ...MAIN_COHORT.students.map((s) => s.fullName)]) {
          expect(text).not.toContain(old)
        }
      }
    }
    const reserveIds = new Set(sets.flatMap(({ def, accounts }) => buildCohortPlan(buildReserveCohort(MAIN_COHORT, def, accounts), today).announcements.map((a) => a.id)))
    for (const m of mainActors) {
      for (const a of await studentDal.listMyUnreadAnnouncements(m)) expect(reserveIds.has(a.id)).toBe(false)
    }
  })

  it('сотрудник резерва не видит заявок основного набора и другого резерва, и наоборот', async () => {
    const sets = readReserveSets(env, [1, 2])
    const mainStaff = await actorFor(STAFF_MAIN)
    const mainRequests = await staffDal.listCohortRequests(mainStaff)
    const mainIds = new Set(mainRequests.map((r) => r.id))
    expect(mainIds.size).toBeGreaterThan(0)
    const seenByReserves: Set<string>[] = []
    for (const { accounts } of sets) {
      const staff = await actorFor(accounts.staff)
      const list = await staffDal.listCohortRequests(staff)
      expect(list).toHaveLength(6)
      for (const r of list) expect(mainIds.has(r.id)).toBe(false)
      for (const id of mainIds) expect(await staffDal.getCohortRequest(staff, id)).toBeNull()
      expect(JSON.stringify(list)).not.toContain(student1.fullName)
      seenByReserves.push(new Set(list.map((r) => r.id)))
      for (const id of mainIds) expect(await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' })).toEqual({ ok: false, reason: 'not_found' })
    }
    expect([...seenByReserves[0]!].some((id) => seenByReserves[1]!.has(id))).toBe(false)
    for (const set of seenByReserves) {
      for (const id of set) expect(await staffDal.getCohortRequest(mainStaff, id)).toBeNull()
    }
  })

  it('«освежить» трогает резерв, который есть в базе и чьи переменные заданы; без переменных пропускает; пароли не меняются', async () => {
    await withOwner(async (client) => {
      const hashes = (await client.query(`SELECT login, password_hash FROM users WHERE cohort LIKE 'reserve-%' ORDER BY login`)).rows
      expect(await refreshReserves(client, {}, today)).toEqual([])
      expect(await refreshReserves(client, env, addDays(today, 2))).toEqual([1, 2])
      expect((await client.query(`SELECT login, password_hash FROM users WHERE cohort LIKE 'reserve-%' ORDER BY login`)).rows).toEqual(hashes)
      const first = RESERVES[0]!
      const plan = buildCohortPlan(buildReserveCohort(MAIN_COHORT, first, readReserveAccounts(env, 1)), addDays(today, 2))
      const lessons = await client.query(`SELECT min(lesson_date)::text AS first FROM lessons WHERE group_id = $1`, [plan.groups[0]!.id])
      expect(lessons.rows[0].first).toBe(plan.lessons.filter((l) => l.groupName === plan.groups[0]!.name).map((l) => l.date).sort()[0])
      await cleanReserves(client)
      expect(await refreshReserves(client, env, today)).toEqual([])
    })
  })
})
