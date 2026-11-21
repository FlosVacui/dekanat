// Отозванная заявка и оценка выдачи (20.11): слова экрана, шаги и разбор значения кнопки. Чистые функции, базы нет.
import { describe, expect, it } from 'vitest'
import { RATING_DOWN, RATING_UP, parseRatingChoice, ratingFromDb } from '../../src/components/requests/rating'
import { WITHDRAWN_REASON, isWithdrawn, requestStatusText, requestSteps } from '../../src/components/requests/withdrawn'
import { REJECT_REASONS, statusText } from '../../src/lib/requests'

const base = { kind: 'dean_certificate' as const, dueDate: null, pickupUntil: null, issuedOn: null }

describe('отозванная заявка', () => {
  it('«Отклонена» с причиной withdrawn — отозвана; с причиной из списка деканата и другие статусы — нет', () => {
    expect(isWithdrawn({ status: 'rejected', rejectReason: WITHDRAWN_REASON })).toBe(true)
    expect(isWithdrawn({ status: 'rejected', rejectReason: 'duplicate' })).toBe(false)
    expect(isWithdrawn({ status: 'submitted', rejectReason: WITHDRAWN_REASON })).toBe(false)
    expect(isWithdrawn({ status: 'rejected', rejectReason: null })).toBe(false)
  })

  it('причины withdrawn нет в списке сотрудника: деканат «отозвать» не выберет', () => {
    expect((REJECT_REASONS as readonly string[]).includes(WITHDRAWN_REASON)).toBe(false)
  })

  it('текст «что дальше»: у отозванной свой, у отклонённой деканатом и у прочих — прежний', () => {
    const withdrawn = requestStatusText({ ...base, status: 'rejected', rejectReason: WITHDRAWN_REASON })
    expect(withdrawn).toBe('Вы отозвали заявку, деканат её не рассматривает. Можно подать снова')
    expect(withdrawn).not.toContain('Причина')
    const rejected = { ...base, status: 'rejected' as const, rejectReason: 'duplicate' }
    expect(requestStatusText(rejected)).toBe(statusText(rejected))
    const submitted = { ...base, status: 'submitted' as const, rejectReason: null }
    expect(requestStatusText(submitted)).toBe(statusText(submitted))
  })

  it('шаги: последний шаг отозванной — «Отозвана вами», не «ОТКЛОНЕНО»; у отклонённой деканатом — как было', () => {
    const at = new Date('2026-11-20T09:00:00Z')
    const input = { kind: 'dean_certificate' as const, status: 'rejected' as const, events: [{ status: 'submitted', createdAt: at }, { status: 'rejected', createdAt: at }], createdAt: at, dueDate: null, pickupUntil: null, issuedOn: null, timezone: 'Europe/Moscow' }
    const withdrawn = requestSteps({ ...input, rejectReason: WITHDRAWN_REASON })
    expect(withdrawn.map((s) => s.title)).toEqual(['Подана', 'Отозвана вами'])
    expect(withdrawn.at(-1)).toMatchObject({ state: 'done', current: true })
    const rejected = requestSteps({ ...input, rejectReason: 'other' })
    expect(rejected.at(-1)).toMatchObject({ title: 'Отклонена', state: 'rejected' })
  })
})

describe('оценка выдачи', () => {
  it('кнопки: «up» — 1, «down» — -1; всё остальное, в том числе числа, — null', () => {
    expect(parseRatingChoice('up')).toBe(RATING_UP)
    expect(parseRatingChoice('down')).toBe(RATING_DOWN)
    for (const bad of ['1', '-1', 1, -1, 'UP', '', null, undefined, ['up'], 'up ']) expect(parseRatingChoice(bad), String(bad)).toBeNull()
  })

  it('из базы: только 1 и -1', () => {
    expect(ratingFromDb(1)).toBe(1)
    expect(ratingFromDb(-1)).toBe(-1)
    expect(ratingFromDb(null)).toBeNull()
    expect(ratingFromDb(0)).toBeNull()
    expect(ratingFromDb(5)).toBeNull()
  })
})
