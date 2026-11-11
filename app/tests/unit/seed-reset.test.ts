// Повторный запуск вымышленных данных возвращает основной набор в исходное состояние (R-2.4-4).
// Заявка, история статусов и уведомление студента основного набора исчезают; данные второго набора остаются.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { seedCohort } from '../../db/seed-lib'
import { todayIn } from '@/lib/dates'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { ALT_COHORT, ALT_STUDENT, STAFF_MAIN, STUDENT_A } from './fixtures'
import { actorFor, withOwner } from './helpers'

let a: Actor
let alt: Actor
let staff: Actor
const today = todayIn('Europe/Moscow')

beforeAll(async () => {
  ;[a, alt, staff] = await Promise.all([actorFor(STUDENT_A), actorFor(ALT_STUDENT), actorFor(STAFF_MAIN)])
})
afterAll(closeDb)

/** Сколько заявок, записей истории и уведомлений у студентов набора (по владельцу базы). */
async function counts(cohort: string): Promise<{ requests: number; events: number; notifications: number }> {
  return withOwner(async (client) => {
    const students = `SELECT id FROM users WHERE cohort = $1 AND role = 'student'`
    const requests = await client.query(`SELECT count(*)::int AS n FROM requests WHERE student_id IN (${students})`, [cohort])
    const events = await client.query(
      `SELECT count(*)::int AS n FROM request_events WHERE request_id IN (SELECT id FROM requests WHERE student_id IN (${students}))`,
      [cohort],
    )
    const notifications = await client.query(`SELECT count(*)::int AS n FROM notifications WHERE student_id IN (${students})`, [cohort])
    return { requests: requests.rows[0].n, events: events.rows[0].n, notifications: notifications.rows[0].n }
  })
}

describe('повторный запуск данных (db:seed)', () => {
  it('убирает заявку студента основного набора и оставляет заявку второго набора', async () => {
    // Исходное состояние: только то, что в вымышленных данных.
    await withOwner((client) => seedCohort(client, MAIN_COHORT, today))
    await withOwner((client) => seedCohort(client, ALT_COHORT, today))
    const seededMain = {
      requests: MAIN_COHORT.students.reduce((n, s) => n + s.requests.length, 0),
      notifications: MAIN_COHORT.students.reduce((n, s) => n + s.notifications.length, 0),
    }
    const mainBefore = await counts('main')
    expect(mainBefore.requests).toBe(seededMain.requests)
    expect(mainBefore.notifications).toBe(seededMain.notifications)
    const altBefore = await counts('test-alt')

    // Студент основного набора подаёт заявку, сотрудник меняет статус: появляются история и уведомление.
    const mine = await studentDal.createMyRequest(a, { kind: 'dean_certificate' }, 'test')
    expect(mine).not.toBeNull()
    const changed = await staffDal.changeRequestStatus(staff, mine!.id, { target: 'in_progress' })
    expect(changed).not.toBeNull()
    // Студент второго набора тоже подаёт заявку.
    const theirs = await studentDal.createMyRequest(alt, { kind: 'dean_certificate' }, 'test')
    expect(theirs).not.toBeNull()

    const mainMid = await counts('main')
    expect(mainMid.requests).toBe(mainBefore.requests + 1)
    expect(mainMid.events).toBeGreaterThan(mainBefore.events)
    expect(mainMid.notifications).toBeGreaterThan(mainBefore.notifications)

    // Повторный запуск данных основного набора.
    await withOwner((client) => seedCohort(client, MAIN_COHORT, today))

    const mainAfter = await counts('main')
    expect(mainAfter).toEqual(mainBefore)
    expect(await studentDal.getMyRequest(a, mine!.id)).toBeNull()
    // Заявка второго набора на месте.
    const altAfter = await counts('test-alt')
    expect(altAfter.requests).toBe(altBefore.requests + 1)
    expect(await studentDal.getMyRequest(alt, theirs!.id)).not.toBeNull()

    // Уборка за собой: набор второго набора возвращается в исходное состояние.
    await withOwner((client) => seedCohort(client, ALT_COHORT, today))
    expect(await counts('test-alt')).toEqual(altBefore)
  })
})
