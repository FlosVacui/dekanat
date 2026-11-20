// Расписание в файл календаря (iCalendar, RFC 5545). Чистые функции: без базы, без окружения; «сейчас» и часовой пояс — аргументами.
// Пары берутся из раскладки `buildSchedule`, той же, что рисует экран «Расписание»: переносы и замены учтены так же.
// Отменённая пара и старое место перенесённой в файл не попадают: в календаре телефона они были бы лишними событиями.
// 20.11: к парам добавлены сроки работ («Срок: …», напоминание за день) и экзамены («Экзамен: …», напоминание в 8:00 в день экзамена).
import { lessonKindLabel } from '@/lib/labels'
import { addDays } from '@/lib/dates'
import { EXAM_ALARM_TIME, examWord, type ExamDate, type WorkDeadline } from '@/lib/reminders/due'
import type { ScheduleDay, ScheduleEntry } from '@/lib/schedule'

/** Сдвиг часового пояса от UTC в миллисекундах в данный момент. */
function offsetMs(timezone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return local - Math.floor(utcMs / 1000) * 1000
}

/** «2026-11-20» и «09:10» в часовом поясе вуза -> момент UTC. Два шага уточнения дают верный результат и у границы перехода времени. */
export function zonedToUtc(date: string, time: string, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0)
  const first = guess - offsetMs(timezone, guess)
  return new Date(guess - offsetMs(timezone, first))
}

/** Момент -> «20261120T061000Z». */
export function icsStamp(moment: Date): string {
  return moment.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Экранирование текстового значения: обратная косая, точка с запятой, запятая и перевод строки. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Строка не длиннее 75 байт: продолжение — с пробела в начале следующей строки. Многобайтный знак не разрезается. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const lines: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = encoder.encode(char).length
    // У продолжения первый байт занят пробелом: 74 вместо 75.
    const limit = lines.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      lines.push(current)
      current = ''
      size = 0
    }
    current += char
    size += bytes
  }
  if (current) lines.push(current)
  return lines.join('\r\n ')
}

function eventLines(day: ScheduleDay, entry: ScheduleEntry, timezone: string, stamp: string): string[] {
  const start = zonedToUtc(day.date, entry.startsAt, timezone)
  const end = zonedToUtc(day.date, entry.endsAt, timezone)
  const description = [`Преподаватель: ${entry.teacher}`, entry.was, entry.note].filter((x): x is string => Boolean(x)).join('\n')
  return [
    'BEGIN:VEVENT',
    `UID:${entry.lessonId}-${entry.placement}@dekanat-prototype.invalid`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end > start ? end : new Date(start.getTime() + 90 * 60_000))}`,
    `SUMMARY:${escapeIcsText(`${entry.discipline} (${lessonKindLabel(entry.lessonKind)})`)}`,
    `LOCATION:${escapeIcsText(`ауд. ${entry.room}`)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'END:VEVENT',
  ]
}

/** Сроки работ и экзамены для календаря (20.11, напоминания по времени). Считаются `lib/reminders/due.ts` из данных самого студента. */
export interface CalendarReminders {
  works: readonly WorkDeadline[]
  exams: readonly ExamDate[]
}

/** «2026-11-20» -> «20261120»: значение события на весь день. */
function dateValue(date: string): string {
  return date.replace(/-/g, '')
}

function alarmLines(description: string, trigger: string): string[] {
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcsText(description)}`, trigger, 'END:VALARM']
}

/** «Срок: <работа>»: событие на весь день срока, напоминание за сутки (`-P1D`). */
function workLines(work: WorkDeadline, stamp: string): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:work-${work.id}@dekanat-prototype.invalid`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${dateValue(work.date)}`,
    `DTEND;VALUE=DATE:${dateValue(addDays(work.date, 1))}`,
    `SUMMARY:${escapeIcsText(`Срок: ${work.title}`)}`,
    `DESCRIPTION:${escapeIcsText(`Дисциплина: ${work.discipline}`)}`,
    'TRANSP:TRANSPARENT',
    ...alarmLines(`Завтра срок: ${work.title}`, 'TRIGGER:-P1D'),
    'END:VEVENT',
  ]
}

/**
 * «Экзамен: <дисциплина>» или «Зачёт: …». Есть время — событие с временем (по часовому поясу вуза), нет — на весь день.
 * Напоминание — в 8:00 того же дня по часовому поясу вуза, абсолютным временем: от начала экзамена оно не зависит.
 */
function examLines(exam: ExamDate, timezone: string, stamp: string): string[] {
  const word = examWord(exam.kind)
  const alarm = `TRIGGER;VALUE=DATE-TIME:${icsStamp(zonedToUtc(exam.date, EXAM_ALARM_TIME, timezone))}`
  const when: string[] = []
  if (exam.time) {
    const start = zonedToUtc(exam.date, exam.time, timezone)
    when.push(`DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(new Date(start.getTime() + 90 * 60_000))}`)
  } else {
    when.push(`DTSTART;VALUE=DATE:${dateValue(exam.date)}`, `DTEND;VALUE=DATE:${dateValue(addDays(exam.date, 1))}`)
  }
  return [
    'BEGIN:VEVENT',
    `UID:exam-${exam.disciplineId}-${exam.date}@dekanat-prototype.invalid`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${escapeIcsText(`${word}: ${exam.discipline}`)}`,
    ...(exam.room ? [`LOCATION:${escapeIcsText(`ауд. ${exam.room}`)}`] : []),
    ...alarmLines(`Сегодня ${word.toLowerCase()}: ${exam.discipline}`, alarm),
    'END:VEVENT',
  ]
}

/** Файл календаря для дней расписания и, если переданы, сроков работ и экзаменов. Строки разделены CRLF, как требует формат. Пустое расписание — календарь без событий. */
export function buildIcs(days: readonly ScheduleDay[], timezone: string, now: Date = new Date(), reminders?: CalendarReminders): string {
  const stamp = icsStamp(now)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Деканат в кармане//Расписание//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Расписание']
  for (const day of days) {
    for (const entry of day.entries) {
      if (entry.cancelled || entry.placement === 'moved_from') continue
      lines.push(...eventLines(day, entry, timezone, stamp))
    }
  }
  // Сроки и экзамены (20.11): у пар напоминаний нет, у этих событий они есть.
  for (const work of reminders?.works ?? []) lines.push(...workLines(work, stamp))
  for (const exam of reminders?.exams ?? []) lines.push(...examLines(exam, timezone, stamp))
  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}
