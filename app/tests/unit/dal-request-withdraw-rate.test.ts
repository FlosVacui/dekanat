// Отзыв заявки и оценка выдачи (20.11), слой доступа студента: владелец из сессии, условие на статус в одном UPDATE,
// ограничение базы на оценку. База тестовая; заявки создаются настоящим путём слоя.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type Actor as ActorType } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor, freshIp, withOwner } from './helpers'

let a: ActorType
let b: ActorType
let staff: ActorType

beforeAll(async () => {
  ;[a, b, staff] = await Promise.all([actorFor(STUDENT_A), actorFor(STUDENT_B), actorFor(STAFF_MAIN)])
})
afterAll(closeDb)

const NOT_A_REQUEST = '00000000-0000-4000-8000-000000000000'

async function submitted(actor: ActorType): Promise<string> {
  const created = await studentDal.createMyRequest(actor, { kind: 'dean_certificate' }, freshIp())
  expect(created).not.toBeNull()
  return created!.id
}

async function issued(actor: ActorType): Promise<string> {
  const created = await studentDal.createMyReadyCertificate(actor, freshIp())
  expect(created).not.toBeNull()
  return created!.id
}

async function row(id: string) {
  return withOwner(async (c) => (await c.query('select status, reject_reason, rating, rated_at, updated_at from requests where id = $1', [id])).rows[0])
}

describe('отзыв заявки', () => {
  it('своя «Подана»: становится «Отклонена» с причиной withdrawn, в истории строка с пометкой и адресом', async () => {
    const id = await submitted(a)
    expect(await studentDal.withdrawMyRequest(a, id, '198.51.100.9')).toBe(true)
    expect(await row(id)).toMatchObject({ status: 'rejected', reject_reason: 'withdrawn' })
    const events = await withOwner(async (c) => (await c.query('select status, note, ip, by_user_id from request_events where request_id = $1 order by created_at', [id])).rows)
    expect(events.map((e) => e.status)).toEqual(['submitted', 'rejected'])
    expect(events[1]).toMatchObject({ note: 'withdrawn', ip: '198.51.100.9', by_user_id: a.userId })
    const detail = await studentDal.getMyRequest(a, id)
    expect(detail).toMatchObject({ status: 'rejected', rejectReason: 'withdrawn' })
  })

  it('повторный отзыв и отзыв после взятия в работу — false, статус не меняется', async () => {
    const id = await submitted(a)
    expect(await studentDal.withdrawMyRequest(a, id, freshIp())).toBe(true)
    expect(await studentDal.withdrawMyRequest(a, id, freshIp())).toBe(false)

    const taken = await submitted(a)
    const result = await staffDal.changeRequestStatus(staff, taken, { target: 'in_progress' }, freshIp())
    expect(result.ok).toBe(true)
    expect(await studentDal.withdrawMyRequest(a, taken, freshIp())).toBe(false)
    expect(await row(taken)).toMatchObject({ status: 'in_progress', reject_reason: null })
  })

  it('отозванную заявку деканат дальше не двигает', async () => {
    const id = await submitted(a)
    await studentDal.withdrawMyRequest(a, id, freshIp())
    const result = await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' }, freshIp())
    expect(result).toEqual({ ok: false, reason: 'invalid_transition' })
  })

  it('чужая, несуществующая и не-UUID — false, чужая остаётся «Подана»', async () => {
    const id = await submitted(b)
    expect(await studentDal.withdrawMyRequest(a, id, freshIp())).toBe(false)
    expect(await studentDal.withdrawMyRequest(a, NOT_A_REQUEST, freshIp())).toBe(false)
    expect(await studentDal.withdrawMyRequest(a, "1'; drop table requests; --", freshIp())).toBe(false)
    expect(await row(id)).toMatchObject({ status: 'submitted', reject_reason: null })
  })

  it('сотрудник отозвать заявку не может: отказ по роли', async () => {
    const id = await submitted(a)
    await expect(studentDal.withdrawMyRequest(staff, id, freshIp())).rejects.toBeInstanceOf(ForbiddenError)
    expect(await row(id)).toMatchObject({ status: 'submitted' })
  })
})

describe('оценка выдачи', () => {
  it('выданная заявка: 👍, затем смена на 👎; время оценки ставится, прочее не меняется', async () => {
    const id = await issued(a)
    const before = await row(id)
    expect(before).toMatchObject({ status: 'issued', rating: null, rated_at: null })
    expect(await studentDal.rateMyRequest(a, id, 1)).toBe(true)
    const up = await row(id)
    expect(up.rating).toBe(1)
    expect(up.rated_at).toBeInstanceOf(Date)
    expect(await studentDal.rateMyRequest(a, id, -1)).toBe(true)
    const down = await row(id)
    expect(down.rating).toBe(-1)
    expect(down.rated_at.getTime()).toBeGreaterThanOrEqual(up.rated_at.getTime())
    expect(down.updated_at).toEqual(before.updated_at)
    expect((await studentDal.getMyRequest(a, id))?.rating).toBe(-1)
    expect((await studentDal.listMyRequests(a)).find((r) => r.id === id)?.rating).toBe(-1)
  })

  it('не «Выдана» (подана, отозвана) — false, оценки нет', async () => {
    const id = await submitted(a)
    expect(await studentDal.rateMyRequest(a, id, 1)).toBe(false)
    await studentDal.withdrawMyRequest(a, id, freshIp())
    expect(await studentDal.rateMyRequest(a, id, 1)).toBe(false)
    expect(await row(id)).toMatchObject({ rating: null, rated_at: null })
  })

  it('значение не 1 и не -1, чужая заявка, несуществующая и не-UUID — false, оценка не меняется', async () => {
    const id = await issued(a)
    expect(await studentDal.rateMyRequest(a, id, 1)).toBe(true)
    for (const bad of [0, 2, 5, -2, 0.5, Number.NaN]) expect(await studentDal.rateMyRequest(a, id, bad), String(bad)).toBe(false)
    expect(await studentDal.rateMyRequest(b, id, -1)).toBe(false)
    expect(await studentDal.rateMyRequest(a, NOT_A_REQUEST, 1)).toBe(false)
    expect(await studentDal.rateMyRequest(a, 'не номер', 1)).toBe(false)
    expect((await row(id)).rating).toBe(1)
  })

  it('сотрудник оценку не ставит: отказ по роли', async () => {
    const id = await issued(a)
    await expect(studentDal.rateMyRequest(staff, id, 1)).rejects.toBeInstanceOf(ForbiddenError)
    expect((await row(id)).rating).toBeNull()
  })

  it('база сама не даёт оценку не у выданной заявки, значение вне {-1, 1} и оценку без времени', async () => {
    const pending = await submitted(a)
    const done = await issued(a)
    await withOwner(async (c) => {
      await expect(c.query('update requests set rating = 1, rated_at = now() where id = $1', [pending])).rejects.toThrow(/requests_rating_check/)
      await expect(c.query('update requests set rating = 3, rated_at = now() where id = $1', [done])).rejects.toThrow(/requests_rating_check/)
      await expect(c.query('update requests set rating = 1 where id = $1', [done])).rejects.toThrow(/requests_rating_check/)
    })
  })
})
