// Раскладка экрана «Сегодня» (пакет 3.6, IMP-028): выдуманные даты и время, «сегодня» и «сейчас» приходят аргументами,
// поэтому тест не зависит от дня недели и часа запуска. База не нужна.
import { describe, expect, it } from 'vitest'
import type { ScheduleLesson } from '../../src/lib/schedule'
import { buildToday, dueChipText, lessonCountText, subtitleText, type TodayDueInput } from '../../src/lib/today'

// 2026-11-16 — понедельник; 2026-11-15 — воскресенье.
const TODAY = '2026-11-16'

function lesson(over: Partial<ScheduleLesson> & { id: string }): ScheduleLesson {
  return {
    date: TODAY,
    startsAt: '10:10',
    endsAt: '11:40',
    discipline: 'Математический анализ',
    kind: 'lecture',
    room: '314',
    teacher: 'Л. А. Примерова',
    change: null,
    ...over,
  }
}

function moved(over: Partial<ScheduleLesson> & { id: string; newDate: string; newStartsAt?: string; newEndsAt?: string }): ScheduleLesson {
  const { newDate, newStartsAt, newEndsAt, ...rest } = over
  return lesson({
    ...rest,
    change: { kind: 'moved', note: 'по просьбе кафедры', newDate, newStartsAt: newStartsAt ?? null, newEndsAt: newEndsAt ?? null, newRoom: null },
  })
}

const NO_DUE: TodayDueInput[] = []

describe('пары сегодня и перенос', () => {
  it('сегодня — день, на который пару перенесли с прошедшего дня: пара видна и считается', () => {
    const view = buildToday([moved({ id: 'm1', date: '2026-11-11', newDate: TODAY, newStartsAt: '12:00', newEndsAt: '13:30' })], NO_DUE, TODAY, '08:00')
    expect(view.todayCount).toBe(1)
    expect(view.next?.entry.lessonId).toBe('m1')
    expect(view.next?.entry.placement).toBe('moved_to')
    expect(`${view.next?.entry.startsAt}–${view.next?.entry.endsAt}`).toBe('12:00–13:30')
    expect(view.next?.kind).toBe('today')
    expect(view.subtitle).toBe('Понедельник, 16 ноября · 1 пара')
    // Перенос — изменение на сегодня: пара стоит и в списке изменений.
    expect(view.changes.map((c) => c.entry.lessonId)).toEqual(['m1'])
  })

  it('пара, перенесённая с сегодня на другой день, сегодня не считается и следующей не бывает', () => {
    const view = buildToday(
      [moved({ id: 'm2', newDate: '2026-11-18', newStartsAt: '09:00', newEndsAt: '10:30' })],
      NO_DUE,
      TODAY,
      '08:00',
    )
    expect(view.todayCount).toBe(0)
    expect(view.subtitle).toBe('Понедельник, 16 ноября · пар нет')
    // Следующая — новое место переноса, другой день; старое место в следующие не попадает.
    expect(view.next?.date).toBe('2026-11-18')
    expect(view.next?.entry.placement).toBe('moved_to')
    // Старое место — изменение на сегодня.
    expect(view.changes.map((c) => `${c.dayWord}:${c.entry.placement}`)).toEqual(['Сегодня:moved_from'])
  })

  it('отменённая пара следующей не бывает и не считается', () => {
    const cancelled = lesson({
      id: 'c1',
      startsAt: '09:00',
      endsAt: '10:30',
      change: { kind: 'cancelled', note: 'преподаватель в командировке', newDate: null, newStartsAt: null, newEndsAt: null, newRoom: null },
    })
    const regular = lesson({ id: 'r1', startsAt: '12:00', endsAt: '13:30' })
    const view = buildToday([cancelled, regular], NO_DUE, TODAY, '08:00')
    expect(view.todayCount).toBe(1)
    expect(view.next?.entry.lessonId).toBe('r1')
    expect(view.changes.map((c) => c.entry.lessonId)).toEqual(['c1'])
  })

  it('пара другого дня после отменённой сегодняшней: отменённая пропущена', () => {
    const cancelled = lesson({
      id: 'c2',
      change: { kind: 'cancelled', note: 'заметка', newDate: null, newStartsAt: null, newEndsAt: null, newRoom: null },
    })
    const tomorrow = lesson({ id: 't1', date: '2026-11-17', startsAt: '08:30', endsAt: '10:00' })
    const view = buildToday([cancelled, tomorrow], NO_DUE, TODAY, '07:00')
    expect(view.todayCount).toBe(0)
    expect(view.next?.entry.lessonId).toBe('t1')
    expect(view.next?.kind).toBe('other_day')
  })
})

describe('строка над временем и кнопка', () => {
  const morning = lesson({ id: 'a', startsAt: '10:10', endsAt: '11:40' })

  it('пара ещё не началась: «Следующая пара · сегодня», кнопка на сегодня', () => {
    const next = buildToday([morning], NO_DUE, TODAY, '09:00').next
    expect(next?.kind).toBe('today')
    expect(next?.eyebrow).toBe('Следующая пара · сегодня')
    expect(next?.buttonLabel).toBe('Расписание на сегодня')
    expect(next?.href).toBe('/schedule')
  })

  it('пара уже началась: «Идёт сейчас»; в минуту начала и за минуту до конца — тоже', () => {
    for (const now of ['10:10', '11:00', '11:39']) {
      const next = buildToday([morning], NO_DUE, TODAY, now).next
      expect(next?.kind, now).toBe('now')
      expect(next?.eyebrow, now).toBe('Идёт сейчас')
      expect(next?.href, now).toBe('/schedule')
    }
  })

  it('пара кончилась: следующая — другого дня, «Следующая пара · пт, 20 ноября», кнопка на этот день', () => {
    const friday = lesson({ id: 'f', date: '2026-11-20', startsAt: '08:30', endsAt: '10:00' })
    const view = buildToday([morning, friday], NO_DUE, TODAY, '11:40')
    expect(view.todayFinished).toBe(true)
    expect(view.todayCount).toBe(1)
    expect(view.next?.kind).toBe('other_day')
    expect(view.next?.eyebrow).toBe('Следующая пара · пт, 20 ноября')
    expect(view.next?.buttonLabel).toBe('Расписание на 20 ноября')
    expect(view.next?.href).toBe('/schedule?day=2026-11-20')
  })

  it('пар сегодня нет: следующая пара другого дня, «пар больше нет» не говорится', () => {
    const tuesday = lesson({ id: 'tu', date: '2026-11-17', startsAt: '08:30', endsAt: '10:00' })
    const view = buildToday([tuesday], NO_DUE, TODAY, '12:00')
    expect(view.todayCount).toBe(0)
    expect(view.todayFinished).toBe(false)
    expect(view.next?.eyebrow).toBe('Следующая пара · вт, 17 ноября')
    expect(view.next?.href).toBe('/schedule?day=2026-11-17')
  })

  it('пар нет совсем: следующей нет', () => {
    const view = buildToday([], NO_DUE, TODAY, '12:00')
    expect(view.next).toBeNull()
    expect(view.todayCount).toBe(0)
    expect(view.todayFinished).toBe(false)
    expect(view.changes).toEqual([])
    expect(view.due).toEqual([])
  })
})

describe('изменения на сегодня и завтра', () => {
  it('сегодня и завтра — в списке, послезавтра — нет; смена аудитории — с заметкой', () => {
    const room = lesson({
      id: 'rc',
      change: { kind: 'room_changed', note: '2-210 → 2-108', newDate: null, newStartsAt: null, newEndsAt: null, newRoom: '2-108' },
    })
    const tomorrow = lesson({
      id: 'tc',
      date: '2026-11-17',
      change: { kind: 'teacher_changed', note: 'Ведёт Яковлева А. С. вместо Мельник Д. О.', newDate: null, newStartsAt: null, newEndsAt: null, newRoom: null },
    })
    const dayAfter = lesson({
      id: 'dc',
      date: '2026-11-18',
      change: { kind: 'cancelled', note: 'заметка', newDate: null, newStartsAt: null, newEndsAt: null, newRoom: null },
    })
    const view = buildToday([room, tomorrow, dayAfter], NO_DUE, TODAY, '08:00')
    expect(view.changes.map((c) => `${c.dayWord}:${c.entry.lessonId}:${c.entry.changeKind}`)).toEqual([
      'Сегодня:rc:room_changed',
      'Завтра:tc:teacher_changed',
    ])
    expect(view.changes[0]?.entry.note).toBe('2-210 → 2-108')
  })
})

describe('сроки «что сдать»', () => {
  function work(id: string, daysAhead: number): TodayDueInput {
    const d = new Date(`${TODAY}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + daysAhead)
    return { id, disciplineId: `disc-${id}`, discipline: 'Физика', title: `Работа ${id}`, dueDate: d.toISOString().slice(0, 10) }
  }

  it('плашки 0, 1, 2, 5 и 6 дней', () => {
    const view = buildToday([], [work('w6', 6), work('w0', 0), work('w2', 2), work('w5', 5), work('w1', 1)], TODAY, '08:00')
    expect(view.due.map((r) => r.chip)).toEqual(['Сегодня', 'Завтра', 'Через 2 дня', 'Через 5 дней', 'Через 6 дней'])
    expect(view.due.map((r) => r.daysLeft)).toEqual([0, 1, 2, 5, 6])
    expect(view.due.map((r) => r.tone)).toEqual(['warn', 'warn', 'info', 'info', 'info'])
  })

  it('строка несёт номер дисциплины: по нему экран строит ссылку на дисциплину', () => {
    const view = buildToday([], [work('x', 3)], TODAY, '08:00')
    expect(view.due).toHaveLength(1)
    expect(view.due[0]?.disciplineId).toBe('disc-x')
  })

  it('склонение «дня» и «дней»', () => {
    expect(dueChipText(2)).toBe('Через 2 дня')
    expect(dueChipText(4)).toBe('Через 4 дня')
    expect(dueChipText(5)).toBe('Через 5 дней')
    expect(dueChipText(11)).toBe('Через 11 дней')
    expect(dueChipText(21)).toBe('Через 21 день')
  })
})

describe('подзаголовок', () => {
  it('пар нет, одна, три, пять', () => {
    expect(lessonCountText(0)).toBe('пар нет')
    expect(lessonCountText(1)).toBe('1 пара')
    expect(lessonCountText(3)).toBe('3 пары')
    expect(lessonCountText(5)).toBe('5 пар')
    expect(lessonCountText(11)).toBe('11 пар')
  })

  it('день недели с большой буквы, дата, число пар — на любой день', () => {
    expect(subtitleText('2026-11-15', 0)).toBe('Воскресенье, 15 ноября · пар нет')
    expect(subtitleText('2026-11-16', 3)).toBe('Понедельник, 16 ноября · 3 пары')
  })
})
