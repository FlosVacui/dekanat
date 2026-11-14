// Что должно быть на экране «Расписание» по данным плана основного набора (db/seed-plan.ts), а не по номеру дня недели.
// План считается тем же кодом, что заполнил базу, от того же «сегодня»: тест при любом дне запуска ищет день с переносом,
// день с отменой и пустой день по данным. Раскладку экрана (src/lib/schedule.ts) этот файл не вызывает: расчёт здесь свой,
// короткий, чтобы тест не проверял функцию её же ответом.
//
// Файл не подключает Playwright и не читает часы: «сегодня» приходит аргументом. Поэтому его вызывает и сквозной тест
// (через schedule-plan.ts), и модульный тест на 14 днях подряд (tests/unit/schedule-plan-days.test.ts): сквозной тест
// нельзя запустить в другой день, а расчёт — можно.
import { MAIN_COHORT } from '../../../db/seed-data'
import { buildCohortPlan, type PlannedLesson } from '../../../db/seed-plan'
import { SCHEDULE_DAYS, SCHEDULE_LOOKBACK_DAYS } from '../../../src/lib/schedule'
import { addDays } from '../../../src/lib/dates'

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')

/** Где на дне стоит запись: как `EntryPlacement` экрана, но названо здесь по-своему. */
export type PlannedPlacement = 'regular' | 'moved_from' | 'moved_to'

/** Одна запись, которую сквозной тест ищет на экране: пара, день, место и признак. */
export interface ExpectedEntry {
  /** Какая выбранная пара: поле плана, из которого она взята. */
  scenario: 'cancelled' | 'roomChanged' | 'teacherChanged' | 'movedSameDay' | 'movedOtherDayInWindow' | 'movedOutOfWindow'
  /** Для сообщений об ошибке. */
  name: string
  lesson: PlannedLesson
  /** День, на котором запись должна стоять. */
  date: string
  placement: PlannedPlacement
  /** Время на ЭТОМ месте. */
  startsAt: string
  endsAt: string
  changeKind: 'cancelled' | 'moved' | 'room_changed' | 'teacher_changed'
  /** У записи есть строка «Было». */
  hasWas: boolean
}

export interface SchedulePlan {
  today: string
  /** Семь дней от сегодняшнего. */
  window: string[]
  /**
   * Пары группы первого студента, которые попадают на экран: старое место в окне либо новое место переноса в окне.
   * Экран просит пары за 14 дней назад и оставляет из прошлых только новое место переноса.
   */
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
  /** Дни окна без единой записи (пар нет, переносов на этот день нет), по порядку. Сегодня включительно. */
  emptyDates: string[]
  /** Первый день окна без единой записи; день, не равный сегодняшнему, предпочтительнее. `undefined` — пустых дней в окне нет. */
  emptyDate: string | undefined
  /** Сколько строк расписания должно быть на дне: пары на своём месте плюс новые места переносов. */
  entriesOn: (date: string) => number
  /** В дне есть изменение: отмена, перенос с любой стороны, смена аудитории или преподавателя. */
  hasChangesOn: (date: string) => boolean
  /** Сколько строк расписания во всём окне. */
  totalEntries: number
  /** Записи, которые проверяют сквозные тесты: по одной на пару из выбранных (у переноса — обе стороны, какие есть в окне). */
  expected: ExpectedEntry[]
}

/** Новое место переноса: день и время. Время — пара «начало и конец»; одного из двух недостаточно, как на экране. */
function moveTarget(l: PlannedLesson): { date: string; startsAt: string; endsAt: string; room: string } | null {
  const c = l.change
  if (c?.kind !== 'moved') return null
  const hasTime = Boolean(c.newStartsAt) && Boolean(c.newEndsAt)
  return {
    date: c.newDate ?? l.date,
    startsAt: hasTime ? c.newStartsAt! : l.startsAt,
    endsAt: hasTime ? c.newEndsAt! : l.endsAt,
    room: c.newRoom ?? l.room,
  }
}

/** Перенос без новых данных: на экране одна строка с плашкой. */
function isSamePlace(l: PlannedLesson): boolean {
  const t = moveTarget(l)
  return t !== null && t.date === l.date && t.startsAt === l.startsAt && t.endsAt === l.endsAt && t.room === l.room
}

export function planSchedule(today: string): SchedulePlan {
  const plan = buildCohortPlan(MAIN_COHORT, today)
  const window = Array.from({ length: SCHEDULE_DAYS }, (_, i) => addDays(today, i))
  const from = addDays(today, -SCHEDULE_LOOKBACK_DAYS)
  const to = window[window.length - 1]!
  // Что экран получает от запроса: пары группы с датой старого места от «сегодня − 14 дней» до конца окна.
  const requested = plan.lessons.filter((l) => l.groupName === student1!.groupName && l.date >= from && l.date <= to)
  const lessons = requested.filter((l) => window.includes(l.date) || window.includes(moveTarget(l)?.date ?? ''))
  const moved = lessons.filter((l) => l.change?.kind === 'moved')

  const entriesOn = (date: string): number => {
    let n = 0
    for (const l of lessons) {
      const target = moveTarget(l)
      if (l.date === date) n += 1
      if (target === null || isSamePlace(l)) continue
      // Новое место — отдельная строка на дне нового места, в том числе внутри того же дня.
      if (target.date === date) n += 1
    }
    return n
  }
  const hasChangesOn = (date: string): boolean =>
    lessons.some((l) => l.change !== null && (l.date === date || moveTarget(l)?.date === date))

  const cancelled = lessons.find((l) => l.change?.kind === 'cancelled' && window.includes(l.date))
  const movedSameDay = moved.find((l) => window.includes(l.date) && moveTarget(l)!.date === l.date && !isSamePlace(l))
  const movedOtherDayInWindow = moved.find((l) => moveTarget(l)!.date !== l.date && window.includes(moveTarget(l)!.date))
  const movedOutOfWindow = moved.find((l) => window.includes(l.date) && moveTarget(l)!.date !== l.date && !window.includes(moveTarget(l)!.date))
  const roomChanged = lessons.find((l) => l.change?.kind === 'room_changed' && window.includes(l.date))
  const teacherChanged = lessons.find((l) => l.change?.kind === 'teacher_changed' && window.includes(l.date))

  const expected: ExpectedEntry[] = []
  const add = (scenario: ExpectedEntry['scenario'], name: string, lesson: PlannedLesson | undefined, e: Omit<ExpectedEntry, 'scenario' | 'name' | 'lesson'>): void => {
    if (lesson) expected.push({ scenario, name, lesson, ...e })
  }
  if (cancelled) {
    add('cancelled', 'отменённая пара', cancelled, { date: cancelled.date, placement: 'regular', startsAt: cancelled.startsAt, endsAt: cancelled.endsAt, changeKind: 'cancelled', hasWas: false })
  }
  if (roomChanged) {
    add('roomChanged', 'смена аудитории', roomChanged, { date: roomChanged.date, placement: 'regular', startsAt: roomChanged.startsAt, endsAt: roomChanged.endsAt, changeKind: 'room_changed', hasWas: true })
  }
  if (teacherChanged) {
    add('teacherChanged', 'замена преподавателя', teacherChanged, { date: teacherChanged.date, placement: 'regular', startsAt: teacherChanged.startsAt, endsAt: teacherChanged.endsAt, changeKind: 'teacher_changed', hasWas: true })
  }
  for (const [scenario, name, l] of [
    ['movedSameDay', 'перенос внутри дня', movedSameDay],
    ['movedOtherDayInWindow', 'перенос на другой день, новое место в окне', movedOtherDayInWindow],
    ['movedOutOfWindow', 'перенос на другой день, новое место вне окна', movedOutOfWindow],
  ] as const) {
    if (!l) continue
    const t = moveTarget(l)!
    // Старое место стоит на дне старого места, если оно в окне.
    if (window.includes(l.date)) {
      add(scenario, `${name}: старое место`, l, { date: l.date, placement: 'moved_from', startsAt: l.startsAt, endsAt: l.endsAt, changeKind: 'moved', hasWas: false })
    }
    if (window.includes(t.date)) {
      add(scenario, `${name}: новое место`, l, { date: t.date, placement: 'moved_to', startsAt: t.startsAt, endsAt: t.endsAt, changeKind: 'moved', hasWas: true })
    }
  }

  const emptyDates = window.filter((d) => entriesOn(d) === 0)
  return {
    today,
    hasChangesOn,
    window,
    lessons,
    cancelled,
    movedSameDay,
    movedOtherDayInWindow,
    movedOutOfWindow,
    roomChanged,
    teacherChanged,
    emptyDates,
    emptyDate: emptyDates.find((d) => d !== today) ?? emptyDates[0],
    entriesOn,
    totalEntries: window.reduce((sum, d) => sum + entriesOn(d), 0),
    expected,
  }
}
