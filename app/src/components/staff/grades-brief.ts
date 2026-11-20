import { describeDiscipline, pointsWord, summarizeGrades, type GradesSummary } from '@/lib/grades'

// Краткая успеваемость студента для карточки сотрудника (20.11, блиц). Считает по тем же функциям lib/grades, что экран студента:
// своих правил долга и допуска здесь нет.

export interface BriefRow {
  name: string
  controlKind: string
  points: number | null
  outcome: string
  admitted: boolean
}

export interface GradesBrief {
  summary: GradesSummary
  /** Названия дисциплин с долгом. */
  debts: string[]
  /** Дисциплины, где до допуска не хватает баллов, или допуска нет по признаку из базы. */
  admission: { name: string; text: string }[]
}

export function briefGrades(rows: readonly BriefRow[]): GradesBrief {
  const debts: string[] = []
  const admission: GradesBrief['admission'] = []
  for (const row of rows) {
    const state = describeDiscipline(row)
    if (state.kind === 'debt') debts.push(row.name)
    else if (state.kind === 'ahead_no_admission') {
      admission.push({
        name: row.name,
        text: state.missing !== null ? `не хватает ${state.missing} ${pointsWord(state.missing)}` : 'допуска нет',
      })
    }
  }
  return { summary: summarizeGrades([...rows]), debts, admission }
}
