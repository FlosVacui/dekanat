// Набор баллов за работы и материалов курса без базы (заход Б редизайна). Главное — согласие чисел: сумма баллов за сданные
// работы дисциплины равна баллам за семестр в `grades`; экзамен не набирает за работы больше 60; баллы не больше максимума.
// Проверяются основной набор и оба резервных: резервы строятся из основного (seed-reserve-lib.ts), но свои проверки у них есть.
import { describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { buildCohortPlan, type CohortSpec } from '../../db/seed-plan'
import { RESERVES, buildReserveCohort } from '../../db/seed-reserve-lib'
import { addDays } from '../../src/lib/dates'
import { SEMESTER_MAX_POINTS, summarizeWorks, workStatus } from '../../src/lib/grades'

// Дни набора — любой день недели: статус не должен зависеть от дня запуска.
const DAYS = Array.from({ length: 14 }, (_, i) => addDays('2026-11-23', i))

const reserveAccounts = (n: number) => ({
  staff: { login: `rsv${n}-staff`, password: 'x'.repeat(24) },
  students: [
    { login: `rsv${n}-one`, password: 'y'.repeat(24) },
    { login: `rsv${n}-two`, password: 'z'.repeat(24) },
  ] as [{ login: string; password: string }, { login: string; password: string }],
})

const COHORTS: { name: string; spec: CohortSpec }[] = [
  { name: 'основной', spec: MAIN_COHORT },
  ...RESERVES.map((def) => ({ name: `резерв ${def.n}`, spec: buildReserveCohort(MAIN_COHORT, def, reserveAccounts(def.n)) })),
]

describe.each(COHORTS)('набор «$name»: баллы за работы', ({ spec }) => {
  const plan = buildCohortPlan(spec, '2026-11-23')

  it('у каждого студента сумма баллов сданных работ равна баллам за семестр по каждой дисциплине с работами', () => {
    let checked = 0
    for (const student of plan.students) {
      for (const grade of student.grades) {
        const discipline = plan.disciplines.find((d) => d.id === grade.disciplineId)!
        if (discipline.assignments.length === 0) continue
        const ids = new Set(discipline.assignments.map((a) => a.id))
        const sum = student.workResults.filter((r) => ids.has(r.assignmentId)).reduce((total, r) => total + r.points, 0)
        expect(sum, `${student.spec.login}: «${grade.discipline}»`).toBe(grade.points)
        checked += 1
      }
    }
    expect(checked, 'проверка не должна быть пустой').toBe(8)
  })

  it('баллы за работу — целое от 0 до максимума работы; работа есть в группе студента; пара «студент — работа» не повторяется', () => {
    for (const student of plan.students) {
      const seen = new Set<string>()
      for (const result of student.workResults) {
        const discipline = plan.disciplines.find((d) => d.groupName === student.spec.groupName && d.name === result.discipline)
        const work = discipline?.assignments.find((a) => a.id === result.assignmentId)
        expect(work, `${student.spec.login}: «${result.discipline}» / ${result.assignmentKey}`).toBeDefined()
        expect(Number.isInteger(result.points)).toBe(true)
        expect(result.points).toBeGreaterThanOrEqual(0)
        expect(result.points).toBeLessThanOrEqual(work!.maxPoints)
        expect(seen.has(result.assignmentId), 'повтор пары «студент — работа»').toBe(false)
        seen.add(result.assignmentId)
      }
    }
  })

  it(`сумма максимумов работ экзамена — не больше ${SEMESTER_MAX_POINTS}; у зачёта — не больше 100`, () => {
    for (const d of plan.disciplines) {
      const total = d.assignments.reduce((sum, a) => sum + a.maxPoints, 0)
      const controlKind = spec.groups.flatMap((g) => g.disciplines).find((s) => s.name === d.name)!.controlKind
      expect(total, `«${d.name}»`).toBeLessThanOrEqual(controlKind === 'exam' ? SEMESTER_MAX_POINTS : 100)
    }
  })

  /** Текущий семестр группы — самый поздний среди её дисциплин. */
  const currentOf = (groupName: string) => Math.max(...plan.disciplines.filter((d) => d.groupName === groupName).map((d) => d.semester))

  it('у дисциплин прошлых семестров и у «Основы проектной работы» работ и баллов за работы нет', () => {
    const empty = plan.disciplines.filter((x) => x.semester < currentOf(x.groupName) || x.name === 'Основы проектной работы')
    expect(empty.length, 'проверка не должна быть пустой').toBeGreaterThan(0)
    for (const d of empty) expect(d.assignments, d.name).toEqual([])
  })

  it('материалы: у каждой дисциплины текущего семестра три названия, у прошлых семестров материалов нет', () => {
    for (const d of plan.disciplines) {
      if (d.semester < currentOf(d.groupName)) expect(d.materials, d.name).toEqual([])
      else {
        const titles = d.materials.map((m) => m.title)
        const controlKind = spec.groups.flatMap((g) => g.disciplines).find((s) => s.name === d.name)!.controlKind
        expect(titles, d.name).toEqual(['Программа курса', controlKind === 'exam' ? 'Вопросы к экзамену' : 'Вопросы к зачёту', 'Лекция 1 — слайды'])
        expect(d.materials.map((m) => m.position)).toEqual([1, 2, 3])
      }
    }
  })
})

describe('статус работ не зависит от дня запуска', () => {
  it.each(DAYS)('Д = %s: сдано 23, долг 2, впереди 6; долг — строго до Д, «впереди» — не раньше Д', (today) => {
    const plan = buildCohortPlan(MAIN_COHORT, today)
    let done = 0
    let debt = 0
    let upcoming = 0
    for (const student of plan.students) {
      const own = new Set(student.workResults.map((r) => r.assignmentId))
      const works = plan.disciplines.filter((d) => d.groupName === student.spec.groupName).flatMap((d) => d.assignments)
      const summary = summarizeWorks(works.map((w) => ({ dueDate: w.dueDate, points: own.has(w.id) ? 1 : null })), today)
      done += summary.done
      debt += summary.debt
      upcoming += summary.upcoming
      for (const w of works) {
        const status = workStatus({ dueDate: w.dueDate, points: own.has(w.id) ? 1 : null }, today)
        if (status === 'debt') expect(w.dueDate < today, `${w.title}: срок ${w.dueDate}`).toBe(true)
        if (status === 'upcoming') expect(w.dueDate >= today, `${w.title}: срок ${w.dueDate}`).toBe(true)
      }
    }
    expect({ done, debt, upcoming }).toEqual({ done: 23, debt: 2, upcoming: 6 })
  })

  it('ошибка набора: баллы выше максимума или работа, которой нет, — отказ при построении', () => {
    const broken = structuredClone(MAIN_COHORT)
    broken.students[0]!.workResults!.push({ discipline: 'Микроэкономика', assignmentKey: 'rz3', points: 16 })
    expect(() => buildCohortPlan(broken, '2026-11-23')).toThrow(/при максимуме 15/)
    const missing = structuredClone(MAIN_COHORT)
    missing.students[0]!.workResults!.push({ discipline: 'Микроэкономика', assignmentKey: 'нет-такой', points: 1 })
    expect(() => buildCohortPlan(missing, '2026-11-23')).toThrow(/нет в группе/)
  })
})
