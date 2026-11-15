// Раскладка экрана «Сегодня» (Э-2, пакет 3.6). Чистая функция: без базы и без часов, «сегодня» и «сейчас» приходят аргументами.
// Пары раскладывает `buildSchedule`, поэтому пара, перенесённая на сегодня с прошедшего дня, видна и считается
// (строка IMP-028 в ISSUES: прежний экран просил пары по дате старого места и такую пару не видел).
//
// Правила:
// - пары сегодня — записи дня «сегодня» без отменённых и без старого места перенесённой пары (как `lessonCount` в расписании);
// - следующая пара — первая по порядку записей с сегодняшнего дня: сегодняшняя, если ещё не кончилась, иначе ближайшая другого дня.
//   Отменённая пара и старое место перенесённой пары следующими не бывают;
// - изменения — записи с изменением на сегодня и завтра;
// - сроки «что сдать» — разница в днях от сегодня и плашка.

import { addDays, formatDayMonth, weekdayShort } from './dates'
import { buildSchedule, type ScheduleDay, type ScheduleEntry, type ScheduleLesson } from './schedule'

const WEEKDAYS_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']

/** Работа со сроком: поля слоя доступа (`DueAssignment`), нужные экрану. */
export interface TodayDueInput {
  id: string
  disciplineId: string
  discipline: string
  title: string
  dueDate: string
}

/** Когда начнётся следующая пара: сейчас идёт, позже сегодня, в другой день. */
export type NextKind = 'now' | 'today' | 'other_day'

export interface NextLesson {
  kind: NextKind
  /** День пары, «ГГГГ-ММ-ДД». */
  date: string
  entry: ScheduleEntry
  /** Строка над временем: «Идёт сейчас», «Следующая пара · сегодня», «Следующая пара · пн, 16 ноября». */
  eyebrow: string
  /** Подпись кнопки: «Расписание на сегодня» или «Расписание на 16 ноября». */
  buttonLabel: string
  /** Адрес кнопки: `/schedule` для сегодня, `/schedule?day=ГГГГ-ММ-ДД` для другого дня. */
  href: string
}

export interface TodayChange {
  /** «Сегодня» или «Завтра». */
  dayWord: 'Сегодня' | 'Завтра'
  date: string
  entry: ScheduleEntry
}

export type DueTone = 'warn' | 'info'

export interface DueRow {
  id: string
  disciplineId: string
  title: string
  discipline: string
  dueDate: string
  /** Дней от сегодня до срока: 0 — сегодня. */
  daysLeft: number
  /** «Сегодня», «Завтра», «Через 2 дня», «Через 5 дней». */
  chip: string
  /** Сегодня и завтра — «внимание», дальше — нейтральная плашка. */
  tone: DueTone
}

export interface TodayView {
  /** Число пар сегодня: без отменённых и без старых мест перенесённых. */
  todayCount: number
  /** Пары сегодня были, но все кончились: над следующей парой стоит «Сегодня пар больше нет». */
  todayFinished: boolean
  next: NextLesson | null
  changes: TodayChange[]
  due: DueRow[]
  /** Подзаголовок: «Воскресенье, 15 ноября · пар нет». */
  subtitle: string
}

/** Дней между двумя датами «ГГГГ-ММ-ДД»: `to − from`. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** «пар нет», «1 пара», «3 пары», «5 пар», «11 пар». */
export function lessonCountText(n: number): string {
  if (n === 0) return 'пар нет'
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return `${n} пар`
  if (mod10 === 1) return `${n} пара`
  if (mod10 >= 2 && mod10 <= 4) return `${n} пары`
  return `${n} пар`
}

/** Подзаголовок: день недели с большой буквы, дата, число пар. */
export function subtitleText(today: string, lessonCount: number): string {
  const weekday = WEEKDAYS_FULL[new Date(`${today}T00:00:00Z`).getUTCDay()] ?? ''
  return `${weekday}, ${formatDayMonth(today)} · ${lessonCountText(lessonCount)}`
}

/** Плашка срока: «Сегодня», «Завтра», «Через N дня/дней». */
export function dueChipText(daysLeft: number): string {
  if (daysLeft <= 0) return 'Сегодня'
  if (daysLeft === 1) return 'Завтра'
  const mod100 = daysLeft % 100
  const mod10 = daysLeft % 10
  const word = mod100 >= 11 && mod100 <= 14 ? 'дней' : mod10 === 1 ? 'день' : mod10 >= 2 && mod10 <= 4 ? 'дня' : 'дней'
  return `Через ${daysLeft} ${word}`
}

/** Пара может быть «следующей»: не отменена и это не старое место перенесённой пары. */
function isUpcomingCandidate(entry: ScheduleEntry): boolean {
  return !entry.cancelled && entry.placement !== 'moved_from'
}

function pickNext(days: readonly ScheduleDay[], today: string, now: string): NextLesson | null {
  for (const day of days) {
    for (const entry of day.entries) {
      if (!isUpcomingCandidate(entry)) continue
      if (day.date === today) {
        if (entry.endsAt <= now) continue
        const started = entry.startsAt <= now
        return {
          kind: started ? 'now' : 'today',
          date: day.date,
          entry,
          eyebrow: started ? 'Идёт сейчас' : 'Следующая пара · сегодня',
          buttonLabel: 'Расписание на сегодня',
          href: '/schedule',
        }
      }
      return {
        kind: 'other_day',
        date: day.date,
        entry,
        eyebrow: `Следующая пара · ${weekdayShort(day.date)}, ${formatDayMonth(day.date)}`,
        buttonLabel: `Расписание на ${formatDayMonth(day.date)}`,
        href: `/schedule?day=${day.date}`,
      }
    }
  }
  return null
}

/**
 * Всё, что рисует экран «Сегодня», кроме заявок и объявлений (они приходят из слоя доступа готовыми).
 * `lessons` — пары за промежуток `scheduleRange(today)`; `now` — «ЧЧ:ММ» в часовом поясе вуза.
 */
export function buildToday(
  lessons: readonly ScheduleLesson[],
  due: readonly TodayDueInput[],
  today: string,
  now: string,
): TodayView {
  const days = buildSchedule(lessons, today)
  const todayDay = days.find((d) => d.date === today)
  const todayCount = todayDay?.lessonCount ?? 0
  const next = pickNext(days, today, now)
  const todayFinished = todayCount > 0 && next?.date !== today

  const tomorrow = addDays(today, 1)
  const changes: TodayChange[] = []
  for (const day of days) {
    if (day.date !== today && day.date !== tomorrow) continue
    for (const entry of day.entries) {
      if (entry.changeKind !== null) changes.push({ dayWord: day.date === today ? 'Сегодня' : 'Завтра', date: day.date, entry })
    }
  }

  const dueRows: DueRow[] = due
    .map((w) => {
      const daysLeft = daysBetween(today, w.dueDate)
      return {
        id: w.id,
        disciplineId: w.disciplineId,
        title: w.title,
        discipline: w.discipline,
        dueDate: w.dueDate,
        daysLeft,
        chip: dueChipText(daysLeft),
        tone: (daysLeft <= 1 ? 'warn' : 'info') as DueTone,
      }
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, 'ru'))

  return { todayCount, todayFinished, next, changes, due: dueRows, subtitle: subtitleText(today, todayCount) }
}
