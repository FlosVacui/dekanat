// Номер текущего семестра для шапки (макет М5): наибольший `disciplines.semester` у группы студента из сессии.
// Образец — dal-student.test.ts: вход настоящим путём, действующее лицо из сессии.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import type { Actor as ActorType } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as studentDal from '@/server/dal/student'
import { ALT_COHORT, ALT_STUDENT, STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor } from './helpers'

let a: ActorType
let b: ActorType
let alt: ActorType
let staff: ActorType

/** Ожидание считается из набора данных: наибольший семестр у группы, которой принадлежит студент. */
function expectedSemester(cohort: { groups: { name: string; disciplines: { semester: number }[] }[] }, groupName: string): number {
  const group = cohort.groups.find((g) => g.name === groupName)
  expect(group).toBeDefined()
  return Math.max(...group!.disciplines.map((d) => d.semester))
}

beforeAll(async () => {
  ;[a, b, alt, staff] = await Promise.all([actorFor(STUDENT_A), actorFor(STUDENT_B), actorFor(ALT_STUDENT), actorFor(STAFF_MAIN)])
})
afterAll(closeDb)

describe('текущий семестр — по группе студента из сессии', () => {
  it('у группы дисциплины нескольких семестров: берётся наибольший', async () => {
    const semesters = new Set(MAIN_COHORT.groups.find((g) => g.name === STUDENT_A.groupName)!.disciplines.map((d) => d.semester))
    expect(semesters.size).toBeGreaterThan(1)
    expect(await studentDal.getMyCurrentSemester(a)).toBe(Math.max(...semesters))
  })

  it('студенты двух групп одного набора получают разные номера, каждый свой', async () => {
    expect(STUDENT_A.groupName).not.toBe(STUDENT_B.groupName)
    const mine = await studentDal.getMyCurrentSemester(a)
    const theirs = await studentDal.getMyCurrentSemester(b)
    expect(mine).toBe(expectedSemester(MAIN_COHORT, STUDENT_A.groupName))
    expect(theirs).toBe(expectedSemester(MAIN_COHORT, STUDENT_B.groupName))
    expect(mine).not.toBe(theirs)
  })

  it('студент второго набора получает номер своей группы, а не группы основного набора', async () => {
    expect(await studentDal.getMyCurrentSemester(alt)).toBe(expectedSemester(ALT_COHORT, ALT_STUDENT.groupName))
  })

  it('сотрудник получает отказ: функция только для студента', async () => {
    await expect(studentDal.getMyCurrentSemester(staff)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
