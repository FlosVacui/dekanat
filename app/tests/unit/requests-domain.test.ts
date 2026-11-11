import { describe, expect, it } from 'vitest'
import { addWorkingDays } from '@/lib/dates'
import {
  ALLOWED_FROM,
  REQUEST_STATUSES,
  computeDueDate,
  isAllowedTransition,
  nextStatuses,
  statusText,
} from '@/lib/requests'

// S-2.1, раздел 5: Подана -> В работе -> Готова -> Выдана; из «Подана» и «В работе» — в «Отклонена».
describe('переходы статусов заявки', () => {
  it('допустимые переходы — ровно те, что в разделе 5', () => {
    const allowed: [string, string][] = []
    for (const from of REQUEST_STATUSES) {
      for (const to of REQUEST_STATUSES) if (isAllowedTransition(from, to)) allowed.push([from, to])
    }
    expect(allowed.sort()).toEqual(
      [
        ['submitted', 'in_progress'],
        ['in_progress', 'ready'],
        ['ready', 'issued'],
        ['submitted', 'rejected'],
        ['in_progress', 'rejected'],
      ].sort(),
    )
    expect(ALLOWED_FROM.submitted).toEqual([])
  })

  it('кнопки сотрудника: следующий шаг и отклонение', () => {
    expect(nextStatuses('submitted')).toEqual(['in_progress', 'rejected'])
    expect(nextStatuses('ready')).toEqual(['issued'])
    expect(nextStatuses('issued')).toEqual([])
    expect(nextStatuses('rejected')).toEqual([])
  })
})

describe('тексты статусов и сроки', () => {
  it('рабочие дни не считают субботу и воскресенье', () => {
    // 2026-11-13 — пятница.
    expect(addWorkingDays('2026-11-13', 1)).toBe('2026-11-16')
    expect(addWorkingDays('2026-11-13', 10)).toBe('2026-11-27')
  })

  it('срок справки из деканата — два рабочих дня', () => {
    expect(computeDueDate('dean_certificate', '2026-11-12')).toBe('2026-11-16')
  })

  it('«Готова»: кабинет, дата и студенческий билет', () => {
    const text = statusText({
      kind: 'dean_certificate',
      status: 'ready',
      dueDate: null,
      pickupUntil: '2026-11-20',
      issuedOn: null,
      rejectReason: null,
    })
    expect(text).toContain('120а')
    expect(text).toContain('20.11.2026')
    expect(text).toContain('студенческий билет')
  })

  it('«Отклонена»: причина из списка и «Подать снова»', () => {
    const text = statusText({
      kind: 'dean_certificate',
      status: 'rejected',
      dueDate: null,
      pickupUntil: null,
      issuedOn: null,
      rejectReason: 'duplicate',
    })
    expect(text).toContain('Такая заявка уже подана')
  })
})
