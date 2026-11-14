// Пакет 3.2: listMyLessons отдаёт поля переноса, а группа берётся из сессии.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { buildCohortPlan } from '../../db/seed-plan'
import { addDays, todayIn } from '@/lib/dates'
import { buildSchedule } from '@/lib/schedule'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as studentDal from '@/server/dal/student'
import { STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor } from './helpers'

let a: Actor
let b: Actor
let staff: Actor
const today = todayIn('Europe/Moscow')
const weekEnd = addDays(today, 6)

beforeAll(async () => {
  ;[a, b, staff] = await Promise.all([actorFor(STUDENT_A), actorFor(STUDENT_B), actorFor(STAFF_MAIN)])
})
afterAll(closeDb)

const plan = buildCohortPlan(MAIN_COHORT, today)
const planFor = (groupName: string) => plan.lessons.filter((l) => l.groupName === groupName && l.date >= today && l.date <= weekEnd)

describe('listMyLessons: поля переноса', () => {
  it('у каждого изменения те же четыре поля, что в наборе: пустые — null', async () => {
    const week = await studentDal.listMyLessons(a, today, weekEnd)
    const expected = planFor(STUDENT_A.groupName).filter((l) => l.change !== null)
    expect(expected.length).toBe(5)
    for (const l of expected) {
      const got = week.find((w) => w.id === l.id)
      expect(got?.change, `${l.discipline} ${l.date}`).toEqual({
        kind: l.change!.kind,
        note: l.change!.note,
        newDate: l.change!.newDate,
        newStartsAt: l.change!.newStartsAt,
        newEndsAt: l.change!.newEndsAt,
        newRoom: l.change!.newRoom,
      })
    }
  })

  it('перенос на другой день несёт дату, время и аудиторию; перенос внутри дня — время без даты; время в виде «ЧЧ:ММ»', async () => {
    const changes = (await studentDal.listMyLessons(a, today, weekEnd)).flatMap((l) => (l.change?.kind === 'moved' ? [l.change] : []))
    expect(changes).toHaveLength(2)
    const otherDay = changes.find((c) => c.newDate !== null)
    const sameDay = changes.find((c) => c.newDate === null)
    expect(otherDay).toBeDefined()
    expect(sameDay).toBeDefined()
    expect(otherDay!.newDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(otherDay!.newStartsAt).toMatch(/^\d{2}:\d{2}$/)
    expect(otherDay!.newEndsAt).toMatch(/^\d{2}:\d{2}$/)
    expect(otherDay!.newRoom).toBe('2-214')
    expect(sameDay!.newStartsAt).toMatch(/^\d{2}:\d{2}$/)
    expect(sameDay!.newRoom).toBeNull()
  })

  it('отмена, смена аудитории и замена преподавателя: поля переноса пусты, кроме новой аудитории при её смене', async () => {
    const week = await studentDal.listMyLessons(a, today, weekEnd)
    const of = (kind: string) => week.find((l) => l.change?.kind === kind)!.change!
    expect(of('cancelled')).toMatchObject({ newDate: null, newStartsAt: null, newEndsAt: null, newRoom: null })
    expect(of('teacher_changed')).toMatchObject({ newDate: null, newStartsAt: null, newEndsAt: null, newRoom: null })
    expect(of('room_changed')).toMatchObject({ newDate: null, newStartsAt: null, newEndsAt: null, newRoom: '2-108' })
  })

  it('пара без изменения: change — null; прежние поля на месте', async () => {
    const week = await studentDal.listMyLessons(a, today, weekEnd)
    const plain = week.filter((l) => l.change === null)
    expect(plain.length).toBeGreaterThan(0)
    for (const l of plain) {
      expect(l).toMatchObject({
        id: expect.any(String),
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        startsAt: expect.stringMatching(/^\d{2}:\d{2}$/),
        endsAt: expect.stringMatching(/^\d{2}:\d{2}$/),
        discipline: expect.any(String),
        kind: expect.any(String),
        room: expect.any(String),
        teacher: expect.any(String),
      })
    }
  })

  it('результат годится для раскладки: перенос на другой день стоит на новом дне, на старом — «Перенесена на …»', async () => {
    // Новая дата переноса зависит от «сегодня»: в субботу она падает на Д+7, за пределы семи дней. Проверка не привязана к дню недели.
    const lessons = await studentDal.listMyLessons(a, today, weekEnd)
    const days = buildSchedule(lessons, today)
    const all = days.flatMap((d) => d.entries)
    const moved = lessons.find((l) => l.change?.kind === 'moved' && l.change.newDate !== null)!
    const from = all.find((e) => e.lessonId === moved.id && e.placement === 'moved_from')
    const to = all.find((e) => e.lessonId === moved.id && e.placement === 'moved_to')
    expect(from?.movedTo).toMatch(/^Перенесена на .*ауд\. 2-214$/)
    expect(days.find((d) => d.entries.includes(from!))!.date).toBe(moved.date)
    if (moved.change!.newDate! <= weekEnd) {
      expect(to).toMatchObject({ room: '2-214', startsAt: moved.change!.newStartsAt })
      expect(to!.was).toMatch(/^Было: /)
      expect(days.find((d) => d.entries.includes(to!))!.date).toBe(moved.change!.newDate)
    } else {
      expect(to).toBeUndefined()
    }
    expect(days.some((d) => d.hasChanges)).toBe(true)
  })
})

describe('listMyLessons: чужие пары и изменения не приходят', () => {
  it('студент другой группы получает только свои пары и свои изменения — ровно как в наборе', async () => {
    const mine = await studentDal.listMyLessons(a, today, weekEnd)
    const theirs = await studentDal.listMyLessons(b, today, weekEnd)
    const mineIds = new Set(mine.map((l) => l.id))
    expect(theirs.length).toBeGreaterThan(0)
    expect(theirs.every((l) => !mineIds.has(l.id))).toBe(true)
    expect(theirs.map((l) => l.id).sort()).toEqual(planFor(STUDENT_B.groupName).map((l) => l.id).sort())
    const expectedChanges = planFor(STUDENT_B.groupName).filter((l) => l.change !== null)
    expect(theirs.filter((l) => l.change !== null).map((l) => l.id).sort()).toEqual(expectedChanges.map((l) => l.id).sort())
  })

  it('ни пара, ни заметка, ни новая аудитория чужой группы в ответе не встречаются', async () => {
    const own = JSON.stringify(await studentDal.listMyLessons(a, today, weekEnd))
    const foreign = JSON.stringify(await studentDal.listMyLessons(b, today, weekEnd))
    const foreignPlan = planFor(STUDENT_B.groupName)
    const minePlan = planFor(STUDENT_A.groupName)
    for (const l of foreignPlan) {
      expect(own).not.toContain(l.id)
      if (l.change) expect(own).not.toContain(l.change.note)
    }
    for (const l of minePlan) {
      expect(foreign).not.toContain(l.id)
      if (l.change) expect(foreign).not.toContain(l.change.note)
    }
    expect(foreign).not.toContain('2-214')
    expect(own).not.toContain('4-404')
  })

  it('группа берётся из сессии: в запрос идут только даты, подмены адреса нет', async () => {
    // У функции нет аргумента для группы: третий и далее аргументы игнорируются.
    const call = studentDal.listMyLessons as unknown as (...args: unknown[]) => Promise<{ id: string }[]>
    const forged = await call(b, today, weekEnd, STUDENT_A.groupName)
    const normal = await studentDal.listMyLessons(b, today, weekEnd)
    expect(forged.map((l) => l.id)).toEqual(normal.map((l) => l.id))
  })

  it('сотрудник получает отказ; неверный промежуток даёт пустой список', async () => {
    await expect(studentDal.listMyLessons(staff, today, weekEnd)).rejects.toBeInstanceOf(ForbiddenError)
    expect(await studentDal.listMyLessons(a, 'мусор', weekEnd)).toEqual([])
    expect(await studentDal.listMyLessons(a, weekEnd, today)).toEqual([])
    expect(await studentDal.listMyLessons(a, today, addDays(today, 40))).toEqual([])
  })
})
