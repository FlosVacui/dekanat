import {
  ADMISSION_MIN_SEMESTER_POINTS,
  EXAM_MAX_POINTS,
  EXAM_MIN_POINTS,
  GRADE_3_MIN,
  GRADE_4_MIN,
  GRADE_5_MIN,
  SEMESTER_MAX_POINTS,
  TOTAL_MAX_POINTS,
} from '@/lib/grades'

// Строки блока «Правила рейтинга» страницы предмета (М4). Тексты утверждены участником А: DECISIONS, смена 35, часть 2, первое окно
// (экзамен) и третье окно (зачёт). Числа берутся из констант lib/grades.ts: своих чисел здесь нет, поменять правило —
// поменять константу.

/** Пометка последней строкой: правила условные. */
export const RULES_NOTE = 'Правила условные: концепт для конкурса'

/** Строки правил без пометки: у экзамена четыре, у зачёта одна. */
export function ratingRuleLines(controlKind: string): string[] {
  if (controlKind === 'exam') {
    return [
      `За семестр — до ${SEMESTER_MAX_POINTS} баллов, на экзамене — до ${EXAM_MAX_POINTS}`,
      `Допуск к экзамену — от ${ADMISSION_MIN_SEMESTER_POINTS} баллов за семестр`,
      `На экзамене нужно набрать не меньше ${EXAM_MIN_POINTS}`,
      `Итог: от ${GRADE_5_MIN} — «5», от ${GRADE_4_MIN} — «4», от ${GRADE_3_MIN} — «3»`,
    ]
  }
  return [`За семестр — до ${TOTAL_MAX_POINTS} баллов; порога для зачёта нет`]
}
