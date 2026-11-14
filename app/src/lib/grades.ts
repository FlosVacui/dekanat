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

// ---------- Правила баллов (пакет 3.3) ----------
// Все числа правил живут здесь и только здесь: поменять правило — поменять одну строку.
// Источник баллов и границ оценок: docs/research/SUMMARY.md, раздел «ЯД-3. Успеваемость»;
// 100 баллов и границы оценок сверены ревьюером с источником вуза: RV-1.6-1, строка 15 — «совпало».

/** Баллов за семестр: до 60. Источник: SUMMARY, «ЯД-3»; RV-1.6-1, строка 15. */
export const SEMESTER_MAX_POINTS = 60
/** Баллов за экзамен: до 40. Источник: SUMMARY, «ЯД-3»; RV-1.6-1, строка 15. */
export const EXAM_MAX_POINTS = 40
/** Всего: 100 = 60 + 40. */
export const TOTAL_MAX_POINTS = SEMESTER_MAX_POINTS + EXAM_MAX_POINTS
/** Оценка «5» — от 85 баллов в сумме. Источник: SUMMARY, «ЯД-3»; RV-1.6-1, строка 15. */
export const GRADE_5_MIN = 85
/** Оценка «4» — от 70 баллов в сумме. Источник: SUMMARY, «ЯД-3»; RV-1.6-1, строка 15. */
export const GRADE_4_MIN = 70
/** Оценка «3» — от 50 баллов в сумме; меньше — «2». Источник: SUMMARY, «ЯД-3»; RV-1.6-1, строка 15. */
export const GRADE_3_MIN = 50
/**
 * Допуск к экзамену — не меньше 30 баллов за семестр.
 * Источник: SUMMARY, «ЯД-3»; это прочтение ревьюера (замечание R-1.6-5), человеком не сверено.
 */
export const ADMISSION_MIN_SEMESTER_POINTS = 30
/**
 * На экзамене нужно набрать не меньше 20 баллов.
 * Источник: SUMMARY, «ЯД-3»; это прочтение ревьюера (замечание R-1.6-5), человеком не сверено.
 */
export const EXAM_MIN_POINTS = 20
// Для зачёта порогов в источниках нет: продукт показывает баллы, срок и итог и порога не выдумывает.

export type ExamGrade = 3 | 4 | 5

/** Оценка по сумме баллов (семестр + экзамен). Сумма вне 0–100 обрезается. */
export function gradeForTotal(total: number): '2' | '3' | '4' | '5' {
  const t = clamp(total, 0, TOTAL_MAX_POINTS)
  if (t >= GRADE_5_MIN) return '5'
  if (t >= GRADE_4_MIN) return '4'
  if (t >= GRADE_3_MIN) return '3'
  return '2'
}

const GRADE_MIN: Record<ExamGrade, number> = { 3: GRADE_3_MIN, 4: GRADE_4_MIN, 5: GRADE_5_MIN }

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** Пустые баллы — не ноль, но для расчёта берём 0; сумму обрезаем до 0–60. */
function semesterPoints(points: number | null): number {
  return points === null ? 0 : clamp(points, 0, SEMESTER_MAX_POINTS)
}

/** Сколько баллов за семестр не хватает до допуска к экзамену; 0 — допуск по баллам есть. */
export function pointsToAdmission(points: number | null): number {
  return Math.max(0, ADMISSION_MIN_SEMESTER_POINTS - semesterPoints(points))
}

/**
 * Что нужно на экзамене для оценки при нынешних баллах за семестр:
 * - `needs` — набрать на экзамене не меньше `points` (никогда меньше 20);
 * - `unreachable` — даже 40 из 40 не хватит;
 * - `no_admission` — до экзамена не допустят, оценку экзаменом пока не закрыть.
 */
export type ExamTarget =
  | { grade: ExamGrade; status: 'needs'; points: number }
  | { grade: ExamGrade; status: 'unreachable' }
  | { grade: ExamGrade; status: 'no_admission'; missingToAdmission: number }

/** Для оценок 3, 4 и 5 — по одной записи, в этом порядке. */
export function examPointsForGrades(points: number | null): ExamTarget[] {
  const sem = semesterPoints(points)
  const missing = pointsToAdmission(points)
  return ([3, 4, 5] as const).map((grade): ExamTarget => {
    if (missing > 0) return { grade, status: 'no_admission', missingToAdmission: missing }
    const need = Math.max(EXAM_MIN_POINTS, GRADE_MIN[grade] - sem)
    return need > EXAM_MAX_POINTS ? { grade, status: 'unreachable' } : { grade, status: 'needs', points: need }
  })
}

/** «1 балл», «2 балла», «5 баллов». */
export function pointsWord(n: number): string {
  const abs = Math.abs(Math.trunc(n))
  const last = abs % 10
  const lastTwo = abs % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'баллов'
  if (last === 1) return 'балл'
  if (last >= 2 && last <= 4) return 'балла'
  return 'баллов'
}

export interface DisciplineStateInput {
  /** 'exam' | 'credit' */
  controlKind: string
  /** '5' | '4' | '3' | '2' | 'credit' | 'no_credit' | 'pending' */
  outcome: string
  /** Баллы за семестр; пусто — баллов пока нет. */
  points: number | null
  /** Признак допуска из базы. */
  admitted: boolean
}

export type DisciplineStateKind = 'passed' | 'debt' | 'ahead_admitted' | 'ahead_no_admission' | 'ahead'

export interface DisciplineState {
  kind: DisciplineStateKind
  /** «сдано», «долг», «впереди, допуск есть», «впереди, до допуска не хватает N баллов» и т. п. */
  text: string
  /** Сколько баллов не хватает до допуска; только у экзамена без допуска, иначе null. */
  missing: number | null
}

/**
 * Короткий итог по дисциплине словами.
 * Экзамен: допуск есть, если признак из базы верен и баллов за семестр не меньше порога.
 * Зачёт: порога нет, допуск берётся только из признака в базе; зачёт без отметки — просто «впереди».
 */
export function describeDiscipline(d: DisciplineStateInput): DisciplineState {
  if (d.outcome === '2' || d.outcome === 'no_credit') return { kind: 'debt', text: 'долг', missing: null }
  if (d.outcome !== 'pending') return { kind: 'passed', text: 'сдано', missing: null }
  if (d.controlKind === 'credit') {
    return d.admitted
      ? { kind: 'ahead', text: 'впереди', missing: null }
      : { kind: 'ahead_no_admission', text: 'впереди, допуска нет', missing: null }
  }
  const missing = pointsToAdmission(d.points)
  if (d.admitted && missing === 0) return { kind: 'ahead_admitted', text: 'впереди, допуск есть', missing: null }
  if (missing > 0) {
    return { kind: 'ahead_no_admission', text: `впереди, до допуска не хватает ${missing} ${pointsWord(missing)}`, missing }
  }
  return { kind: 'ahead_no_admission', text: 'впереди, допуска нет', missing: null }
}

export interface FirstActionInput extends DisciplineStateInput {
  disciplineId: string
  name: string
  /** Дата экзамена, зачёта или пересдачи, ГГГГ-ММ-ДД; не назначена — null. */
  examDate: string | null
}

export interface FirstAction {
  /** `debt` — долг; `no_admission` — нет допуска; `next_control` — ближайший экзамен или зачёт. */
  kind: 'debt' | 'no_admission' | 'next_control'
  disciplineId: string
  name: string
  date: string | null
  missing: number | null
}

/** Раньше — выше; даты нет — в конец; при равенстве — по названию. */
function byDateThenName(a: { examDate: string | null; name: string }, b: { examDate: string | null; name: string }): number {
  if (a.examDate !== b.examDate) {
    if (a.examDate === null) return 1
    if (b.examDate === null) return -1
    return a.examDate < b.examDate ? -1 : 1
  }
  return a.name.localeCompare(b.name, 'ru')
}

/**
 * «Что сделать первым» для сводки: сначала долги, затем дисциплины без допуска,
 * затем ближайший экзамен или зачёт (дата не раньше `today`). Внутри группы — по дате.
 * Делать нечего — null.
 */
export function pickFirstAction(items: FirstActionInput[], today: string): FirstAction | null {
  const withState = items.map((item) => ({ item, state: describeDiscipline(item) }))
  const pick = (kind: FirstAction['kind'], list: typeof withState): FirstAction | null => {
    const first = [...list].sort((a, b) => byDateThenName(a.item, b.item))[0]
    if (!first) return null
    return { kind, disciplineId: first.item.disciplineId, name: first.item.name, date: first.item.examDate, missing: first.state.missing }
  }
  return (
    pick('debt', withState.filter((x) => x.state.kind === 'debt')) ??
    pick('no_admission', withState.filter((x) => x.state.kind === 'ahead_no_admission')) ??
    pick(
      'next_control',
      withState.filter((x) => x.item.outcome === 'pending' && x.item.examDate !== null && x.item.examDate >= today),
    )
  )
}
