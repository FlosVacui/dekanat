// Пакет 3.2, правка по RV-3.2-1 (R-3.2-1): сквозные тесты экрана «Расписание» не зависят от дня недели запуска.
// Сквозной тест нельзя запустить в другой день: «сегодня» берётся по часам. Поэтому здесь для 14 дней подряд вызваны
// настоящие план набора (то, что считает помощник сквозных тестов) и настоящая buildSchedule (то, что рисует экран),
// и проверено всё, на что сквозные тесты опираются. Помощник сквозных тестов в этот файл не подключён: берётся его общий расчёт.
// База не нужна.
import { describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { buildCohortPlan } from '../../db/seed-plan'
import { addDays, todayIn } from '../../src/lib/dates'
import { buildSchedule, SCHEDULE_DAYS, SCHEDULE_LOOKBACK_DAYS, type ScheduleLesson } from '../../src/lib/schedule'
import { planSchedule } from '../e2e/helpers/schedule-plan-core'

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')

const RUN_DAY = todayIn('Europe/Moscow')
const NOVEMBER_14 = '2026-11-14'
const DAYS_IN_ROW = 14

/** То, что экран получает от listMyLessons(actor, сегодня − 14 дней, сегодня + 6): пары группы по дате старого места. */
function screenInput(today: string): ScheduleLesson[] {
  const from = addDays(today, -SCHEDULE_LOOKBACK_DAYS)
  const to = addDays(today, SCHEDULE_DAYS - 1)
  return buildCohortPlan(MAIN_COHORT, today)
    .lessons.filter((l) => l.groupName === student1!.groupName && l.date >= from && l.date <= to)
    .map((l) => ({
      id: l.id,
      date: l.date,
      startsAt: l.startsAt,
      endsAt: l.endsAt,
      discipline: l.discipline,
      kind: l.kind,
      room: l.room,
      teacher: l.teacher,
      change: l.change
        ? { kind: l.change.kind, note: l.change.note, newDate: l.change.newDate, newStartsAt: l.change.newStartsAt, newEndsAt: l.change.newEndsAt, newRoom: l.change.newRoom }
        : null,
    }))
}

function checkDay(today: string): void {
  const plan = planSchedule(today)
  const days = buildSchedule(screenInput(today), today)
  const byDate = new Map(days.map((d) => [d.date, d]))

  // Сквозной тест «данные»: в окне есть отмена, перенос внутри дня, смена аудитории, замена преподавателя и перенос на другой день.
  expect(plan.cancelled, 'в окне нет отменённой пары').toBeDefined()
  expect(plan.movedSameDay, 'в окне нет переноса внутри дня').toBeDefined()
  expect(plan.roomChanged, 'в окне нет смены аудитории').toBeDefined()
  expect(plan.teacherChanged, 'в окне нет замены преподавателя').toBeDefined()
  expect(plan.movedOtherDayInWindow ?? plan.movedOutOfWindow, 'в окне нет переноса на другой день').toBeDefined()

  // Дни окна у плана и у экрана — одни и те же.
  expect(plan.window).toEqual(days.map((d) => d.date))

  // У каждой записи, которую тест ищет, на её дне ровно одна запись с её признаком.
  expect(plan.expected.length).toBeGreaterThan(0)
  for (const want of plan.expected) {
    const day = byDate.get(want.date)
    expect(day, `${want.name}: дня ${want.date} нет в ленте`).toBeDefined()
    const own = day!.entries.filter((e) => e.lessonId === want.lesson.id && e.placement === want.placement)
    expect(own, `${want.name}: записей пары ${want.lesson.discipline} на ${want.date} (${want.placement})`).toHaveLength(1)
    const entry = own[0]!
    expect(entry.changeKind, `${want.name}: вид изменения`).toBe(want.changeKind)
    expect(`${entry.startsAt}–${entry.endsAt}`, `${want.name}: время`).toBe(`${want.startsAt}–${want.endsAt}`)
    expect(entry.discipline, `${want.name}: дисциплина`).toBe(want.lesson.discipline)
    expect(entry.was !== null, `${want.name}: строка «Было»`).toBe(want.hasWas)
    // Тест находит карточку по дисциплине и времени на дне: такая карточка на дне одна.
    const sameCard = day!.entries.filter((e) => e.discipline === want.lesson.discipline && e.startsAt === want.startsAt)
    expect(sameCard, `${want.name}: карточек с этой дисциплиной и временем`).toHaveLength(1)
    // «Было» внутри карточки пары: ровно одна строка у записи, у остальных записей того же дня — свои.
    expect(day!.entries.filter((e) => e.lessonId === want.lesson.id && e.was !== null).length, `${want.name}: «Было» у пары`).toBeLessThanOrEqual(1)
  }

  // Число строк, признак «есть изменения» и итог по окну совпадают с тем, что тест считает по плану.
  for (const day of days) {
    expect(plan.entriesOn(day.date), `${day.date}: число строк`).toBe(day.entries.length)
    expect(plan.hasChangesOn(day.date), `${day.date}: есть изменения`).toBe(day.hasChanges)
  }
  expect(plan.totalEntries).toBe(days.reduce((sum, d) => sum + d.entries.length, 0))

  // Каждая пара окна видна на экране.
  const shown = new Set(days.flatMap((d) => d.entries.map((e) => e.lessonId)))
  for (const l of plan.lessons) expect(shown.has(l.id), `${l.discipline} ${l.date}: пары нет на экране`).toBe(true)

  // Пустой день: если назван — пуст; если не назван — пустых дней нет.
  expect(plan.emptyDates).toEqual(days.filter((d) => d.entries.length === 0).map((d) => d.date))
  if (plan.emptyDate !== undefined) {
    expect(plan.window).toContain(plan.emptyDate)
    expect(byDate.get(plan.emptyDate)!.entries, `пустой день ${plan.emptyDate}`).toEqual([])
  } else {
    expect(days.filter((d) => d.entries.length === 0).map((d) => d.date), 'пустых дней нет').toEqual([])
  }
}

function dayRange(start: string): string[] {
  return Array.from({ length: DAYS_IN_ROW }, (_, i) => addDays(start, i))
}

describe(`сквозные тесты расписания: 14 дней подряд с дня запуска (${RUN_DAY})`, () => {
  for (const today of dayRange(RUN_DAY)) it(`«сегодня» — ${today}`, () => checkDay(today))
})

describe(`сквозные тесты расписания: 14 дней подряд с ${NOVEMBER_14}`, () => {
  for (const today of dayRange(NOVEMBER_14)) it(`«сегодня» — ${today}`, () => checkDay(today))
})
