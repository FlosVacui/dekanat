// 20.11, напоминания по времени: сроки работ и экзамены из данных успеваемости; события и VALARM в файле календаря; строки ленты.
// Чистые функции: база и часы не нужны, «сегодня» задано в тесте.
import { describe, expect, it } from 'vitest'
import { buildIcs } from '../../src/app/schedule/ics'
import { buildSchedule, type ScheduleLesson } from '../../src/lib/schedule'
import {
  examWindowEnd,
  timeReminders,
  upcomingExams,
  workDeadlines,
  type ReminderDisciplineInput,
  type ReminderWorkInput,
} from '../../src/lib/reminders/due'

// Пятница 20.11.2026.
const TODAY = '2026-11-20'
const NOW = new Date('2026-11-20T06:00:00Z')

function work(over: Partial<ReminderWorkInput> & Pick<ReminderWorkInput, 'id' | 'dueDate'>): ReminderWorkInput {
  return { title: `Работа ${over.id}`, points: null, ...over }
}

function discipline(over: Partial<ReminderDisciplineInput> & Pick<ReminderDisciplineInput, 'disciplineId'>): ReminderDisciplineInput {
  return {
    name: `Дисциплина ${over.disciplineId}`,
    controlKind: 'exam',
    outcome: 'pending',
    points: 40,
    admitted: true,
    examDate: null,
    examTime: null,
    examRoom: null,
    works: [],
    ...over,
  }
}

describe('workDeadlines', () => {
  it('несданные работы от сегодня и ещё 13 дней; вчера и через 14 дней — нет', () => {
    const items = [
      discipline({
        disciplineId: 'd1',
        works: [
          work({ id: 'w-yesterday', dueDate: '2026-11-19' }),
          work({ id: 'w-today', dueDate: '2026-11-20' }),
          work({ id: 'w-13', dueDate: '2026-12-03' }),
          work({ id: 'w-14', dueDate: '2026-12-04' }),
        ],
      }),
    ]
    expect(workDeadlines(items, TODAY).map((w) => w.id)).toEqual(['w-today', 'w-13'])
  })

  it('сданная работа (есть баллы, даже ноль) напоминания не даёт', () => {
    const items = [discipline({ disciplineId: 'd1', works: [work({ id: 'a', dueDate: '2026-11-22', points: 12 }), work({ id: 'b', dueDate: '2026-11-22', points: 0 }), work({ id: 'c', dueDate: '2026-11-22' })] })]
    expect(workDeadlines(items, TODAY).map((w) => w.id)).toEqual(['c'])
  })

  it('порядок — по дате, затем по названию; дисциплина и её номер сохранены', () => {
    const items = [
      discipline({ disciplineId: 'd2', name: 'Логистика', works: [work({ id: 'x', title: 'Реферат', dueDate: '2026-11-25' })] }),
      discipline({ disciplineId: 'd1', name: 'Финансы', works: [work({ id: 'y', title: 'Кейс', dueDate: '2026-11-23' }), work({ id: 'z', title: 'Аудит', dueDate: '2026-11-25' })] }),
    ]
    const result = workDeadlines(items, TODAY)
    expect(result.map((w) => w.title)).toEqual(['Кейс', 'Аудит', 'Реферат'])
    expect(result[0]).toMatchObject({ disciplineId: 'd1', discipline: 'Финансы', date: '2026-11-23' })
  })

  it('нет дисциплин и нет работ — пусто', () => {
    expect(workDeadlines([], TODAY)).toEqual([])
    expect(workDeadlines([discipline({ disciplineId: 'd1' })], TODAY)).toEqual([])
  })
})

describe('upcomingExams и конец сессии', () => {
  it('конец сессии ближе 60 дней — берётся вся сессия, а не две недели', () => {
    const items = [
      discipline({ disciplineId: 'a', examDate: '2026-11-25' }),
      discipline({ disciplineId: 'b', examDate: '2026-12-22' }),
      discipline({ disciplineId: 'c', examDate: '2027-01-14' }), // 55 дней
    ]
    expect(examWindowEnd(items, TODAY)).toBe('2027-01-14')
    expect(upcomingExams(items, TODAY).map((e) => e.disciplineId)).toEqual(['a', 'b', 'c'])
  })

  it('конец сессии дальше 60 дней — только 14 дней вперёд', () => {
    const items = [
      discipline({ disciplineId: 'a', examDate: '2026-12-03' }),
      discipline({ disciplineId: 'b', examDate: '2026-12-22' }),
      discipline({ disciplineId: 'c', examDate: '2027-02-10' }), // 82 дня
    ]
    expect(examWindowEnd(items, TODAY)).toBe('2026-12-03')
    expect(upcomingExams(items, TODAY).map((e) => e.disciplineId)).toEqual(['a'])
  })

  it('ровно 60 дней — уже не «ближе 60»: окно 14 дней', () => {
    const items = [discipline({ disciplineId: 'a', examDate: '2027-01-19' })]
    expect(examWindowEnd(items, TODAY)).toBe('2026-12-03')
    expect(upcomingExams(items, TODAY)).toEqual([])
  })

  it('сданные, прошедшие и недатированные не попадают; зачёт и пересдача долга попадают', () => {
    const items = [
      discipline({ disciplineId: 'done', outcome: '4', examDate: '2026-11-27' }),
      discipline({ disciplineId: 'past', examDate: '2026-11-19' }),
      discipline({ disciplineId: 'none' }),
      discipline({ disciplineId: 'credit', controlKind: 'credit', outcome: 'pending', examDate: '2026-11-28', examTime: '09:00', examRoom: '1-1' }),
      discipline({ disciplineId: 'retake', outcome: '2', examDate: '2026-11-30' }),
      discipline({ disciplineId: 'closed-credit', controlKind: 'credit', outcome: 'credit', examDate: '2026-11-29' }),
    ]
    const result = upcomingExams(items, TODAY)
    expect(result.map((e) => e.disciplineId)).toEqual(['credit', 'retake'])
    expect(result[0]).toMatchObject({ kind: 'credit', time: '09:00', room: '1-1' })
    expect(result[1]).toMatchObject({ kind: 'exam', time: null })
  })

  it('сдан последний экзамен сессии — конец сессии считается по оставшимся', () => {
    const items = [
      discipline({ disciplineId: 'a', examDate: '2026-12-10' }),
      discipline({ disciplineId: 'late', outcome: '5', examDate: '2027-03-01' }),
    ]
    expect(examWindowEnd(items, TODAY)).toBe('2026-12-10')
    expect(upcomingExams(items, TODAY).map((e) => e.disciplineId)).toEqual(['a'])
  })

  it('экзамен сегодня входит', () => {
    expect(upcomingExams([discipline({ disciplineId: 'a', examDate: TODAY })], TODAY)).toHaveLength(1)
  })
})

describe('timeReminders: строки ленты', () => {
  const items = [
    discipline({
      disciplineId: 'd1',
      name: 'Эконометрика',
      examDate: TODAY,
      examTime: '14:00',
      examRoom: '1-305',
      works: [work({ id: 'w1', title: 'Презентация', dueDate: '2026-11-21' }), work({ id: 'w2', title: 'Кейс', dueDate: '2026-11-22' }), work({ id: 'w3', title: 'Сдано', dueDate: '2026-11-21', points: 10 })],
    }),
    discipline({ disciplineId: 'd2', name: 'Английский', controlKind: 'credit', examDate: TODAY }),
    discipline({ disciplineId: 'd3', name: 'Физика', examDate: '2026-11-21' }),
  ]

  it('«Завтра срок» и «Сегодня экзамен/зачёт», экзамены первыми', () => {
    const rows = timeReminders(items, TODAY)
    expect(rows.map((r) => r.title)).toEqual(['Сегодня экзамен: Эконометрика', 'Сегодня зачёт: Английский', 'Завтра срок: Презентация'])
    expect(rows.map((r) => r.kind)).toEqual(['exam_today', 'exam_today', 'work_tomorrow'])
  })

  it('тело: время и аудитория; без них — запасная фраза; у срока — дисциплина и дата', () => {
    const rows = timeReminders(items, TODAY)
    expect(rows[0]!.body).toBe('14:00, ауд. 1-305')
    expect(rows[1]!.body).toBe('Время и аудитория не указаны')
    expect(rows[2]!.body).toBe('Эконометрика, 21 ноября')
  })

  it('ссылка ведёт на дисциплину, ключи уникальны', () => {
    const rows = timeReminders(items, TODAY)
    expect(rows.map((r) => r.href)).toEqual(['/grades/d1', '/grades/d2', '/grades/d1'])
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })

  it('нет сроков на завтра и экзаменов сегодня — пусто; сданный экзамен сегодня строки не даёт', () => {
    expect(timeReminders([discipline({ disciplineId: 'x', works: [work({ id: 'q', dueDate: '2026-11-25' })] })], TODAY)).toEqual([])
    expect(timeReminders([discipline({ disciplineId: 'x', outcome: '5', examDate: TODAY })], TODAY)).toEqual([])
  })

  it('в воскресенье «завтра» — понедельник', () => {
    const sunday = '2026-11-22'
    const rows = timeReminders([discipline({ disciplineId: 'x', works: [work({ id: 'm', title: 'Тест', dueDate: '2026-11-23' })] })], sunday)
    expect(rows.map((r) => r.title)).toEqual(['Завтра срок: Тест'])
  })
})

// ---------- файл календаря ----------

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

const summaryOf = (event: string[]) => event.find((l) => l.startsWith('SUMMARY:'))!.slice('SUMMARY:'.length)

describe('buildIcs: сроки и экзамены', () => {
  const works = workDeadlines(
    [discipline({ disciplineId: 'd1', name: 'Логистика', works: [work({ id: 'w1', title: 'Реферат, часть 1', dueDate: '2026-11-30' })] })],
    TODAY,
  )
  const exams = upcomingExams(
    [
      discipline({ disciplineId: 'd2', name: 'Эконометрика', examDate: '2026-12-02', examTime: '14:00', examRoom: '1-305' }),
      discipline({ disciplineId: 'd3', name: 'Английский', controlKind: 'credit', examDate: '2026-12-03' }),
    ],
    TODAY,
  )
  const schedule = buildSchedule([lesson({ id: 'l1', date: '2026-11-20' })], TODAY, 14)
  const ics = buildIcs(schedule, 'Europe/Moscow', NOW, { works, exams })
  const all = events(ics)

  it('пара остаётся без напоминания, события срока и экзаменов добавлены', () => {
    expect(all).toHaveLength(4)
    const [pair, deadline, exam, credit] = all
    expect(pair!.join('\n')).not.toContain('VALARM')
    expect(summaryOf(deadline!)).toContain('Срок: Реферат')
    expect(summaryOf(exam!)).toBe('Экзамен: Эконометрика')
    expect(summaryOf(credit!)).toBe('Зачёт: Английский')
  })

  it('срок: событие на весь день, напоминание за сутки', () => {
    const deadline = all[1]!
    expect(deadline).toContain('DTSTART;VALUE=DATE:20261130')
    expect(deadline).toContain('DTEND;VALUE=DATE:20261201')
    expect(deadline).toContain('BEGIN:VALARM')
    expect(deadline).toContain('TRIGGER:-P1D')
    expect(deadline).toContain('ACTION:DISPLAY')
    expect(deadline.find((l) => l.startsWith('UID:'))).toBe('UID:work-w1@dekanat-prototype.invalid')
  })

  it('экзамен со временем: начало в UTC по часовому поясу вуза, напоминание — абсолютное, 8:00 по Москве = 05:00 UTC того же дня', () => {
    const exam = all[2]!
    expect(exam).toContain('DTSTART:20261202T110000Z')
    expect(exam).toContain('TRIGGER;VALUE=DATE-TIME:20261202T050000Z')
    expect(exam).not.toContain('TRIGGER:-P1D')
    expect(exam).toContain('LOCATION:ауд. 1-305')
  })

  it('зачёт без времени: на весь день, напоминание в 8:00', () => {
    const credit = all[3]!
    expect(credit).toContain('DTSTART;VALUE=DATE:20261203')
    expect(credit).toContain('DTEND;VALUE=DATE:20261204')
    expect(credit).toContain('TRIGGER;VALUE=DATE-TIME:20261203T050000Z')
    expect(credit.some((l) => l.startsWith('LOCATION:'))).toBe(false)
  })

  it('часовой пояс другой — другое утро в UTC', () => {
    const berlin = buildIcs([], 'Europe/Berlin', NOW, { works: [], exams })
    expect(berlin).toContain('TRIGGER;VALUE=DATE-TIME:20261202T070000Z')
  })

  it('строки не длиннее 75 байт, перевод строки CRLF, текст экранирован', () => {
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(ics).not.toMatch(/[^\r]\n/)
    expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:Срок: Реферат\\, часть 1')
  })

  it('без переданных напоминаний файл прежний: ни одного VALARM', () => {
    const plain = buildIcs(schedule, 'Europe/Moscow', NOW)
    expect(plain).not.toContain('VALARM')
    expect(events(plain)).toHaveLength(1)
  })
})
