// Э-10 «Профиль» (ЯД-1): у обоих студентов основного набора заполнены все пять полей, значения различаются.
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb } from '@/server/dal/client'
import { getMyProfile } from '@/server/dal/student'
import { STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor } from './helpers'

afterAll(closeDb)

const FIELDS = ['fullName', 'faculty', 'programme', 'course', 'groupName'] as const

describe('профиль студента', () => {
  it('все пять полей заполнены у обоих студентов основного набора', async () => {
    for (const student of [STUDENT_A, STUDENT_B]) {
      const profile = await getMyProfile(await actorFor(student))
      expect(profile, student.login).not.toBeNull()
      expect(Object.keys(profile!).sort()).toEqual([...FIELDS].sort())
      for (const field of FIELDS) {
        const value = profile![field]
        expect(value, `${student.login}: ${field}`).not.toBeNull()
        expect(String(value).trim(), `${student.login}: ${field} пусто`).not.toBe('')
      }
      expect(profile!.course).toBeGreaterThanOrEqual(1)
    }
  })

  it('значения полей у двух студентов различаются; каждый видит только свой профиль', async () => {
    const a = await getMyProfile(await actorFor(STUDENT_A))
    const b = await getMyProfile(await actorFor(STUDENT_B))
    for (const field of FIELDS) expect(a![field], field).not.toEqual(b![field])
    expect(a).toEqual({
      fullName: STUDENT_A.fullName,
      faculty: STUDENT_A.faculty,
      programme: STUDENT_A.programme,
      course: STUDENT_A.course,
      groupName: STUDENT_A.groupName,
    })
  })
})
