// Сводка «как у меня дела» для экрана «Успеваемость»: считается из списка дисциплин, отдельного запроса нет.

export interface GradeOutcomeLike {
  /** '5' | '4' | '3' | '2' | 'credit' | 'no_credit' | 'pending' */
  outcome: string
}

export interface GradesSummary {
  /** Итог есть и он положительный: оценка 3–5 или «зачтено». */
  passed: number
  /** Итог есть и он отрицательный: оценка 2 или «не зачтено». */
  debt: number
  /** Итога ещё нет. */
  ahead: number
  /** Среднее арифметическое оценок 2–5 (зачёты не входят); null, если оценок нет. */
  average: number | null
}

export function summarizeGrades(items: GradeOutcomeLike[]): GradesSummary {
  let passed = 0
  let debt = 0
  let ahead = 0
  const marks: number[] = []
  for (const { outcome } of items) {
    if (outcome === 'pending') ahead += 1
    else if (outcome === 'no_credit' || outcome === '2') {
      debt += 1
      if (outcome === '2') marks.push(2)
    } else {
      passed += 1
      if (outcome === '3' || outcome === '4' || outcome === '5') marks.push(Number(outcome))
    }
  }
  const average = marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null
  return { passed, debt, ahead, average }
}

/** «4,5» — с запятой, один знак после неё. */
export function formatAverage(value: number | null): string {
  return value === null ? '—' : value.toFixed(1).replace('.', ',')
}
