// Пакет 3.2: чистая функция раскладки расписания по семи дням. База не нужна.
import { describe, expect, it } from 'vitest'
import { SCHEDULE_DAYS, buildSchedule, pickDay, pickView, roomChangeText, teacherChangeText, type ScheduleLesson } from '../../src/lib/schedule'

// Понедельник 16.11.2026 — «сегодня» во всех проверках.
const TODAY = '2026-11-16'

function lesson(over: Partial<ScheduleLesson> & Pick<ScheduleLesson, 'id' | 'date' | 'startsAt' | 'endsAt'>): ScheduleLesson {
  return { discipline: 'Микроэкономика', kind: 'seminar', room: '1-204', teacher: 'Петров А. А.', change: null, ...over }
}

function change(kind: string, over: Partial<NonNullable<ScheduleLesson['change']>> = {}): NonNullable<ScheduleLesson['change']> {
  return { kind, note: 'заметка', newDate: null, newStartsAt: null, newEndsAt: null, newRoom: null, ...over }
}

describe('раскладка по семи дням', () => {
  it('семь дней с сегодняшнего: день недели, число, признак «сегодня»', () => {
    const days = buildSchedule([], TODAY)
    expect(days).toHaveLength(SCHEDULE_DAYS)
    expect(days.map((d) => d.date)).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ])
    expect(days.map((d) => d.weekday)).toEqual(['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'])
    expect(days.map((d) => d.dayOfMonth)).toEqual([16, 17, 18, 19, 20, 21, 22])
    expect(days[0]).toMatchObject({ isToday: true, dayMonth: '16 ноября' })
    expect(days.slice(1).every((d) => !d.isToday)).toBe(true)
  })

  it('пустой день: пар нет, изменений нет, число пар — ноль', () => {
    const days = buildSchedule([lesson({ id: 'a', date: '2026-11-17', startsAt: '10:15', endsAt: '11:45' })], TODAY)
    expect(days[0]).toMatchObject({ entries: [], lessonCount: 0, hasChanges: false })
    expect(days[1]).toMatchObject({ lessonCount: 1, hasChanges: false })
  })

  it('пары вне семи дней отбрасываются', () => {
    const days = buildSchedule(
      [
        lesson({ id: 'before', date: '2026-11-15', startsAt: '10:15', endsAt: '11:45' }),
        lesson({ id: 'after', date: '2026-11-23', startsAt: '10:15', endsAt: '11:45' }),
      ],
      TODAY,
    )
    expect(days.flatMap((d) => d.entries)).toEqual([])
  })

  it('порядок внутри дня — по времени, а не по порядку во входе', () => {
    const days = buildSchedule(
      [
        lesson({ id: 'c', date: TODAY, startsAt: '15:45', endsAt: '17:15', discipline: 'В' }),
        lesson({ id: 'a', date: TODAY, startsAt: '08:30', endsAt: '10:00', discipline: 'Б' }),
        lesson({ id: 'b', date: TODAY, startsAt: '12:00', endsAt: '13:30', discipline: 'А' }),
      ],
      TODAY,
    )
    expect(days[0]!.entries.map((e) => e.lessonId)).toEqual(['a', 'b', 'c'])
    expect(days[0]!.lessonCount).toBe(3)
  })

  it('пара без изменения: плашки, «Было» и заметки нет', () => {
    const [day] = buildSchedule([lesson({ id: 'a', date: TODAY, startsAt: '10:15', endsAt: '11:45' })], TODAY)
    expect(day!.entries[0]).toMatchObject({
      placement: 'regular',
      changeKind: null,
      cancelled: false,
      badge: null,
      movedTo: null,
      was: null,
      note: null,
      room: '1-204',
      teacher: 'Петров А. А.',
    })
  })
})

describe('отмена', () => {
  const days = buildSchedule(
    [
      lesson({ id: 'ok', date: '2026-11-20', startsAt: '10:15', endsAt: '11:45' }),
      lesson({
        id: 'x',
        date: '2026-11-20',
        startsAt: '12:00',
        endsAt: '13:30',
        change: change('cancelled', { note: 'преподаватель в командировке' }),
      }),
    ],
    TODAY,
  )

  it('остаётся на своём месте с пометкой', () => {
    const entries = days[4]!.entries
    expect(entries.map((e) => e.lessonId)).toEqual(['ok', 'x'])
    expect(entries[1]).toMatchObject({
      placement: 'regular',
      changeKind: 'cancelled',
      cancelled: true,
      badge: 'Отмена',
      startsAt: '12:00',
      note: 'преподаватель в командировке',
    })
  })

  it('день отмечен «есть изменения», а число пар — без отменённой', () => {
    expect(days[4]).toMatchObject({ hasChanges: true, lessonCount: 1 })
    expect(days[3]).toMatchObject({ hasChanges: false })
  })
})

describe('перенос внутри дня', () => {
  const days = buildSchedule(
    [
      lesson({ id: 'first', date: '2026-11-18', startsAt: '08:30', endsAt: '10:00', discipline: 'Первая' }),
      lesson({
        id: 'm',
        date: '2026-11-18',
        startsAt: '10:15',
        endsAt: '11:45',
        change: change('moved', { newStartsAt: '15:45', newEndsAt: '17:15' }),
      }),
      lesson({ id: 'last', date: '2026-11-18', startsAt: '12:00', endsAt: '13:30', discipline: 'Последняя' }),
    ],
    TODAY,
  )
  const entries = days[2]!.entries

  it('стоит дважды: на старом месте и на новом, порядок — по времени с учётом нового', () => {
    expect(entries.map((e) => `${e.lessonId}:${e.placement}`)).toEqual(['first:regular', 'm:moved_from', 'last:regular', 'm:moved_to'])
  })

  it('на старом месте — «Перенесена на …», прежнее время', () => {
    expect(entries[1]).toMatchObject({
      badge: 'Перенос',
      startsAt: '10:15',
      endsAt: '11:45',
      movedTo: 'Перенесена на 15:45–17:15, ауд. 1-204',
      was: null,
    })
  })

  it('на новом месте — новое время и «Было: …», аудитория та же и не повторяется', () => {
    expect(entries[3]).toMatchObject({
      badge: 'Перенос',
      startsAt: '15:45',
      endsAt: '17:15',
      room: '1-204',
      movedTo: null,
      was: 'Было: 10:15–11:45',
    })
  })

  it('число пар — три: старое место не считается', () => {
    expect(days[2]).toMatchObject({ lessonCount: 3, hasChanges: true })
  })

  it('ключи записей не повторяются', () => {
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length)
  })
})

describe('перенос на другой день', () => {
  const days = buildSchedule(
    [
      lesson({
        id: 'm',
        date: '2026-11-19',
        startsAt: '12:00',
        endsAt: '13:30',
        room: '2-210',
        change: change('moved', { newDate: '2026-11-21', newStartsAt: '10:15', newEndsAt: '11:45', newRoom: '2-214' }),
      }),
    ],
    TODAY,
  )

  it('на старом дне — пометка с новой датой, временем и аудиторией', () => {
    expect(days[3]!.entries).toHaveLength(1)
    expect(days[3]!.entries[0]).toMatchObject({
      placement: 'moved_from',
      startsAt: '12:00',
      room: '2-210',
      movedTo: 'Перенесена на сб, 21 ноября, 10:15–11:45, ауд. 2-214',
    })
    expect(days[3]).toMatchObject({ hasChanges: true, lessonCount: 0 })
  })

  it('на новом дне — новое время, новая аудитория и «Было» с датой, временем и аудиторией', () => {
    expect(days[5]!.entries).toHaveLength(1)
    expect(days[5]!.entries[0]).toMatchObject({
      placement: 'moved_to',
      startsAt: '10:15',
      endsAt: '11:45',
      room: '2-214',
      badge: 'Перенос',
      was: 'Было: чт 19 ноября, 12:00–13:30, ауд. 2-210',
    })
    expect(days[5]).toMatchObject({ hasChanges: true, lessonCount: 1 })
  })

  it('больше нигде пара не встречается', () => {
    expect(days.flatMap((d) => d.entries)).toHaveLength(2)
  })
})

describe('перенос за пределы семи дней', () => {
  it('остаётся только старое место с текстом, куда перенесена', () => {
    const days = buildSchedule(
      [
        lesson({
          id: 'm',
          date: '2026-11-22',
          startsAt: '12:00',
          endsAt: '13:30',
          change: change('moved', { newDate: '2026-11-24', newStartsAt: '08:30', newEndsAt: '10:00' }),
        }),
      ],
      TODAY,
    )
    const all = days.flatMap((d) => d.entries)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ placement: 'moved_from', movedTo: 'Перенесена на вт, 24 ноября, 08:30–10:00, ауд. 1-204' })
    expect(days[6]).toMatchObject({ hasChanges: true, lessonCount: 0 })
  })

  it('старое место вне окна, новое внутри: остаётся только новое', () => {
    const days = buildSchedule(
      [
        lesson({
          id: 'm',
          date: '2026-11-14',
          startsAt: '12:00',
          endsAt: '13:30',
          change: change('moved', { newDate: '2026-11-17', newStartsAt: '08:30', newEndsAt: '10:00' }),
        }),
      ],
      TODAY,
    )
    const all = days.flatMap((d) => d.entries)
    expect(all.map((e) => e.placement)).toEqual(['moved_to'])
    expect(days[1]!.entries[0]!.was).toBe('Было: сб 14 ноября, 12:00–13:30')
  })
})

describe('пара, перенесённая с прошедшего дня (R-3.2-2)', () => {
  // Экран просит пары за 14 дней назад: слой доступа выбирает по дате старого места, а новое стоит в ленте.
  const past = '2026-11-13'

  it('сегодня — день, на который пару перенесли: пара стоит сегодня, со строкой «Было»', () => {
    const days = buildSchedule(
      [
        lesson({
          id: 'm',
          date: past,
          startsAt: '12:00',
          endsAt: '13:30',
          room: '2-210',
          change: change('moved', { newDate: TODAY, newStartsAt: '08:30', newEndsAt: '10:00', newRoom: '2-214' }),
        }),
      ],
      TODAY,
    )
    expect(days[0]!.entries).toHaveLength(1)
    expect(days[0]!.entries[0]).toMatchObject({
      placement: 'moved_to',
      startsAt: '08:30',
      endsAt: '10:00',
      room: '2-214',
      badge: 'Перенос',
      was: 'Было: пт 13 ноября, 12:00–13:30, ауд. 2-210',
    })
    // Признак «есть изменения» и число пар дня считаются с такой парой.
    expect(days[0]).toMatchObject({ hasChanges: true, lessonCount: 1 })
    // Старое место — вне ленты: больше нигде пара не встречается.
    expect(days.flatMap((d) => d.entries)).toHaveLength(1)
  })

  it('перенос на другой день ленты с прошлого дня: пара на новом дне, остальные дни пусты', () => {
    const days = buildSchedule(
      [lesson({ id: 'm', date: past, startsAt: '12:00', endsAt: '13:30', change: change('moved', { newDate: '2026-11-18', newStartsAt: '10:15', newEndsAt: '11:45' }) })],
      TODAY,
    )
    expect(days[2]!.entries.map((e) => `${e.lessonId}:${e.placement}`)).toEqual(['m:moved_to'])
    expect(days[2]).toMatchObject({ hasChanges: true, lessonCount: 1 })
    for (const i of [0, 1, 3, 4, 5, 6]) expect(days[i]).toMatchObject({ entries: [], hasChanges: false, lessonCount: 0 })
  })

  it('прошлая пара без переноса в ленту не попадает', () => {
    const days = buildSchedule(
      [
        lesson({ id: 'plain', date: past, startsAt: '10:15', endsAt: '11:45' }),
        lesson({ id: 'yesterday', date: '2026-11-15', startsAt: '10:15', endsAt: '11:45' }),
        lesson({ id: 'room', date: past, startsAt: '12:00', endsAt: '13:30', change: change('room_changed', { newRoom: '2-108' }) }),
      ],
      TODAY,
    )
    expect(days.flatMap((d) => d.entries)).toEqual([])
    expect(days.every((d) => !d.hasChanges && d.lessonCount === 0)).toBe(true)
  })

  it('прошлая отменённая пара в ленту не попадает', () => {
    const days = buildSchedule(
      [lesson({ id: 'x', date: past, startsAt: '10:15', endsAt: '11:45', change: change('cancelled', { note: 'преподаватель в командировке' }) })],
      TODAY,
    )
    expect(days.flatMap((d) => d.entries)).toEqual([])
    expect(days.every((d) => !d.hasChanges)).toBe(true)
  })

  it('прошлая пара, перенесённая внутри своего дня, в ленту не попадает', () => {
    const days = buildSchedule(
      [lesson({ id: 'm', date: past, startsAt: '10:15', endsAt: '11:45', change: change('moved', { newStartsAt: '15:45', newEndsAt: '17:15' }) })],
      TODAY,
    )
    expect(days.flatMap((d) => d.entries)).toEqual([])
  })

  it('перенос с прошлого дня на прошлый же день ленту не задевает', () => {
    const days = buildSchedule(
      [lesson({ id: 'm', date: '2026-11-12', startsAt: '10:15', endsAt: '11:45', change: change('moved', { newDate: past, newStartsAt: '15:45', newEndsAt: '17:15' }) })],
      TODAY,
    )
    expect(days.flatMap((d) => d.entries)).toEqual([])
  })
})

describe('смена аудитории и преподавателя', () => {
  const days = buildSchedule(
    [
      lesson({ id: 'r', date: TODAY, startsAt: '10:15', endsAt: '11:45', room: '2-210', change: change('room_changed', { newRoom: '2-108', note: '2-210 → 2-108' }) }),
      lesson({
        id: 't',
        date: TODAY,
        startsAt: '12:00',
        endsAt: '13:30',
        teacher: 'Мельник Д. О.',
        change: change('teacher_changed', { note: 'Ведёт Яковлева А. С. вместо Мельник Д. О.' }),
      }),
      lesson({ id: 't2', date: TODAY, startsAt: '14:00', endsAt: '15:30', teacher: 'Иванов И. И.', change: change('teacher_changed', { note: 'Ведёт другой преподаватель' }) }),
    ],
    TODAY,
  )
  const [room, teacher, teacherUnparsed] = days[0]!.entries

  it('аудитория: новая на месте, одна строка «Аудитория: 2-210 → 2-108», строки «Было» нет', () => {
    expect(room).toMatchObject({
      placement: 'regular',
      changeKind: 'room_changed',
      cancelled: false,
      badge: 'Другая аудитория',
      room: '2-108',
      was: 'Аудитория: 2-210 → 2-108',
      roomChange: { from: '2-210', to: '2-108' },
    })
    expect(room!.was).not.toMatch(/Было/)
  })

  it('преподаватель: новый на месте, одна строка «Преподаватель: новый вместо прежнего», строки «Было» нет', () => {
    expect(teacher).toMatchObject({
      changeKind: 'teacher_changed',
      badge: 'Замена преподавателя',
      teacher: 'Яковлева А. С.',
      was: 'Преподаватель: Яковлева А. С. вместо Мельник Д. О.',
      roomChange: null,
    })
    expect(teacher!.was).not.toMatch(/Было/)
  })

  it('ФИО прежнего преподавателя встречается один раз: в строке замены; в поле «преподаватель» — только новый', () => {
    // Заметка деканата хранит исходный текст «Ведёт … вместо …», но экран показывает её, только когда строка замены не собралась.
    expect(teacher!.was!.split('Мельник Д. О.')).toHaveLength(2)
    expect(teacher!.teacher).toBe('Яковлева А. С.')
    expect(teacher!.teacher).not.toContain('Мельник')
  })

  it('заметка не по шаблону не ломает раскладку: прежний преподаватель и заметка остаются', () => {
    expect(teacherUnparsed).toMatchObject({ teacher: 'Иванов И. И.', was: null, note: 'Ведёт другой преподаватель', badge: 'Замена преподавателя' })
  })

  it('строки изменения собирают функции roomChangeText и teacherChangeText — те же слова', () => {
    expect(roomChangeText('118', '124')).toBe('Аудитория: 118 → 124')
    expect(teacherChangeText('Яковлева А. С.', 'Мельник Д. О.')).toBe('Преподаватель: Яковлева А. С. вместо Мельник Д. О.')
  })

  it('перенос: «Было: пн 16 ноября, 10:10–11:40» без запятой после дня недели; с другой аудиторией — «, ауд. N» в конце', () => {
    const moved = buildSchedule(
      [
        lesson({ id: 'p1', date: TODAY, startsAt: '10:10', endsAt: '11:40', change: change('moved', { newDate: '2026-11-18', newStartsAt: '11:50', newEndsAt: '13:20' }) }),
        lesson({ id: 'p2', date: TODAY, startsAt: '10:10', endsAt: '11:40', room: '118', change: change('moved', { newDate: '2026-11-19', newStartsAt: '11:50', newEndsAt: '13:20', newRoom: '124' }) }),
      ],
      TODAY,
    )
      .flatMap((d) => d.entries)
      .filter((e) => e.placement === 'moved_to')
    expect(moved.map((e) => e.was)).toEqual(['Было: пн 16 ноября, 10:10–11:40', 'Было: пн 16 ноября, 10:10–11:40, ауд. 118'])
    // Новая аудитория у переноса — не «смена аудитории»: крупной строки аудитории нет.
    expect(moved.map((e) => e.roomChange)).toEqual([null, null])
  })

  it('все три пары считаются, день отмечен', () => {
    expect(days[0]).toMatchObject({ lessonCount: 3, hasChanges: true })
  })
})

describe('странные входные данные', () => {
  it('неизвестный вид изменения игнорируется: пара как обычная', () => {
    const [day] = buildSchedule([lesson({ id: 'a', date: TODAY, startsAt: '10:15', endsAt: '11:45', change: change('выдуманный') })], TODAY)
    expect(day!.entries[0]).toMatchObject({ changeKind: null, badge: null, note: null })
    expect(day!.hasChanges).toBe(false)
  })

  it('перенос без новых данных — одна строка с плашкой, а не двойник', () => {
    const [day] = buildSchedule([lesson({ id: 'a', date: TODAY, startsAt: '10:15', endsAt: '11:45', change: change('moved') })], TODAY)
    expect(day!.entries).toHaveLength(1)
    expect(day!.entries[0]).toMatchObject({ placement: 'regular', changeKind: 'moved', badge: 'Перенос', movedTo: null, was: null })
  })

  it('перенос с одним новым временем (только начало или только конец) — как без нового времени, «12:00–11:45» не бывает (R-3.2-7)', () => {
    for (const partial of [{ newStartsAt: '12:00' }, { newEndsAt: '09:30' }]) {
      // Только время: одна строка с плашкой.
      const [same] = buildSchedule([lesson({ id: 'a', date: TODAY, startsAt: '10:15', endsAt: '11:45', change: change('moved', partial) })], TODAY)
      expect(same!.entries).toHaveLength(1)
      expect(same!.entries[0]).toMatchObject({ placement: 'regular', startsAt: '10:15', endsAt: '11:45', badge: 'Перенос', movedTo: null, was: null })
      // С новой аудиторией: два места, но время прежнее, а не половина нового.
      const [withRoom] = buildSchedule(
        [lesson({ id: 'b', date: TODAY, startsAt: '10:15', endsAt: '11:45', change: change('moved', { ...partial, newRoom: '2-108' }) })],
        TODAY,
      )
      expect(withRoom!.entries.map((e) => `${e.placement}:${e.startsAt}–${e.endsAt}`)).toEqual(['moved_from:10:15–11:45', 'moved_to:10:15–11:45'])
      expect(withRoom!.entries[0]!.movedTo).toBe('Перенесена на 10:15–11:45, ауд. 2-108')
      const text = JSON.stringify(withRoom)
      expect(text).not.toContain('12:00–11:45')
      expect(text).not.toContain('10:15–09:30')
    }
  })

  it('вход не меняется', () => {
    const input = [lesson({ id: 'a', date: TODAY, startsAt: '10:15', endsAt: '11:45', change: change('moved', { newStartsAt: '12:00', newEndsAt: '13:30' }) })]
    const copy = JSON.parse(JSON.stringify(input))
    buildSchedule(input, TODAY)
    expect(input).toEqual(copy)
  })
})

describe('параметры адреса', () => {
  it('день из семи дней принимается', () => {
    expect(pickDay('2026-11-18', TODAY)).toBe('2026-11-18')
    expect(pickDay('2026-11-16', TODAY)).toBe('2026-11-16')
    expect(pickDay('2026-11-22', TODAY)).toBe('2026-11-22')
  })

  it('мусор, чужие даты и повторы показывают сегодня', () => {
    for (const bad of [undefined, '', 'мусор', '2026-13-45', '2026-02-30', '2026-11-15', '2026-11-23', "2026-11-18'; drop table", ['2026-11-18', '2026-11-19']]) {
      expect(pickDay(bad, TODAY)).toBe(TODAY)
    }
  })

  it('вид: только week даёт неделю', () => {
    expect(pickView('week')).toBe('week')
    for (const other of [undefined, '', 'day', 'WEEK', 'мусор', ['week']]) expect(pickView(other)).toBe('day')
  })
})
