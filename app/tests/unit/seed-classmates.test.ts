// 20.11, рейтинг в демо: одногруппники студентов 1 и 2 — вымышленные люди без входа, а итоги прошлого семестра дают
// студенту 1 место в середине группы, студентке 2 — в верхней трети. Тест читает базу, заполненную globalSetup (основной набор).
import { afterAll, describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { buildCohortPlan } from '../../db/seed-plan'
import { todayIn } from '@/lib/dates'
import { ratingLine } from '@/lib/grades'
import { authenticate } from '@/server/auth/login'
import { describeHash } from '@/server/auth/password'
import { closeDb } from '@/server/dal/client'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { STAFF_MAIN } from './fixtures'
import { actorFor, freshIp, withOwner } from './helpers'

const plan = buildCohortPlan(MAIN_COHORT, todayIn('Europe/Moscow'))
const [student1, student2] = MAIN_COHORT.students

afterAll(async () => {
  await closeDb()
})

describe('одногруппники в наборе (чистый расчёт)', () => {
  it('по 20 в каждой из двух групп, ФИО не повторяются и не совпадают с ФИО студентов набора', () => {
    const byGroup = new Map<string, number>()
    for (const c of plan.classmates) byGroup.set(c.spec.groupName, (byGroup.get(c.spec.groupName) ?? 0) + 1)
    expect([...byGroup.values()]).toEqual([20, 20])
    const names = [...plan.classmates.map((c) => c.spec.fullName), ...MAIN_COHORT.students.map((s) => s.fullName)]
    expect(new Set(names).size).toBe(names.length)
  })

  it('в описании нет логинов и паролей; служебные логины не совпадают с логинами набора и друг с другом', () => {
    for (const c of MAIN_COHORT.classmates ?? []) {
      expect(Object.keys(c).sort()).toEqual(['course', 'faculty', 'fullName', 'grades', 'groupName', 'programme'])
    }
    const logins = [...plan.classmates.map((c) => c.login), ...MAIN_COHORT.students.map((s) => s.login), MAIN_COHORT.staff.login]
    expect(new Set(logins).size).toBe(logins.length)
    expect(plan.classmates.every((c) => /^arhiv-[0-9a-f]{12}$/.test(c.login))).toBe(true)
  })

  it('итоги — по дисциплинам прошлого семестра группы, а не текущего', () => {
    for (const c of plan.classmates) {
      for (const g of c.grades) {
        const d = plan.disciplines.find((x) => x.id === g.disciplineId)
        expect(d?.semester, `${c.spec.fullName}: ${g.discipline}`).toBeLessThan(
          Math.max(...plan.disciplines.filter((x) => x.groupName === c.spec.groupName).map((x) => x.semester)),
        )
      }
    }
  })
})

describe('рейтинг студентов 1 и 2 в демо-наборе', () => {
  it('студент 1: средний балл 3,0 за 4 семестр, место 8 из 21 — в середине группы', async () => {
    const actor = await actorFor({ login: student1!.login, password: student1!.password })
    const rating = await studentDal.getMyRating(actor)
    expect(rating).toEqual({ semester: 4, average: 3, place: 8, groupSize: 21 })
    expect(ratingLine(rating!)).toBe('Средний балл 3,0 · место 8 из 21 в группе')
  })

  it('студентка 2: средний балл 5,0 за 2 семестр, место 1 из 21 — верхняя треть', async () => {
    const actor = await actorFor({ login: student2!.login, password: student2!.password })
    const rating = await studentDal.getMyRating(actor)
    expect(rating).toEqual({ semester: 2, average: 5, place: 1, groupSize: 21 })
  })
})

describe('одногруппники в базе: вход невозможен', () => {
  it('записи есть, пароль не опубликован, хеш в формате scrypt со своей солью у каждого, пароль к ним не подходит', async () => {
    const rows = await withOwner(async (c) => (await c.query(`select login, password_hash, password_published, role from users where login like 'arhiv-%' and cohort = 'main'`)).rows)
    expect(rows).toHaveLength(40)
    for (const row of rows) {
      expect(row.role).toBe('student')
      expect(row.password_published).toBe(false)
      expect(describeHash(row.password_hash as string)).not.toBeNull()
    }
    expect(new Set(rows.map((r) => (r.password_hash as string).split('$')[2])).size).toBe(40)
    const first = rows[0]!.login as string
    for (const guess of ['demo-student-1-2026', 'demo-student-2-2026', first, 'password']) {
      const outcome = await authenticate(first, guess, freshIp())
      expect(outcome.ok).toBe(false)
    }
  })

  it('кабинет сотрудника видит всех: список студентов и карточка одногруппника', async () => {
    const staff = await actorFor(STAFF_MAIN)
    const list = await staffDal.listCohortStudents(staff)
    expect(list.length).toBeGreaterThanOrEqual(42)
    const classmate = list.find((s) => s.fullName === 'Антонова Мария Сергеевна')
    expect(classmate).toBeTruthy()
    const card = await staffDal.getCohortStudent(staff, classmate!.id)
    expect(card?.groupName).toBe('ЦЭ-24-03')
    expect(card?.requests).toEqual([])
    expect(card?.questions).toEqual([])
    expect(card?.disciplines.find((d) => d.name === 'Статистика')?.outcome).toBe('5')
  })
})
