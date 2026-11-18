// Числа плиток на «Сегодня» (макет М5): заявки в работе и сборка четырёх чисел. База не нужна, «сегодня» — аргумент.
import { describe, expect, it } from 'vitest'
import { REQUEST_STATUSES } from '../../src/lib/requests'
import { buildTiles, buildToday, countRequestsInWork, type TodayDueInput } from '../../src/lib/today'

const TODAY = '2026-11-16'

describe('заявки в работе: «Подана» и «В работе»', () => {
  it('считает по статусам: все пять статусов по одной заявке — две в работе', () => {
    expect([...REQUEST_STATUSES].sort()).toEqual(['in_progress', 'issued', 'ready', 'rejected', 'submitted'])
    expect(countRequestsInWork(REQUEST_STATUSES.map((status) => ({ status })))).toBe(2)
  })

  it('каждый статус отдельно', () => {
    expect(countRequestsInWork([{ status: 'submitted' }])).toBe(1)
    expect(countRequestsInWork([{ status: 'in_progress' }])).toBe(1)
    expect(countRequestsInWork([{ status: 'ready' }])).toBe(0)
    expect(countRequestsInWork([{ status: 'issued' }])).toBe(0)
    expect(countRequestsInWork([{ status: 'rejected' }])).toBe(0)
  })

  it('несколько заявок одного статуса считаются все; неизвестный статус не считается', () => {
    expect(countRequestsInWork([{ status: 'submitted' }, { status: 'submitted' }, { status: 'in_progress' }, { status: 'weird' }])).toBe(3)
  })

  it('заявок нет — ноль', () => {
    expect(countRequestsInWork([])).toBe(0)
  })
})

describe('плитки: четыре числа', () => {
  const due: TodayDueInput[] = [
    { id: 'w1', disciplineId: 'd1', discipline: 'Физика', title: 'Лабораторная 1', dueDate: '2026-11-17' },
    { id: 'w2', disciplineId: 'd1', discipline: 'Физика', title: 'Лабораторная 2', dueDate: '2026-11-20' },
  ]

  it('пары сегодня и «сдать» — из раскладки, заявки — свой счёт, уведомления — число колокольчика', () => {
    const view = buildToday(
      [{ id: 'l1', date: TODAY, startsAt: '10:10', endsAt: '11:40', discipline: 'Физика', kind: 'lecture', room: '207', teacher: 'Тестов С. В.', change: null }],
      due,
      TODAY,
      '08:00',
    )
    expect(buildTiles(view, [{ status: 'submitted' }, { status: 'ready' }], 4)).toEqual({ lessons: 1, due: 2, requests: 1, unread: 4 })
  })

  it('ничего нет — везде ноль', () => {
    const view = buildToday([], [], TODAY, '08:00')
    expect(buildTiles(view, [], 0)).toEqual({ lessons: 0, due: 0, requests: 0, unread: 0 })
  })
})
