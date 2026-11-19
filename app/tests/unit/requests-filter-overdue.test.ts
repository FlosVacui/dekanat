// Фильтр «Требуют ответа» в списке студента и просрочка в списке сотрудника.
import { describe, expect, it } from 'vitest'
import {
  filterRequests,
  matchesRequestFilter,
  needsStudentAction,
  overdueDays,
  overdueLabel,
  parseRequestFilter,
  sortOverdueFirst,
  REQUEST_STATUSES,
} from '@/lib/requests'

const items = REQUEST_STATUSES.map((status) => ({ id: status, status }))

describe('parseRequestFilter', () => {
  it('известные значения проходят, остальное — «Все»', () => {
    expect(parseRequestFilter('action')).toBe('action')
    expect(parseRequestFilter('active')).toBe('active')
    expect(parseRequestFilter('ready')).toBe('ready')
    expect(parseRequestFilter('all')).toBe('all')
    for (const bad of [undefined, '', 'ACTION', 'x', ['action'], 7, null]) expect(parseRequestFilter(bad)).toBe('all')
  })
})

describe('filterRequests', () => {
  const ids = (f: Parameters<typeof filterRequests>[1]) => filterRequests(items, f).map((i) => i.status)
  it('«Все» — всё', () => expect(ids('all')).toEqual([...REQUEST_STATUSES]))
  it('«В работе» — подана и в работе', () => expect(ids('active')).toEqual(['submitted', 'in_progress']))
  it('«Требуют ответа» — готова и отклонена', () => expect(ids('action')).toEqual(['ready', 'rejected']))
  it('«Готовы» — только готова', () => expect(ids('ready')).toEqual(['ready']))
  it('неизвестный статус не попадает никуда, кроме «Все»', () => {
    expect(needsStudentAction('weird')).toBe(false)
    expect(matchesRequestFilter('weird', 'active')).toBe(false)
    expect(matchesRequestFilter('weird', 'all')).toBe(true)
  })
  it('выданная заявка ответа не требует', () => expect(needsStudentAction('issued')).toBe(false))
})

describe('overdueDays', () => {
  it('в работе и срок прошёл — число дней', () => {
    expect(overdueDays('2026-11-16', 'in_progress', '2026-11-19')).toBe(3)
    expect(overdueDays('2026-11-18', 'in_progress', '2026-11-19')).toBe(1)
  })
  it('срок сегодня и позже — не просрочена', () => {
    expect(overdueDays('2026-11-19', 'in_progress', '2026-11-19')).toBe(0)
    expect(overdueDays('2026-11-25', 'in_progress', '2026-11-19')).toBe(0)
  })
  it('другой статус или нет срока — не просрочена', () => {
    expect(overdueDays('2026-11-01', 'ready', '2026-11-19')).toBe(0)
    expect(overdueDays('2026-11-01', 'submitted', '2026-11-19')).toBe(0)
    expect(overdueDays(null, 'in_progress', '2026-11-19')).toBe(0)
  })
  it('граница месяца и года', () => {
    expect(overdueDays('2026-12-30', 'in_progress', '2027-01-02')).toBe(3)
  })
  it('подпись', () => expect(overdueLabel(3)).toBe('Просрочена на 3 дн.'))
})

describe('sortOverdueFirst', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
  it('просроченные первыми, по убыванию просрочки; остальные в прежнем порядке', () => {
    const days = new Map([
      ['c', 2],
      ['e', 5],
    ])
    expect(sortOverdueFirst(list, days).map((i) => i.id)).toEqual(['e', 'c', 'a', 'b', 'd'])
  })
  it('равная просрочка — прежний порядок', () => {
    const days = new Map([
      ['d', 1],
      ['b', 1],
    ])
    expect(sortOverdueFirst(list, days).map((i) => i.id)).toEqual(['b', 'd', 'a', 'c', 'e'])
  })
  it('просроченных нет — порядок не меняется, исходный массив цел', () => {
    const copy = [...list]
    expect(sortOverdueFirst(list, new Map())).toEqual(list)
    expect(list).toEqual(copy)
  })
})
