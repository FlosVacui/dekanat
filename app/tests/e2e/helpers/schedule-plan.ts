// Что должно быть на экране «Расписание» по данным плана основного набора (db/seed-plan.ts), а не по номеру дня недели.
// План считается тем же кодом, что заполнил базу, от того же «сегодня»: тест при любом дне запуска ищет день с переносом,
// день с отменой и пустой день по данным. Раскладку экрана (src/lib/schedule.ts) этот файл не вызывает: расчёт здесь свой,
// короткий, чтобы тест не проверял функцию её же ответом.
import { MAIN_COHORT } from '../../../db/seed-data'
import { buildCohortPlan, type PlannedLesson } from '../../../db/seed-plan'
import { addDays } from '../../../src/lib/dates'

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')

export interface SchedulePlan {
  today: string
  /** Семь дней от сегодняшнего. */
  window: string[]
  /** Пары группы первого студента, чья дата в окне. */
  lessons: PlannedLesson[]
  cancelled: PlannedLesson | undefined
  /** Перенос внутри дня: новой даты нет или она та же. */
  movedSameDay: PlannedLesson | undefined
  /** Перенос на другой день, и новый день внутри окна: новое место видно. */
  movedOtherDayInWindow: PlannedLesson | undefined
  /** Перенос на другой день, и новый день вне окна: видно только старое место. */
  movedOutOfWindow: PlannedLesson | undefined
  roomChanged: PlannedLesson | undefined
  teacherChanged: PlannedLesson | undefined
  /** Первый день окна, кроме сегодняшнего, без единой записи: ни пар, ни переносов на него. */
  emptyDate: string | undefined
  /** Сколько строк расписания должно быть на дне: пары на своём месте плюс новые места переносов. */
  entriesOn: (date: string) => number
  /** В дне есть изменение: отмена, перенос с любой стороны, смена аудитории или преподавателя. */
  hasChangesOn: (date: string) => boolean
  /** Сколько строк расписания во всём окне. */
  totalEntries: number
}

export function planSchedule(today: string): SchedulePlan {
  const plan = buildCohortPlan(MAIN_COHORT, today)
  const window = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const lessons = plan.lessons.filter((l) => l.groupName === student1!.groupName && window.includes(l.date))
  const moved = lessons.filter((l) => l.change?.kind === 'moved')
  const entriesOn = (date: string): number => {
    let n = 0
    for (const l of lessons) {
      if (l.date === date) n += 1
      const target = l.change?.kind === 'moved' ? (l.change.newDate ?? l.date) : null
      if (target !== null && target !== l.date && target === date) n += 1
      // Перенос внутри дня: старое и новое место стоят на одном дне, строк две.
      if (target !== null && target === l.date && l.date === date) n += 1
    }
    return n
  }
  const hasChangesOn = (date: string): boolean =>
    lessons.some((l) => l.change !== null && (l.date === date || (l.change.kind === 'moved' && l.change.newDate === date)))
  return {
    today,
    hasChangesOn,
    window,
    lessons,
    cancelled: lessons.find((l) => l.change?.kind === 'cancelled'),
    movedSameDay: moved.find((l) => !l.change?.newDate || l.change.newDate === l.date),
    movedOtherDayInWindow: moved.find((l) => l.change?.newDate && l.change.newDate !== l.date && window.includes(l.change.newDate)),
    movedOutOfWindow: moved.find((l) => l.change?.newDate && l.change.newDate !== l.date && !window.includes(l.change.newDate)),
    roomChanged: lessons.find((l) => l.change?.kind === 'room_changed'),
    teacherChanged: lessons.find((l) => l.change?.kind === 'teacher_changed'),
    emptyDate: window.find((d) => d !== today && entriesOn(d) === 0),
    entriesOn,
    totalEntries: window.reduce((sum, d) => sum + entriesOn(d), 0),
  }
}

/** Адрес вида «День» на выбранный день. */
export function dayPath(date: string): string {
  return `/schedule?day=${date}`
}
