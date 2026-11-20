// Напоминания по времени (20.11): сроки работ и экзамены из тех же данных, что и экран «Успеваемость». Чистые функции:
// без базы, без часов, без окружения; «сегодня» приходит аргументом (ошибки ИИ 84 и 120). Новых таблиц и фоновых задач нет:
// и файл календаря, и строки в ленте считаются на лету, на каждый запрос.
// Данные — только свои: список дисциплин приходит из `listMyGrades` (группа и баллы из сессии), здесь он только разбирается.
import { addDays, formatDayMonth } from '@/lib/dates'
import { describeDiscipline } from '@/lib/grades'

/** Сколько дней вперёд попадает в календарь и в поиск сроков: сегодня и ещё 13. */
export const REMINDER_DAYS = 14
/** Экзамены тянутся до конца сессии, если он ближе этого числа дней. */
export const SESSION_LOOKAHEAD_DAYS = 60
/** Час утра в день экзамена, в который срабатывает напоминание. */
export const EXAM_ALARM_TIME = '08:00'

export interface ReminderWorkInput {
  id: string
  title: string
  dueDate: string
  /** Баллы студента; пусто — не сдана. */
  points: number | null
}

/** Что нужно от дисциплины. `GradeItem` из слоя доступа подходит как есть. */
export interface ReminderDisciplineInput {
  disciplineId: string
  name: string
  controlKind: string
  outcome: string
  points: number | null
  admitted: boolean
  examDate: string | null
  examTime: string | null
  examRoom: string | null
  works: readonly ReminderWorkInput[]
}

export interface WorkDeadline {
  id: string
  disciplineId: string
  discipline: string
  title: string
  /** «ГГГГ-ММ-ДД»; времени у срока в данных нет. */
  date: string
}

export interface ExamDate {
  disciplineId: string
  discipline: string
  kind: 'exam' | 'credit'
  date: string
  /** «ЧЧ:ММ» или null: времени нет. */
  time: string | null
  room: string | null
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** Экзамен или зачёт ещё впереди или пересдаётся: дисциплина не закрыта итогом. */
function isOpen(d: ReminderDisciplineInput): boolean {
  return describeDiscipline(d).kind !== 'passed'
}

/** Несданные работы со сроком от `today` до `today + days - 1`, по срокам. Сданная работа (есть баллы) напоминания не даёт. */
export function workDeadlines(items: readonly ReminderDisciplineInput[], today: string, days: number = REMINDER_DAYS): WorkDeadline[] {
  const last = addDays(today, days - 1)
  const result: WorkDeadline[] = []
  for (const d of items) {
    for (const w of d.works) {
      if (w.points !== null || w.dueDate < today || w.dueDate > last) continue
      result.push({ id: w.id, disciplineId: d.disciplineId, discipline: d.name, title: w.title, date: w.dueDate })
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ru'))
}

/**
 * Последний день, до которого берутся экзамены. Обычно это `today + 13` (как у пар). Если конец сессии, то есть самая поздняя
 * дата контроля впереди, ближе 60 дней, берётся он: вся сессия сразу, а не по двум неделям.
 */
export function examWindowEnd(items: readonly ReminderDisciplineInput[], today: string): string {
  const base = addDays(today, REMINDER_DAYS - 1)
  let sessionEnd: string | null = null
  for (const d of items) {
    if (d.examDate === null || d.examDate < today || !isOpen(d)) continue
    if (sessionEnd === null || d.examDate > sessionEnd) sessionEnd = d.examDate
  }
  if (sessionEnd !== null && daysBetween(today, sessionEnd) < SESSION_LOOKAHEAD_DAYS && sessionEnd > base) return sessionEnd
  return base
}

/** Экзамены и зачёты с датой в окне `examWindowEnd`, по датам; в один день сначала те, у кого есть время. Закрытые итогом дисциплины и дисциплины без даты не попадают. */
export function upcomingExams(items: readonly ReminderDisciplineInput[], today: string): ExamDate[] {
  const last = examWindowEnd(items, today)
  const result: ExamDate[] = []
  for (const d of items) {
    if (d.examDate === null || d.examDate < today || d.examDate > last || !isOpen(d)) continue
    result.push({
      disciplineId: d.disciplineId,
      discipline: d.name,
      kind: d.controlKind === 'credit' ? 'credit' : 'exam',
      date: d.examDate,
      time: d.examTime,
      room: d.examRoom,
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.discipline.localeCompare(b.discipline, 'ru'))
}

/** «Экзамен» или «Зачёт» — слово перед названием дисциплины в календаре. */
export function examWord(kind: ExamDate['kind']): 'Экзамен' | 'Зачёт' {
  return kind === 'credit' ? 'Зачёт' : 'Экзамен'
}

export interface TimeReminder {
  /** Устойчивый ключ строки: вид и номер записи. */
  key: string
  kind: 'work_tomorrow' | 'exam_today'
  title: string
  body: string
  /** Внутренний адрес дисциплины. */
  href: string
}

/**
 * Строки ленты «Напоминания», которые рождает время: «Завтра срок: …» у несданной работы и «Сегодня экзамен: …» (или «зачёт»).
 * Экзамены и сроки идут вместе: сначала экзамены сегодня, потом сроки на завтра. Ни прочитанного, ни хранения у этих строк нет.
 */
export function timeReminders(items: readonly ReminderDisciplineInput[], today: string): TimeReminder[] {
  const tomorrow = addDays(today, 1)
  const exams: TimeReminder[] = upcomingExams(items, today)
    .filter((e) => e.date === today)
    .map((e) => ({
      key: `exam:${e.disciplineId}`,
      kind: 'exam_today' as const,
      title: `Сегодня ${e.kind === 'credit' ? 'зачёт' : 'экзамен'}: ${e.discipline}`,
      body: [e.time, e.room ? `ауд. ${e.room}` : null].filter((x): x is string => Boolean(x)).join(', ') || 'Время и аудитория не указаны',
      href: `/grades/${e.disciplineId}`,
    }))
  const works: TimeReminder[] = workDeadlines(items, today, 2)
    .filter((w) => w.date === tomorrow)
    .map((w) => ({
      key: `work:${w.id}`,
      kind: 'work_tomorrow' as const,
      title: `Завтра срок: ${w.title}`,
      body: `${w.discipline}, ${formatDayMonth(w.date)}`,
      href: `/grades/${w.disciplineId}`,
    }))
  return [...exams, ...works]
}
