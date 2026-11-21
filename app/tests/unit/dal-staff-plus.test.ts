// 20.11, деканат: стипендии набора, рейтинг и фото студента для сотрудника, снятие объявления, оценки выдачи, статусы для пачки.
// Граница везде одна — набор из сессии (ADR-0002): чужой набор и несуществующий номер дают одинаковый отказ.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evaluateScholarship, SCHOLARSHIP_ORDER } from '@/lib/scholarship'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { ALT_STUDENT, STAFF_ALT, STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor, withOwner } from './helpers'

const TAG = 'Деканат-тест'
const ZERO = '00000000-0000-4000-8000-000000000000'
// Минимальный допустимый PNG (сигнатура и пустой кусок): слой доступа тут только читает, проверка базы — тип и размер.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63000100000005000100', 'hex')

let a: Actor
let b: Actor
let altStudent: Actor
let staff: Actor
let altStaff: Actor
const createdRequests: string[] = []

beforeAll(async () => {
  ;[a, b, altStudent, staff, altStaff] = await Promise.all([
    actorFor(STUDENT_A),
    actorFor(STUDENT_B),
    actorFor(ALT_STUDENT),
    actorFor(STAFF_MAIN),
    actorFor(STAFF_ALT),
  ])
})

afterAll(async () => {
  await withOwner(async (c) => {
    await c.query(`delete from announcements where title like $1`, [`${TAG}%`])
    await c.query(`delete from user_avatars where user_id = $1`, [a.userId])
    await c.query(`delete from notifications where link = any($1::text[])`, [createdRequests.map((id) => `/requests/${id}`)])
    await c.query(`delete from requests where id = any($1::uuid[])`, [createdRequests])
  })
  await closeDb()
})

describe('роль: функции деканата только для сотрудника', () => {
  it('студент получает отказ, а не пустой ответ', async () => {
    await expect(staffDal.listCohortScholarships(a)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.getCohortStudentScholarship(a, a.userId)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.getCohortStudentRating(a, a.userId)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.cohortStudentHasAvatar(a, a.userId)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.getCohortStudentAvatar(a, a.userId)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.canRemoveAnnouncements(a)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.removeCohortAnnouncement(a, ZERO)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.getCohortRequestStatuses(a, [ZERO])).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.getCohortRequestRatings(a, 30)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('стипендии набора', () => {
  it('список — студенты своего набора (с одногруппниками), чужого набора нет', async () => {
    const list = await staffDal.listCohortScholarships(staff)
    const students = await staffDal.listCohortStudents(staff)
    expect(list.map((r) => r.id).sort()).toEqual(students.map((s) => s.id).sort())
    expect(list.length).toBeGreaterThan(2)
    expect(list.map((r) => r.id)).not.toContain(altStudent.userId)
    expect((await staffDal.listCohortScholarships(altStaff)).map((r) => r.id)).toEqual([altStudent.userId])
    expect(JSON.stringify(list)).not.toContain(ALT_STUDENT.fullName)
  })

  it('статус студента тот же, что считает та же функция по его собственным оценкам; сумма — по приказу', async () => {
    const list = await staffDal.listCohortScholarships(staff)
    for (const [actor, account] of [[a, STUDENT_A], [b, STUDENT_B]] as const) {
      const own = evaluateScholarship({ grades: await studentDal.listMyGrades(actor, '2026-11-20') })
      const row = list.find((r) => r.id === actor.userId)!
      expect(row.fullName).toBe(account.fullName)
      expect(row.status).toEqual(own)
      expect(row.amount).toBe(own.kind === 'academic' ? SCHOLARSHIP_ORDER.academic : 0)
    }
    // Все строки: назначена — сумма из приказа, иначе ноль.
    for (const r of list) expect(r.amount).toBe(r.status.kind === 'academic' ? SCHOLARSHIP_ORDER.academic : 0)
  })

  it('карточка: тот же результат, что в списке; чужой набор, сотрудник, мусор и несуществующий номер — null', async () => {
    const list = await staffDal.listCohortScholarships(staff)
    expect(await staffDal.getCohortStudentScholarship(staff, a.userId)).toEqual(list.find((r) => r.id === a.userId))
    expect(await staffDal.getCohortStudentScholarship(staff, altStudent.userId)).toBeNull()
    expect(await staffDal.getCohortStudentScholarship(altStaff, a.userId)).toBeNull()
    expect(await staffDal.getCohortStudentScholarship(staff, staff.userId)).toBeNull()
    expect(await staffDal.getCohortStudentScholarship(staff, ZERO)).toBeNull()
    expect(await staffDal.getCohortStudentScholarship(staff, "'; drop table users; --")).toBeNull()
  })
})

describe('рейтинг студента для сотрудника', () => {
  it('совпадает с рейтингом, который студент видит у себя; чужой набор и мусор — null', async () => {
    for (const actor of [a, b, altStudent]) {
      const own = await studentDal.getMyRating(actor)
      const viaStaff = await staffDal.getCohortStudentRating(actor.userId === altStudent.userId ? altStaff : staff, actor.userId)
      expect(viaStaff).toEqual(own)
    }
    expect(await staffDal.getCohortStudentRating(staff, altStudent.userId)).toBeNull()
    expect(await staffDal.getCohortStudentRating(altStaff, a.userId)).toBeNull()
    expect(await staffDal.getCohortStudentRating(staff, staff.userId)).toBeNull()
    expect(await staffDal.getCohortStudentRating(staff, ZERO)).toBeNull()
    expect(await staffDal.getCohortStudentRating(staff, 'не-номер')).toBeNull()
  })
})

describe('фото студента для сотрудника', () => {
  it('своему набору отдаётся, чужому — нет; без фото — null', async () => {
    expect(await staffDal.cohortStudentHasAvatar(staff, a.userId)).toBe(false)
    expect(await staffDal.getCohortStudentAvatar(staff, a.userId)).toBeNull()
    await withOwner((c) => c.query(`insert into user_avatars (user_id, mime, data) values ($1, 'image/png', $2) on conflict (user_id) do update set data = excluded.data`, [a.userId, PNG]))
    expect(await staffDal.cohortStudentHasAvatar(staff, a.userId)).toBe(true)
    const photo = await staffDal.getCohortStudentAvatar(staff, a.userId)
    expect(photo?.mime).toBe('image/png')
    expect(Buffer.compare(photo!.data, PNG)).toBe(0)
    // Чужой набор, несуществующий номер и мусор — тот же ответ, что «нет фото».
    expect(await staffDal.cohortStudentHasAvatar(altStaff, a.userId)).toBe(false)
    expect(await staffDal.getCohortStudentAvatar(altStaff, a.userId)).toBeNull()
    expect(await staffDal.getCohortStudentAvatar(staff, ZERO)).toBeNull()
    expect(await staffDal.getCohortStudentAvatar(staff, 'x')).toBeNull()
    await withOwner((c) => c.query(`delete from user_avatars where user_id = $1`, [a.userId]))
  })
})

async function insertAnnouncement(owner: 'group' | 'alt-group', title: string): Promise<string> {
  const groupName = owner === 'group' ? 'ЦЭ-24-03' : 'ТЕСТ-Г-9'
  const res = await withOwner((c) =>
    c.query(`insert into announcements (group_id, title, body) select id, $2, 'Текст' from groups where name = $1 limit 1 returning id`, [groupName, title]),
  )
  return res.rows[0].id as string
}

describe('снять объявление', () => {
  it('право удаления выдано ролью приложения (GRANT DELETE в migrate-lib)', async () => {
    expect(await staffDal.canRemoveAnnouncements(staff)).toBe(true)
  })

  it('своё объявление снимается; чужого набора, мусор и несуществующий номер — одинаковый отказ, запись цела', async () => {
    const own = await insertAnnouncement('group', `${TAG}: своё`)
    const foreign = await insertAnnouncement('alt-group', `${TAG}: чужое`)
    // Сотрудник другого набора чужое (своей группы) не снимает.
    expect(await staffDal.removeCohortAnnouncement(altStaff, own)).toEqual({ ok: false, reason: 'not_found' })
    expect(await staffDal.removeCohortAnnouncement(staff, foreign)).toEqual({ ok: false, reason: 'not_found' })
    expect(await staffDal.removeCohortAnnouncement(staff, ZERO)).toEqual({ ok: false, reason: 'not_found' })
    expect(await staffDal.removeCohortAnnouncement(staff, "1' or '1'='1")).toEqual({ ok: false, reason: 'not_found' })
    const left = await withOwner((c) => c.query(`select id from announcements where id = any($1::uuid[])`, [[own, foreign]]))
    expect(left.rows.map((r) => r.id).sort()).toEqual([own, foreign].sort())

    expect(await staffDal.removeCohortAnnouncement(staff, own)).toEqual({ ok: true })
    const after = await withOwner((c) => c.query(`select id from announcements where id = any($1::uuid[])`, [[own, foreign]]))
    expect(after.rows.map((r) => r.id)).toEqual([foreign])
    // Повторно — уже нет.
    expect(await staffDal.removeCohortAnnouncement(staff, own)).toEqual({ ok: false, reason: 'not_found' })
    expect(await staffDal.removeCohortAnnouncement(altStaff, foreign)).toEqual({ ok: true })
  })

  it('отметки о прочтении уходят вместе с объявлением', async () => {
    const id = await insertAnnouncement('group', `${TAG}: прочитано`)
    await withOwner((c) => c.query(`insert into announcement_reads (announcement_id, student_id) values ($1, $2)`, [id, a.userId]))
    expect(await staffDal.removeCohortAnnouncement(staff, id)).toEqual({ ok: true })
    const reads = await withOwner((c) => c.query(`select 1 from announcement_reads where announcement_id = $1`, [id]))
    expect(reads.rowCount).toBe(0)
  })
})

describe('статусы заявок для пачки', () => {
  it('отдаются только заявки своего набора; чужие, мусор и повторы отбрасываются', async () => {
    const mine = await studentDal.createMyRequest(a, { kind: 'financial_aid' }, 'dekanat-test-1')
    const alt = await studentDal.createMyRequest(altStudent, { kind: 'financial_aid' }, 'dekanat-test-2')
    createdRequests.push(mine!.id, alt!.id)
    const map = await staffDal.getCohortRequestStatuses(staff, [mine!.id, mine!.id, alt!.id, ZERO, 'мусор', ''])
    expect([...map.entries()]).toEqual([[mine!.id, 'submitted']])
    expect((await staffDal.getCohortRequestStatuses(staff, [])).size).toBe(0)
    expect((await staffDal.getCohortRequestStatuses(altStaff, [mine!.id])).size).toBe(0)
  })
})

describe('оценки выдачи за окно', () => {
  it('считаются только оценки своего набора внутри окна; в ответе одни числа', async () => {
    const before = await staffDal.getCohortRequestRatings(staff, 30)
    const altBefore = await staffDal.getCohortRequestRatings(altStaff, 30)
    const [up, down, old, foreign] = await Promise.all([
      studentDal.createMyRequest(a, { kind: 'financial_aid' }, 'dekanat-test-3'),
      studentDal.createMyRequest(b, { kind: 'financial_aid' }, 'dekanat-test-4'),
      studentDal.createMyRequest(a, { kind: 'financial_aid' }, 'dekanat-test-5'),
      studentDal.createMyRequest(altStudent, { kind: 'financial_aid' }, 'dekanat-test-6'),
    ])
    createdRequests.push(up!.id, down!.id, old!.id, foreign!.id)
    await withOwner(async (c) => {
      const rate = (id: string, rating: number, ago: string) =>
        c.query(`update requests set status = 'issued', issued_on = current_date, rating = $2, rated_at = now() - $3::interval where id = $1`, [id, rating, ago])
      await rate(up!.id, 1, '1 day')
      await rate(down!.id, -1, '2 days')
      await rate(old!.id, 1, '40 days')
      await rate(foreign!.id, 1, '1 day')
    })
    const after = await staffDal.getCohortRequestRatings(staff, 30)
    expect(after).toEqual({ up: before.up + 1, down: before.down + 1 })
    expect(await staffDal.getCohortRequestRatings(altStaff, 30)).toEqual({ up: altBefore.up + 1, down: altBefore.down })
    // Окно шире — старая оценка входит; бессмысленное окно приводится к границам.
    expect((await staffDal.getCohortRequestRatings(staff, 60)).up).toBe(after.up + 1)
    expect(await staffDal.getCohortRequestRatings(staff, -5)).toEqual(await staffDal.getCohortRequestRatings(staff, 1))
    expect(Object.keys(after).sort()).toEqual(['down', 'up'])
  })
})
