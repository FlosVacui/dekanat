// Что должно быть на экране «Успеваемость» по данным плана основного набора (db/seed-plan.ts), а не по числу или дате в тесте.
// План считается тем же кодом, что заполнил базу, от того же «сегодня»: даты контроля и сроков работ привязаны ко дню заполнения базы.
// Расчёт здесь свой, короткий, без функций экрана (src/lib/grades.ts): тест не проверяет функцию её же ответом. Модульный тест
// tests/unit/grades-plan-days.test.ts сверяет этот расчёт с функциями экрана на 14 днях подряд.
//
// Файл не подключает Playwright и не читает часы: «сегодня» приходит аргументом.
import { MAIN_COHORT } from '../../../db/seed-data'
import { buildCohortPlan } from '../../../db/seed-plan'
import { formatDayMonth } from '../../../src/lib/dates'

export interface PlannedRow {
  id: string
  name: string
  controlKind: 'exam' | 'credit'
  semester: number
  examDate: string | null
  examTime: string | null
  examRoom: string | null
  points: number | null
  outcome: string
  admitted: boolean
  works: { title: string; dueDate: string; maxPoints: number }[]
  /** Состояние словом для теста: `debt`, `passed`, `no_admission` (допуска нет), `admitted` (впереди, допуск есть). */
  state: 'debt' | 'passed' | 'no_admission' | 'admitted'
  /** Сколько баллов не хватает до допуска (экзамен без допуска по баллам); иначе 0. */
  missing: number
}

export interface GradesPlan {
  today: string
  /** Дисциплины студента, у которого логин `login`, в порядке плана. */
  rows: PlannedRow[]
  passed: number
  debt: number
  ahead: number
  /** Фраза-итог, как её должен собрать экран. */
  phrase: string
  /** Ближайший контроль, который ещё предстоит (пересдача долга, экзамен, зачёт): имя и дата. */
  nearest: { name: string; date: string; word: string } | undefined
  /** Порядок карточек вида «Семестр»: долги, недопуски, остальное «впереди», сданное. */
  semesterOrder: string[]
  /** Предстоящие по дате, затем прошедшие (дата вперёд — по возрастанию, прошедшие — по убыванию). */
  sessionUpcoming: string[]
  sessionPast: string[]
  /** Номера дисциплин другой группы: чужие для этого студента. */
  foreignIds: string[]
}

const PASSED = new Set(['5', '4', '3', 'credit'])
const DEBT = new Set(['2', 'no_credit'])

function stateOf(kind: 'exam' | 'credit', outcome: string, points: number | null, admitted: boolean): Pick<PlannedRow, 'state' | 'missing'> {
  if (DEBT.has(outcome)) return { state: 'debt', missing: 0 }
  if (PASSED.has(outcome)) return { state: 'passed', missing: 0 }
  // Экзамен: допуск — не меньше 30 баллов за семестр И признак «допущен». Зачёт: только признак (порога нет).
  const missing = kind === 'exam' ? Math.max(0, 30 - (points ?? 0)) : 0
  return admitted && missing === 0 ? { state: 'admitted', missing: 0 } : { state: 'no_admission', missing }
}

export function planGrades(today: string, login: string): GradesPlan {
  const plan = buildCohortPlan(MAIN_COHORT, today)
  const student = plan.students.find((s) => s.spec.login === login)
  if (!student) throw new Error(`В плане набора нет студента ${login}`)
  const group = plan.groups.find((g) => g.id === student.groupId)
  if (!group) throw new Error(`В плане набора нет группы студента ${login}`)
  const rows: PlannedRow[] = student.grades.map((g) => {
    const d = plan.disciplines.find((x) => x.id === g.disciplineId)
    if (!d) throw new Error(`В плане нет дисциплины ${g.discipline}`)
    return {
      id: d.id,
      name: d.name,
      controlKind: d.controlKind,
      semester: d.semester,
      examDate: d.examDate,
      examTime: d.examTime,
      examRoom: d.examRoom,
      points: g.points,
      outcome: g.outcome,
      admitted: g.admitted,
      works: d.assignments.map((a) => ({ title: a.title, dueDate: a.dueDate, maxPoints: a.maxPoints })),
      ...stateOf(d.controlKind, g.outcome, g.points, g.admitted),
    }
  })
  const passed = rows.filter((r) => r.state === 'passed').length
  const debt = rows.filter((r) => r.state === 'debt').length
  const ahead = rows.length - passed - debt

  const byDateThenName = (a: PlannedRow, b: PlannedRow) =>
    (a.examDate ?? '9999-99-99').localeCompare(b.examDate ?? '9999-99-99') || a.name.localeCompare(b.name, 'ru')
  const future = rows.filter((r) => r.state !== 'passed' && r.examDate !== null && r.examDate >= today).sort(byDateThenName)
  const first = future[0]
  const nearest = first
    ? {
        name: first.name,
        date: first.examDate!,
        word: first.state === 'debt' ? 'Ближайшая пересдача' : first.controlKind === 'credit' ? 'Ближайший зачёт' : 'Ближайший экзамен',
      }
    : undefined
  const phrase = [
    `Сдано ${passed} из ${rows.length}.`,
    debt === 0 ? 'Долгов нет.' : debt === 1 ? 'Есть долг.' : `Долгов: ${debt}.`,
    nearest ? `${nearest.word} — ${formatDayMonth(nearest.date)}.` : 'Экзаменов и зачётов впереди нет.',
  ].join(' ')

  const rank = { debt: 0, no_admission: 1, admitted: 2, passed: 3 } as const
  const semesterOrder = [...rows].sort((a, b) => rank[a.state] - rank[b.state] || byDateThenName(a, b)).map((r) => r.name)

  const dated = rows.filter((r) => r.examDate !== null)
  const sessionUpcoming = dated
    .filter((r) => r.examDate! >= today)
    .sort(byDateThenName)
    .map((r) => r.name)
  const pastDated = dated
    .filter((r) => r.examDate! < today)
    .sort((a, b) => b.examDate!.localeCompare(a.examDate!) || a.name.localeCompare(b.name, 'ru'))
  const pastUndated = rows.filter((r) => r.examDate === null && r.outcome !== 'pending').sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const sessionPast = [...pastDated, ...pastUndated].map((r) => r.name)

  const foreignIds = plan.disciplines.filter((d) => d.groupName !== group.name).map((d) => d.id)
  return { today, rows, passed, debt, ahead, phrase, nearest, semesterOrder, sessionUpcoming, sessionPast, foreignIds }
}

/** «1 балл», «2 балла», «8 баллов», «11 баллов», «21 балл». Своя короткая запись, не функция экрана. */
export function scoreWord(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 14) return 'баллов'
  if (n % 10 === 1) return 'балл'
  if (n % 10 >= 2 && n % 10 <= 4) return 'балла'
  return 'баллов'
}

/** Что должно стоять в строках «Что нужно на экзамене» для оценок 3, 4 и 5 при баллах за семестр `points` (правила: 50/70/85, минимум 20, максимум 40). */
export function expectedExamNeeds(points: number | null): string[] {
  const sem = Math.min(60, Math.max(0, points ?? 0))
  const missing = Math.max(0, 30 - sem)
  return [
    [3, 50],
    [4, 70],
    [5, 85],
  ].map(([grade, min]) => {
    if (missing > 0) return `Чтобы получить ${grade}, сначала нужен допуск: не хватает ${missing} ${scoreWord(missing)} за семестр`
    const need = Math.max(20, min! - sem)
    return need > 40
      ? `Чтобы получить ${grade}, недостижимо: даже 40 из 40 на экзамене не хватит`
      : `Чтобы получить ${grade}, на экзамене нужно ${need} из 40 баллов`
  })
}
