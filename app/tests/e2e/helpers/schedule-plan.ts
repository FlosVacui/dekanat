// Помощник сквозных тестов экрана «Расписание». Расчёт плана — в schedule-plan-core.ts (его же прогоняет модульный тест
// на 14 днях подряд); здесь только то, что нужно самим сквозным тестам.
export { planSchedule, type ExpectedEntry, type PlannedPlacement, type SchedulePlan } from './schedule-plan-core'

/** Адрес вида «День» на выбранный день. */
export function dayPath(date: string): string {
  return `/schedule?day=${date}`
}
