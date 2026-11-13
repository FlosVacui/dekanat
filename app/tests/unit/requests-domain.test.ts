import { describe, expect, it } from 'vitest'
import { addWorkingDays } from '@/lib/dates'
import {
  ALLOWED_FROM,
  REJECT_REASON_LABELS,
  REQUEST_KINDS,
  REQUEST_KIND_INFO,
  REQUEST_STATUSES,
  computeDueDate,
  isAllowedTransition,
  nextStatuses,
  statusText,
  type RequestKind,
  type RequestStatus,
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

// Решения пользователя 13.11.2026 (смена 14): задание B-3.4, раздел «Тексты — что меняется в statusText()».
describe('statusText: тексты по таблице задания 3.4', () => {
  const base = { dueDate: '2026-11-16', pickupUntil: '2026-11-17', issuedOn: '2026-11-14', rejectReason: null }
  const text = (kind: RequestKind, status: RequestStatus, over: { rejectReason?: string | null } = {}) =>
    statusText({ kind, status, ...base, ...over })

  it.each(REQUEST_KINDS)('«Подана», %s: «Пока ничего делать не нужно»', (kind) => {
    expect(text(kind, 'submitted')).toBe('Заявка у деканата. Пока ничего делать не нужно')
  })

  it.each(['dean_certificate', 'tuition_certificate'] as const)('«В работе», %s: «Пока ничего. Срок — до …»', (kind) => {
    expect(text(kind, 'in_progress')).toBe('Пока ничего. Срок — до 16.11.2026')
  })

  it('«В работе», материальная помощь: без изменений', () => {
    expect(text('financial_aid', 'in_progress')).toBe('Заявка согласована. Принесите оригиналы документов до 16.11.2026')
  })

  it.each([
    ['dean_certificate', '120а, 1 корпус'],
    ['tuition_certificate', '118, 1 корпус'],
  ] as const)('«Готова», %s: без изменений', (kind, room) => {
    expect(text(kind, 'ready')).toBe(`Получите и заверьте в деканате, кабинет ${room}, до 17.11.2026. Возьмите студенческий билет`)
  })

  it('«Готова», материальная помощь: решение комиссии, кабинет из REQUEST_KIND_INFO, срока нет', () => {
    const result = text('financial_aid', 'ready')
    expect(result).toBe('Комиссия рассмотрела заявление. Узнайте решение в деканате, кабинет 124, 1 корпус')
    expect(result).toContain(REQUEST_KIND_INFO.financial_aid.room)
    expect(result).not.toContain('17.11.2026')
  })

  it.each(['dean_certificate', 'tuition_certificate'] as const)('«Выдана», %s: без изменений', (kind) => {
    expect(text(kind, 'issued')).toBe('Вы получили документ 14.11.2026')
  })

  it('«Выдана», материальная помощь: «Заявление закрыто …»', () => {
    expect(text('financial_aid', 'issued')).toBe('Заявление закрыто 14.11.2026')
  })

  it.each(REQUEST_KINDS)('«Отклонена», причина other, %s: причину уточните в деканате', (kind) => {
    expect(text(kind, 'rejected', { rejectReason: 'other' })).toBe('Заявка отклонена. Причину уточните в деканате. Можно подать снова')
  })

  it('«Отклонена», остальные причины: без изменений; подпись причины other в списке сотрудника не меняется', () => {
    expect(text('dean_certificate', 'rejected', { rejectReason: 'incomplete_data' })).toBe(
      'Заявка отклонена. Причина: Не хватает данных. Можно подать снова',
    )
    expect(text('dean_certificate', 'rejected', { rejectReason: 'not_eligible' })).toBe(
      'Заявка отклонена. Причина: Нет оснований для выдачи. Можно подать снова',
    )
    expect(text('dean_certificate', 'rejected', { rejectReason: 'duplicate' })).toBe(
      'Заявка отклонена. Причина: Такая заявка уже подана. Можно подать снова',
    )
    expect(text('dean_certificate', 'rejected', { rejectReason: null })).toBe('Заявка отклонена. Причина: не указана. Можно подать снова')
    expect(REJECT_REASON_LABELS.other).toBe('Другая причина, уточните в деканате')
  })

  it('точки в конце нет ни у одного текста', () => {
    for (const kind of REQUEST_KINDS) {
      for (const status of REQUEST_STATUSES) expect(text(kind, status).endsWith('.'), `${status} × ${kind}`).toBe(false)
    }
  })
})
