// Сводка «как у меня дела» для экрана «Успеваемость»: считается из списка дисциплин, отдельного запроса нет.
import { formatDayMonth, weekdayShort } from './dates'

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
 * - `no_admission` — до экзамена не допустят, оценку экзаменом пока не закрыть;
 *   `missingToAdmission` — сколько баллов за семестр не хватает, `null` — баллов хватает, но признак допуска в базе «нет».
 */
export type ExamTarget =
  | { grade: ExamGrade; status: 'needs'; points: number }
  | { grade: ExamGrade; status: 'unreachable' }
  | { grade: ExamGrade; status: 'no_admission'; missingToAdmission: number | null }

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

/**
 * Что нужно на экзамене для оценок 3, 4 и 5 по дисциплине (по замечанию R-3.3-1).
 * Ответ о допуске берётся из `describeDiscipline` — того же, что даёт строка состояния; второго правила допуска здесь нет.
 * Нет допуска — три записи `no_admission`: если баллов хватает, а признак в базе «нет», числа нет (`missingToAdmission: null`).
 * Блок нужен только экзамену без итога; у зачёта и у закрытой дисциплины записей нет.
 */
export function examTargetsForDiscipline(d: DisciplineStateInput): ExamTarget[] {
  if (d.controlKind !== 'exam' || d.outcome !== 'pending') return []
  const state = describeDiscipline(d)
  if (state.kind === 'ahead_no_admission') {
    return ([3, 4, 5] as const).map((grade): ExamTarget => ({ grade, status: 'no_admission', missingToAdmission: state.missing }))
  }
  return examPointsForGrades(d.points)
}

/** Слова строки блока «Что нужно на экзамене» после «Чтобы получить N, ». */
export function examTargetLine(t: ExamTarget): string {
  if (t.status === 'needs') return `на экзамене нужно ${t.points} из ${EXAM_MAX_POINTS} баллов`
  if (t.status === 'unreachable') return `недостижимо: даже ${EXAM_MAX_POINTS} из ${EXAM_MAX_POINTS} на экзамене не хватит`
  if (t.missingToAdmission === null) return 'сначала нужен допуск, его пока нет'
  return `сначала нужен допуск: не хватает ${t.missingToAdmission} ${pointsWord(t.missingToAdmission)} за семестр`
}

/**
 * Баллы для показа: число ограничено шкалой, от 0 до `max` (по замечанию R-3.3-6). Подпись, полоса и `aria-valuetext`
 * берут это число, а не сырое из базы: «70 из 60» не бывает. Пусто (`null`) остаётся пустым, не нулём.
 */
export function displayPoints(points: number | null, max: number): number | null {
  return points === null ? null : clamp(points, 0, max)
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

// ---------- Экран «Успеваемость»: порядок, фраза-итог, стипендия, «Сессия» (пакет 3.3, этап Б) ----------
// Чистые функции без базы и без часов: «сегодня» приходит аргументом. Экран только рисует их ответ.

/** Строка о стипендии в сводке. Выводится из числа «долг» (`summarizeGrades(...).debt`): отдельного поля в базе нет. */
export const STIPEND_DEBT_LINE = 'Пока есть долг, обычная стипендия не назначается'

/** Строка о стипендии: есть долг — строка, нет долга — null (строки на экране нет). */
export function stipendLine(debt: number): string | null {
  return debt > 0 ? STIPEND_DEBT_LINE : null
}

const SEMESTER_RANK: Record<DisciplineStateKind, number> = {
  debt: 0,
  ahead_no_admission: 1,
  ahead_admitted: 2,
  ahead: 2,
  passed: 3,
}

/**
 * Порядок карточек вида «Семестр»: долги, затем дисциплины без допуска, затем остальные «впереди», затем сданное.
 * Внутри группы — по дате контроля, потом по названию. Входной список не меняется. Фильтра по семестру нет.
 */
export function sortForSemester<T extends FirstActionInput>(items: T[]): T[] {
  return items
    .map((item) => ({ item, rank: SEMESTER_RANK[describeDiscipline(item).kind] }))
    .sort((a, b) => a.rank - b.rank || byDateThenName(a.item, b.item))
    .map((x) => x.item)
}

export interface NearestControl {
  /** `retake` — пересдача долга; `exam`; `credit`. */
  kind: 'retake' | 'exam' | 'credit'
  disciplineId: string
  name: string
  date: string
}

/**
 * Ближайший контроль, который ещё предстоит: экзамен или зачёт «впереди» и пересдача долга; дата не раньше `today`.
 * Сданное не считается. Нет такого — null.
 */
export function nearestControl(items: FirstActionInput[], today: string): NearestControl | null {
  const candidates = items.filter((item) => {
    if (item.examDate === null || item.examDate < today) return false
    const kind = describeDiscipline(item).kind
    return kind !== 'passed'
  })
  const first = [...candidates].sort(byDateThenName)[0]
  if (!first || first.examDate === null) return null
  const kind = describeDiscipline(first).kind === 'debt' ? 'retake' : first.controlKind === 'credit' ? 'credit' : 'exam'
  return { kind, disciplineId: first.disciplineId, name: first.name, date: first.examDate }
}

const NEAREST_WORD: Record<NearestControl['kind'], string> = {
  retake: 'Ближайшая пересдача',
  exam: 'Ближайший экзамен',
  credit: 'Ближайший зачёт',
}

/** Фраза-итог сверху сводки: «Сдано 2 из 7. Есть долг. Ближайшая пересдача — 18 ноября.» */
export function summaryPhrase(items: FirstActionInput[], today: string): string {
  const s = summarizeGrades(items)
  const parts = [`Сдано ${s.passed} из ${items.length}.`]
  parts.push(s.debt === 0 ? 'Долгов нет.' : s.debt === 1 ? 'Есть долг.' : `Долгов: ${s.debt}.`)
  const next = nearestControl(items, today)
  parts.push(next ? `${NEAREST_WORD[next.kind]} — ${formatDayMonth(next.date)}.` : 'Экзаменов и зачётов впереди нет.')
  return parts.join(' ')
}

export interface FirstActionText {
  /** Короткое слово-призыв: «Пересдать», «Добрать баллы», «Подготовиться». */
  lead: string
  /** Дисциплина и пояснение: «Эконометрика, 18 ноября». */
  detail: string
}

/**
 * Слова для строки «что сделать первым». `controlKind` нужен только для ближайшего экзамена или зачёта.
 * `today` — сегодняшний день, ГГГГ-ММ-ДД, приходит аргументом (часов здесь нет): пересдача раньше `today` уже была
 * (по замечанию R-3.3-5), пересдача сегодня ещё предстоит.
 */
export function firstActionText(action: FirstAction, controlKind: string | undefined, today: string): FirstActionText {
  if (action.kind === 'debt') {
    const when = !action.date
      ? 'дата пересдачи не назначена'
      : action.date < today
        ? `пересдача была ${formatDayMonth(action.date)}, новая дата не назначена`
        : `пересдача ${formatDayMonth(action.date)}`
    return { lead: 'Пересдать', detail: `${action.name}, ${when}` }
  }
  if (action.kind === 'no_admission') {
    return {
      lead: 'Добрать баллы',
      detail:
        action.missing !== null
          ? `${action.name}, до допуска не хватает ${action.missing} ${pointsWord(action.missing)}`
          : `${action.name}, допуска пока нет`,
    }
  }
  const word = controlKind === 'credit' ? 'зачёт' : 'экзамен'
  return { lead: 'Подготовиться', detail: `${action.name}, ${word}${action.date ? ` ${formatDayMonth(action.date)}` : ''}` }
}

export interface PointsScale {
  /** Из скольких баллов показывать «N из …». */
  max: number
  /** Отметка допуска на полосе; нет — null (у зачёта и у закрытой дисциплины порога нет). */
  threshold: number | null
  /** `semester` — баллы только за семестр; `total` — сумма (у закрытой дисциплины и у зачёта). */
  kind: 'semester' | 'total'
}

/**
 * Шкала полосы баллов. Экзамен без итога: баллы за семестр, до 60, отметка допуска на 30.
 * Закрытая дисциплина (оценка есть) — в базе одно число, это сумма: до 100, порога нет.
 * Зачёт: правил в источниках нет, показывается число из 100 без порога. Это два отдельных решения:
 * - порога нет — решение участника А от 14.11.2026, первое окно смены 23;
 * - шкалу «из 100» выбрал исполнитель этапа Б; участник А подтвердил её 14.11.2026 в 22:15 МСК, третье окно смены 23.
 */
export function pointsScale(d: Pick<DisciplineStateInput, 'controlKind' | 'outcome'>): PointsScale {
  if (d.controlKind === 'exam' && d.outcome === 'pending') {
    return { max: SEMESTER_MAX_POINTS, threshold: ADMISSION_MIN_SEMESTER_POINTS, kind: 'semester' }
  }
  return { max: TOTAL_MAX_POINTS, threshold: null, kind: 'total' }
}

/**
 * Работы дисциплины по срокам: предстоящие (срок не раньше `today`) — по возрастанию срока; прошедшие — недавние сверху.
 * Входной список не меняется. Работа не теряется и не двоится.
 */
export function splitWorks<T extends { dueDate: string; title: string }>(works: T[], today: string): { upcoming: T[]; past: T[] } {
  const byDue = (a: T, b: T) => (a.dueDate === b.dueDate ? a.title.localeCompare(b.title, 'ru') : a.dueDate < b.dueDate ? -1 : 1)
  const upcoming = works.filter((w) => w.dueDate >= today).sort(byDue)
  const past = works.filter((w) => w.dueDate < today).sort((a, b) => byDue(b, a))
  return { upcoming, past }
}

export interface SessionGroups<T> {
  /** Контроль не раньше сегодняшнего дня; ближайший сверху. */
  upcoming: T[]
  /** Контроль прошёл или дисциплина закрыта без даты; недавний сверху. */
  past: T[]
  /** Итога ещё нет и дата не назначена. */
  undated: T[]
}

/** Раскладка вида «Сессия». Каждая дисциплина попадает ровно в одну группу. */
export function groupSession<T extends FirstActionInput>(items: T[], today: string): SessionGroups<T> {
  const upcoming: T[] = []
  const pastDated: T[] = []
  const pastUndated: T[] = []
  const undated: T[] = []
  for (const item of items) {
    if (item.examDate !== null) (item.examDate >= today ? upcoming : pastDated).push(item)
    else (item.outcome === 'pending' ? undated : pastUndated).push(item)
  }
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'ru')
  upcoming.sort(byDateThenName)
  pastDated.sort((a, b) => (a.examDate === b.examDate ? byName(a, b) : (a.examDate ?? '') < (b.examDate ?? '') ? 1 : -1))
  pastUndated.sort(byName)
  undated.sort(byName)
  return { upcoming, past: [...pastDated, ...pastUndated], undated }
}

/**
 * Строка с датой в виде «Сессия»: «20 декабря, вс, 10:00». Даты нет — «Дата не назначена»;
 * у закрытой дисциплины (по `describeDiscipline`, как в блоке контроля на экране дисциплины) без даты строки нет — null,
 * потому что «дата не назначена» о сданном вводит в заблуждение (по замечанию R-3.3-4).
 */
export function sessionWhenLine(item: FirstActionInput & { examTime: string | null }): string | null {
  if (!item.examDate) return describeDiscipline(item).kind === 'passed' ? null : 'Дата не назначена'
  const parts = [`${formatDayMonth(item.examDate)}, ${weekdayShort(item.examDate)}`]
  if (item.examTime) parts.push(item.examTime)
  return parts.join(', ')
}

export interface SessionStatus {
  /** `admitted` — допущен; `not_admitted` — не допущен; `retake` — пересдача долга; `passed` — уже сдано. */
  kind: 'admitted' | 'not_admitted' | 'retake' | 'passed'
  /** Слово для плашки. */
  word: string
  /** Сколько баллов не хватает до допуска; только у `not_admitted` по экзамену. */
  missing: number | null
}

/** Статус строки предстоящего контроля в виде «Сессия». */
export function sessionStatus(d: DisciplineStateInput): SessionStatus {
  const state = describeDiscipline(d)
  if (state.kind === 'debt') return { kind: 'retake', word: 'Пересдача', missing: null }
  if (state.kind === 'passed') return { kind: 'passed', word: 'Сдано', missing: null }
  if (state.kind === 'ahead_no_admission') return { kind: 'not_admitted', word: 'Не допущен', missing: state.missing }
  return { kind: 'admitted', word: 'Допущен', missing: null }
}
