// 20.11, блиц: расписание в файл календаря. Чистые функции, база не нужна.
import { describe, expect, it } from 'vitest'
import { buildIcs, escapeIcsText, foldIcsLine, icsStamp, zonedToUtc } from '../../src/app/schedule/ics'
import { buildSchedule, type ScheduleLesson } from '../../src/lib/schedule'

// Пятница 20.11.2026.
const TODAY = '2026-11-20'
const NOW = new Date('2026-11-20T06:00:00Z')

function lesson(over: Partial<ScheduleLesson> & Pick<ScheduleLesson, 'id' | 'date'>): ScheduleLesson {
  return { startsAt: '10:15', endsAt: '11:45', discipline: 'Микроэкономика', kind: 'seminar', room: '1-204', teacher: 'Петров А. А.', change: null, ...over }
}

function events(ics: string): string[][] {
  const unfolded = ics.replace(/\r\n /g, '')
  return unfolded
    .split('BEGIN:VEVENT\r\n')
    .slice(1)
    .map((chunk) => chunk.split('END:VEVENT')[0]!.split('\r\n').filter(Boolean))
}

describe('часовой пояс', () => {
  it('Москва — UTC+3 круглый год: 09:10 по Москве — 06:10 UTC', () => {
    expect(icsStamp(zonedToUtc('2026-11-20', '09:10', 'Europe/Moscow'))).toBe('20261120T061000Z')
    expect(icsStamp(zonedToUtc('2026-07-01', '00:30', 'Europe/Moscow'))).toBe('20260630T213000Z')
  })

  it('пояс с переходом на летнее время: зима и лето дают разный сдвиг', () => {
    expect(icsStamp(zonedToUtc('2026-01-15', '12:00', 'Europe/Berlin'))).toBe('20260115T110000Z')
    expect(icsStamp(zonedToUtc('2026-07-15', '12:00', 'Europe/Berlin'))).toBe('20260715T100000Z')
  })
})

describe('текст файла', () => {
  it('экранирование: обратная косая, точка с запятой, запятая, перевод строки', () => {
    expect(escapeIcsText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne')
  })

  it('строки длиннее 75 байт переносятся с пробелом, знак из двух байт не разрезается', () => {
    const long = `SUMMARY:${'Ж'.repeat(60)}`
    const folded = foldIcsLine(long)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
    for (const part of parts.slice(1)) expect(part.startsWith(' ')).toBe(true)
    expect(folded.replace(/\r\n /g, '')).toBe(long)
  })

  it('короткая строка не меняется', () => {
    expect(foldIcsLine('BEGIN:VCALENDAR')).toBe('BEGIN:VCALENDAR')
  })
})

describe('календарь', () => {
  it('одна пара — одно событие: время в UTC, аудитория, преподаватель; строки с CRLF', () => {
    const ics = buildIcs(buildSchedule([lesson({ id: 'l1', date: '2026-11-20' })], TODAY, 14), 'Europe/Moscow', NOW)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).not.toMatch(/[^\r]\n/)
    const [event] = events(ics)
    expect(events(ics)).toHaveLength(1)
    expect(event).toContain('DTSTART:20261120T071500Z')
    expect(event).toContain('DTEND:20261120T084500Z')
    expect(event).toContain('SUMMARY:Микроэкономика (Семинар)')
    expect(event).toContain('LOCATION:ауд. 1-204')
    expect(event).toContain('DESCRIPTION:Преподаватель: Петров А. А.')
    expect(event).toContain('UID:l1-regular@dekanat-prototype.invalid')
  })

  it('отменённая пара в файл не попадает', () => {
    const ics = buildIcs(
      buildSchedule([lesson({ id: 'c', date: '2026-11-20', change: { kind: 'cancelled', note: 'нет преподавателя', newDate: null, newStartsAt: null, newEndsAt: null, newRoom: null } })], TODAY, 14),
      'Europe/Moscow',
      NOW,
    )
    expect(events(ics)).toHaveLength(0)
  })

  it('перенос: только новое место, с новым временем и аудиторией; старое место и «Было» не дублируются событием', () => {
    const moved = lesson({
      id: 'm',
      date: '2026-11-20',
      change: { kind: 'moved', note: 'перенос по просьбе группы', newDate: '2026-11-23', newStartsAt: '12:00', newEndsAt: '13:30', newRoom: '2-214' },
    })
    const evs = events(buildIcs(buildSchedule([moved], TODAY, 14), 'Europe/Moscow', NOW))
    expect(evs).toHaveLength(1)
    expect(evs[0]).toContain('DTSTART:20261123T090000Z')
    expect(evs[0]).toContain('LOCATION:ауд. 2-214')
    expect(evs[0]).toContain('UID:m-moved_to@dekanat-prototype.invalid')
    expect(evs[0]!.join('\n')).toContain('Было: пт 20 ноября')
  })

  it('смена аудитории: событие в новой аудитории', () => {
    const l = lesson({ id: 'r', date: '2026-11-21', change: { kind: 'room_changed', note: 'ремонт', newDate: null, newStartsAt: null, newEndsAt: null, newRoom: '3-300' } })
    const evs = events(buildIcs(buildSchedule([l], TODAY, 14), 'Europe/Moscow', NOW))
    expect(evs[0]).toContain('LOCATION:ауд. 3-300')
  })

  it('пары дальше 14 дней и вне окна не попадают; порядок по дням', () => {
    const ics = buildIcs(
      buildSchedule([lesson({ id: 'far', date: '2026-12-10' }), lesson({ id: 'b', date: '2026-11-22' }), lesson({ id: 'a', date: '2026-11-21' })], TODAY, 14),
      'Europe/Moscow',
      NOW,
    )
    const uids = events(ics).map((e) => e.find((l) => l.startsWith('UID:')))
    expect(uids).toEqual(['UID:a-regular@dekanat-prototype.invalid', 'UID:b-regular@dekanat-prototype.invalid'])
  })

  it('пустое расписание — календарь без событий', () => {
    const ics = buildIcs(buildSchedule([], TODAY, 14), 'Europe/Moscow', NOW)
    expect(events(ics)).toHaveLength(0)
    expect(ics).toContain('END:VCALENDAR')
  })

  it('запятая и точка с запятой в названии не ломают строку', () => {
    const ics = buildIcs(buildSchedule([lesson({ id: 'x', date: '2026-11-20', discipline: 'Право; теория, практика' })], TODAY, 14), 'Europe/Moscow', NOW)
    expect(ics).toContain('SUMMARY:Право\\; теория\\, практика (Семинар)')
  })
})
