import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { ALT_STUDENT, STAFF_ALT, STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor, withOwner } from './helpers'

let a: Actor
let b: Actor
let altStudent: Actor
let staff: Actor
let altStaff: Actor

beforeAll(async () => {
  ;[a, b, altStudent, staff, altStaff] = await Promise.all([
    actorFor(STUDENT_A),
    actorFor(STUDENT_B),
    actorFor(ALT_STUDENT),
    actorFor(STAFF_MAIN),
    actorFor(STAFF_ALT),
  ])
})
afterAll(closeDb)

async function newRequest(owner: Actor, kind: 'dean_certificate' | 'tuition_certificate' | 'financial_aid' = 'dean_certificate') {
  const created = await studentDal.createMyRequest(owner, { kind }, 'test')
  if (!created) throw new Error('заявка не создана')
  return created.id
}

describe('область сотрудника — набор (П-12, ADR-0002)', () => {
  it('сотрудник видит заявки студентов своего набора и не видит чужого набора', async () => {
    const mainId = await newRequest(a)
    const altId = await newRequest(altStudent)

    const mainList = await staffDal.listCohortRequests(staff)
    const altList = await staffDal.listCohortRequests(altStaff)
    expect(mainList.some((r) => r.id === mainId)).toBe(true)
    expect(mainList.some((r) => r.id === altId)).toBe(false)
    expect(altList.some((r) => r.id === altId)).toBe(true)
    expect(altList.some((r) => r.id === mainId)).toBe(false)
    expect(JSON.stringify(mainList)).not.toContain(ALT_STUDENT.fullName)
    expect(JSON.stringify(altList)).not.toContain(STUDENT_A.fullName)
    expect(JSON.stringify(altList)).not.toContain(STUDENT_B.fullName)
  })

  it('заявку чужого набора сотрудник не открывает: ответ как для несуществующей', async () => {
    const altId = await newRequest(altStudent)
    expect(await staffDal.getCohortRequest(staff, altId)).toBeNull()
    expect(await staffDal.getCohortRequest(staff, '00000000-0000-4000-8000-000000000000')).toBeNull()
    expect(await staffDal.getCohortRequest(altStaff, altId)).not.toBeNull()
  })

  it('заявку чужого набора сотрудник не меняет, и она не изменилась', async () => {
    const altId = await newRequest(altStudent)
    const foreign = await staffDal.changeRequestStatus(staff, altId, { target: 'in_progress' })
    const missing = await staffDal.changeRequestStatus(staff, '00000000-0000-4000-8000-000000000000', { target: 'in_progress' })
    expect(foreign).toEqual({ ok: false, reason: 'not_found' })
    expect(missing).toEqual(foreign)
    const after = await staffDal.getCohortRequest(altStaff, altId)
    expect(after?.status).toBe('submitted')
    const events = await withOwner((c) => c.query('select status from request_events where request_id = $1', [altId]))
    expect(events.rows.map((r) => r.status)).toEqual(['submitted'])
  })

  it('сотрудник видит ФИО и группу, но не оценки, расписание и профиль', async () => {
    const id = await newRequest(a)
    const detail = await staffDal.getCohortRequest(staff, id)
    expect(detail).toMatchObject({ studentName: STUDENT_A.fullName, groupName: 'Э-21-1' })
    const text = JSON.stringify(detail)
    for (const marker of [STUDENT_A.markers.schedule, STUDENT_A.markers.grades, STUDENT_A.markers.notifications]) {
      expect(text).not.toContain(marker)
    }
    expect(Object.keys(detail!).sort()).toEqual(
      ['createdAt', 'dueDate', 'events', 'groupName', 'id', 'issuedOn', 'kind', 'pickupUntil', 'rejectReason', 'status', 'studentName', 'updatedAt'].sort(),
    )
  })
})

describe('порядок переходов статуса (ПР-1)', () => {
  it('весь путь: Подана → В работе → Готова → Выдана; история и уведомление владельцу', async () => {
    const id = await newRequest(a, 'tuition_certificate')
    const before = await studentDal.countMyUnreadNotifications(a)
    const bBefore = await studentDal.countMyUnreadNotifications(b)

    expect(await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' })).toEqual({ ok: true, status: 'in_progress' })
    let detail = await studentDal.getMyRequest(a, id)
    expect(detail?.status).toBe('in_progress')
    expect(detail?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect((await staffDal.changeRequestStatus(staff, id, { target: 'ready' })).ok).toBe(true)
    detail = await studentDal.getMyRequest(a, id)
    expect(detail?.pickupUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect((await staffDal.changeRequestStatus(staff, id, { target: 'issued' })).ok).toBe(true)
    detail = await studentDal.getMyRequest(a, id)
    expect(detail?.status).toBe('issued')
    expect(detail?.issuedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(detail?.events.map((e) => e.status)).toEqual(['submitted', 'in_progress', 'ready', 'issued'])

    // Три смены — три уведомления владельцу и ни одного другому студенту.
    expect((await studentDal.countMyUnreadNotifications(a)) - before).toBe(3)
    expect(await studentDal.countMyUnreadNotifications(b)).toBe(bBefore)
  })

  it('недопустимый переход отклонён и ничего не меняет', async () => {
    const id = await newRequest(a)
    const jump = await staffDal.changeRequestStatus(staff, id, { target: 'ready' })
    expect(jump).toEqual({ ok: false, reason: 'invalid_transition' })
    expect(await staffDal.changeRequestStatus(staff, id, { target: 'issued' })).toEqual({ ok: false, reason: 'invalid_transition' })
    expect(await staffDal.changeRequestStatus(staff, id, { target: 'submitted' })).toEqual({ ok: false, reason: 'invalid_transition' })
    expect((await studentDal.getMyRequest(a, id))?.status).toBe('submitted')

    // Из «Готова» и «Выдана» отклонить нельзя.
    await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' })
    await staffDal.changeRequestStatus(staff, id, { target: 'ready' })
    expect(await staffDal.changeRequestStatus(staff, id, { target: 'rejected', reason: 'other' })).toEqual({
      ok: false,
      reason: 'invalid_transition',
    })
    expect((await studentDal.getMyRequest(a, id))?.status).toBe('ready')
  })

  it('значение статуса не из списка не принимается', async () => {
    const id = await newRequest(a)
    // @ts-expect-error — значение не из списка
    expect(await staffDal.changeRequestStatus(staff, id, { target: 'wow' })).toEqual({ ok: false, reason: 'invalid_input' })
    expect((await studentDal.getMyRequest(a, id))?.status).toBe('submitted')
  })

  it('отклонение требует причину из списка; причина видна студенту', async () => {
    const id = await newRequest(a)
    expect(await staffDal.changeRequestStatus(staff, id, { target: 'rejected' })).toEqual({ ok: false, reason: 'invalid_input' })
    expect(await staffDal.changeRequestStatus(staff, id, { target: 'rejected', reason: 'любой текст' })).toEqual({
      ok: false,
      reason: 'invalid_input',
    })
    expect((await staffDal.changeRequestStatus(staff, id, { target: 'rejected', reason: 'incomplete_data' })).ok).toBe(true)
    const detail = await studentDal.getMyRequest(a, id)
    expect(detail).toMatchObject({ status: 'rejected', rejectReason: 'incomplete_data' })
  })

  it('из двух одновременных одинаковых смен проходит одна', async () => {
    const id = await newRequest(a)
    const results = await Promise.all(Array.from({ length: 10 }, () => staffDal.changeRequestStatus(staff, id, { target: 'in_progress' })))
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.reason === 'invalid_transition')).toHaveLength(9)
    const events = await withOwner((c) => c.query('select status from request_events where request_id = $1 order by created_at', [id]))
    expect(events.rows.map((r) => r.status)).toEqual(['submitted', 'in_progress'])
  })

  it('одновременные «Выдана» и «Отклонена» из «Готова»: проходит только допустимая', async () => {
    const id = await newRequest(a)
    await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' })
    await staffDal.changeRequestStatus(staff, id, { target: 'ready' })
    const [issued, rejected] = await Promise.all([
      staffDal.changeRequestStatus(staff, id, { target: 'issued' }),
      staffDal.changeRequestStatus(staff, id, { target: 'rejected', reason: 'other' }),
    ])
    expect(issued.ok).toBe(true)
    expect(rejected.ok).toBe(false)
    expect((await studentDal.getMyRequest(a, id))?.status).toBe('issued')
  })

  it('одновременные «Готова» и «Отклонена» из «В работе»: заявка не уходит по запрещённому пути', async () => {
    // Оба перехода допустимы сами по себе, но после первого второй уже недопустим: «Готова» → «Отклонена» запрещён.
    for (let i = 0; i < 5; i += 1) {
      const id = await newRequest(a)
      await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' })
      const results = await Promise.all([
        staffDal.changeRequestStatus(staff, id, { target: 'ready' }),
        staffDal.changeRequestStatus(staff, id, { target: 'rejected', reason: 'other' }),
      ])
      const status = (await studentDal.getMyRequest(a, id))?.status
      const events = (await withOwner((c) => c.query('select status from request_events where request_id = $1 order by created_at', [id]))).rows.map((r) => r.status)
      // Допустимы два исхода: «Готова» и затем отказ нельзя, или «Отклонена» и затем «Готова» нельзя.
      expect(['ready', 'rejected']).toContain(status)
      expect(events.length).toBe(3)
      expect(events[0]).toBe('submitted')
      expect(events[1]).toBe('in_progress')
      expect(events[2]).toBe(status)
      expect(results.filter((r) => r.ok)).toHaveLength(1)
    }
  })
})
