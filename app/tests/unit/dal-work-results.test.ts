// Баллы за работы, преподаватели и материалы в слое доступа (заход Б редизайна), по образцу dal-student.test.ts.
// Главное — чужие баллы: студент видит только свои, и это проверено на соседе по группе (общие работы, разные баллы),
// на студенте другой группы и по номеру дисциплины. Владелец — из сессии: номера студента у функций нет.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { buildCohortPlan } from '../../db/seed-plan'
import { todayIn } from '@/lib/dates'
import { hashPassword } from '@/server/auth/password'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as studentDal from '@/server/dal/student'
import { STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor, withOwner } from './helpers'

const today = todayIn('Europe/Moscow')
const CLASSMATE = { login: 'test-classmate-works', password: 'тест-одногруппник-баллы-1' }
// Баллы соседа по группе: на единицу меньше баллов студента А у каждой его сданной работы — «чужие» числа видны сразу.
const plan = buildCohortPlan(MAIN_COHORT, today)

let a: Actor
let b: Actor
let classmate: Actor
let staff: Actor

beforeAll(async () => {
  ;[a, b, staff] = await Promise.all([actorFor(STUDENT_A), actorFor(STUDENT_B), actorFor(STAFF_MAIN)])
  const hash = await hashPassword(CLASSMATE.password)
  await withOwner(async (c) => {
    await c.query(`DELETE FROM users WHERE login = $1`, [CLASSMATE.login])
    const group = await c.query(
      `SELECT s.group_id, s.faculty FROM students s JOIN users u ON u.id = s.user_id WHERE u.login = $1`,
      [STUDENT_A.login],
    )
    const user = await c.query(
      `INSERT INTO users (login, password_hash, role, cohort, password_published) VALUES ($1, $2, 'student', 'main', false) RETURNING id`,
      [CLASSMATE.login, hash],
    )
    const id = user.rows[0].id as string
    await c.query(
      `INSERT INTO students (user_id, full_name, faculty, programme, course, group_id) VALUES ($1, 'Соседов Сосед Соседович', $2, 'Экономика', 3, $3)`,
      [id, group.rows[0].faculty, group.rows[0].group_id],
    )
    await c.query(
      `INSERT INTO assignment_results (student_id, assignment_id, points)
       SELECT $1, r.assignment_id, GREATEST(r.points - 1, 0) FROM assignment_results r
       JOIN students s ON s.user_id = r.student_id JOIN users u ON u.id = s.user_id WHERE u.login = $2`,
      [id, STUDENT_A.login],
    )
  })
  classmate = await actorFor(CLASSMATE)
})

afterAll(async () => {
  await withOwner((c) => c.query(`DELETE FROM users WHERE login = $1`, [CLASSMATE.login]))
  await closeDb()
})

const pointsOf = (works: { id: string; points: number | null }[]) => Object.fromEntries(works.map((w) => [w.id, w.points]))

async function myDisciplines(actor: Actor) {
  const list = await studentDal.listMyGrades(actor, today)
  const details = await Promise.all(list.map((d) => studentDal.getMyDiscipline(actor, d.disciplineId)))
  return { list, details: details.map((d) => d!) }
}

describe('баллы за работы — только свои', () => {
  it('студент А видит свои баллы в списке и на странице предмета; они равны набору', async () => {
    const { list, details } = await myDisciplines(a)
    const mine = new Map(plan.students.find((s) => s.spec.login === STUDENT_A.login)!.workResults.map((r) => [r.assignmentId, r.points]))
    let seen = 0
    for (const d of list) {
      for (const w of d.works) {
        expect(w.points, `${d.name}: ${w.title}`).toBe(mine.get(w.id) ?? null)
        if (w.points !== null) seen += 1
      }
    }
    expect(seen, 'проверка не должна быть пустой').toBe(mine.size)
    for (const d of details) {
      for (const w of d.assignments) expect(w.points).toBe(mine.get(w.id) ?? null)
      // Список и страница предмета дают одни и те же работы и баллы.
      expect(pointsOf(d.assignments)).toEqual(pointsOf(list.find((x) => x.disciplineId === d.disciplineId)!.works))
    }
  })

  it('сосед по группе: те же работы, но свои баллы; чужих чисел в ответе нет ни списком, ни по номеру дисциплины', async () => {
    const mine = await myDisciplines(a)
    const theirs = await myDisciplines(classmate)
    expect(theirs.list.map((d) => d.disciplineId).sort()).toEqual(mine.list.map((d) => d.disciplineId).sort())
    let compared = 0
    for (const d of mine.list) {
      const other = theirs.list.find((x) => x.disciplineId === d.disciplineId)!
      expect(other.works.map((w) => w.id)).toEqual(d.works.map((w) => w.id))
      for (const w of d.works) {
        const wOther = other.works.find((x) => x.id === w.id)!
        if (w.points === null) {
          // Работа не сдана у А: у соседа тоже нет баллов, чужих не подставлено.
          expect(wOther.points, `${d.name}: ${w.title}`).toBeNull()
        } else {
          expect(wOther.points, `${d.name}: ${w.title}`).toBe(Math.max(w.points - 1, 0))
          expect(wOther.points).not.toBe(w.points)
          compared += 1
        }
      }
    }
    expect(compared).toBeGreaterThan(0)
    // Страница предмета: то же самое по номеру дисциплины.
    for (const d of mine.details) {
      const other = theirs.details.find((x) => x.disciplineId === d.disciplineId)!
      for (const w of d.assignments) {
        const wOther = other.assignments.find((x) => x.id === w.id)!
        expect(wOther.points).toBe(w.points === null ? null : Math.max(w.points - 1, 0))
      }
    }
  })

  it('студент другой группы: чужой номер дисциплины — тот же отказ, что у несуществующего; баллы первого в его ответах нет', async () => {
    const mine = await myDisciplines(a)
    const theirs = await myDisciplines(b)
    const mineIds = new Set(mine.list.map((d) => d.disciplineId))
    for (const d of theirs.list) expect(mineIds.has(d.disciplineId)).toBe(false)
    expect(await studentDal.getMyDiscipline(a, theirs.list[0]!.disciplineId)).toBeNull()
    expect(await studentDal.getMyDiscipline(b, mine.list[0]!.disciplineId)).toBeNull()
    expect(await studentDal.getMyDiscipline(a, '00000000-0000-4000-8000-000000000000')).toBeNull()
    // В ответе Б — только работы его группы, с его баллами.
    const resultsB = new Map(plan.students.find((s) => s.spec.login === STUDENT_B.login)!.workResults.map((r) => [r.assignmentId, r.points]))
    const workIdsA = new Set(mine.list.flatMap((d) => d.works.map((w) => w.id)))
    for (const d of theirs.list) {
      for (const w of d.works) {
        expect(workIdsA.has(w.id)).toBe(false)
        expect(w.points).toBe(resultsB.get(w.id) ?? null)
      }
    }
    expect(JSON.stringify(theirs)).not.toContain(MAIN_COHORT.students[0]!.fullName)
  })

  it('сотрудник не получает баллов: у функций студента отказ', async () => {
    await expect(studentDal.listMyGrades(staff, today)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(studentDal.getMyDiscipline(staff, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('преподаватели и материалы страницы предмета', () => {
  it('преподаватели — различные из пар дисциплины этой группы, по алфавиту; у дисциплины без пар их нет', async () => {
    const { details } = await myDisciplines(a)
    const micro = details.find((d) => d.name === 'Микроэкономика')!
    expect(micro.teachers).toEqual(['Громов Е. В.'])
    const english = details.find((d) => d.name === 'Деловой английский')!
    expect(english.teachers).toEqual(['Мельник Д. О.'])
    const past = details.find((d) => d.name === 'Статистика')!
    expect(past.teachers).toEqual([])
    // Преподаватели другой группы в ответе нет.
    expect(JSON.stringify(details)).not.toContain('Зайцев')
    const other = await myDisciplines(b)
    expect(other.details.find((d) => d.name === 'Физика')!.teachers).toEqual(['Белова С. А.'])
    expect(other.details.find((d) => d.name === 'Основы проектной работы')!.teachers).toEqual([])
  })

  it('материалы — названиями по порядку; у прошлых семестров их нет', async () => {
    const { details } = await myDisciplines(a)
    expect(details.find((d) => d.name === 'Микроэкономика')!.materials).toEqual(['Программа курса', 'Вопросы к экзамену', 'Лекция 1 — слайды'])
    expect(details.find((d) => d.name === 'Логистика цепей поставок')!.materials).toEqual(['Программа курса', 'Вопросы к зачёту', 'Лекция 1 — слайды'])
    expect(details.find((d) => d.name === 'Статистика')!.materials).toEqual([])
  })
})
