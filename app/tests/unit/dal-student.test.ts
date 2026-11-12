import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { todayIn } from '@/lib/dates'
import { Actor, type Actor as ActorType } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { ALT_STUDENT, STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor } from './helpers'

let a: ActorType
let b: ActorType
let staff: ActorType
const today = todayIn('Europe/Moscow')

beforeAll(async () => {
  ;[a, b, staff] = await Promise.all([actorFor(STUDENT_A), actorFor(STUDENT_B), actorFor(STAFF_MAIN)])
})
afterAll(closeDb)

const NOT_A_REQUEST = '00000000-0000-4000-8000-000000000000'

describe('чужая запись и несуществующая — один ответ «нет такой записи» (П-01, П-02)', () => {
  it('заявка', async () => {
    const created = await studentDal.createMyRequest(b, { kind: 'dean_certificate' }, 'test')
    expect(created).not.toBeNull()
    const foreign = await studentDal.getMyRequest(a, created!.id)
    const missing = await studentDal.getMyRequest(a, NOT_A_REQUEST)
    const notUuid = await studentDal.getMyRequest(a, '1; drop table requests')
    expect(foreign).toBeNull()
    expect(missing).toBeNull()
    expect(notUuid).toBeNull()
    expect(await studentDal.getMyRequest(b, created!.id)).not.toBeNull()
  })

  it('дисциплина чужой группы', async () => {
    const mine = await studentDal.listMyGrades(a, today)
    const theirs = await studentDal.listMyGrades(b, today)
    expect(mine.length).toBeGreaterThan(0)
    expect(await studentDal.getMyDiscipline(a, theirs[0]!.disciplineId)).toBeNull()
    expect(await studentDal.getMyDiscipline(a, NOT_A_REQUEST)).toBeNull()
    expect(await studentDal.getMyDiscipline(a, mine[0]!.disciplineId)).not.toBeNull()
  })
})

describe('метки: у каждого студента своя метка в профиле, расписании, оценках, заявках, уведомлениях', () => {
  async function collect(actor: ActorType) {
    const profile = await studentDal.getMyProfile(actor)
    const weekEnd = new Date(`${today}T00:00:00Z`)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
    const week = await studentDal.listMyLessons(actor, today, weekEnd.toISOString().slice(0, 10))
    const grades = await studentDal.listMyGrades(actor, today)
    const requests = await studentDal.listMyRequests(actor)
    const details = await Promise.all(requests.map((r) => studentDal.getMyRequest(actor, r.id)))
    const notifications = await studentDal.listMyNotifications(actor)
    const announcements = await studentDal.listMyUnreadAnnouncements(actor)
    const due = await studentDal.listMyAssignmentsDue(actor, today, weekEnd.toISOString().slice(0, 10))
    return { profile, week, grades, requests, details, notifications, announcements, due }
  }

  it('свои метки видны', async () => {
    const mine = await collect(a)
    expect(JSON.stringify(mine.profile)).toContain(STUDENT_A.markers.profile)
    expect(JSON.stringify(mine.week)).toContain(STUDENT_A.markers.schedule)
    expect(JSON.stringify(mine.grades)).toContain(STUDENT_A.markers.grades)
    expect(JSON.stringify(mine.details)).toContain(STUDENT_A.markers.requests)
    expect(JSON.stringify(mine.notifications)).toContain(STUDENT_A.markers.notifications)
  })

  it('чужих меток нет ни в одном ответе: A не видит B и B не видит A', async () => {
    for (const [viewer, other] of [
      [a, STUDENT_B],
      [b, STUDENT_A],
    ] as const) {
      const everything = JSON.stringify(await collect(viewer))
      for (const marker of Object.values(other.markers)) expect(everything).not.toContain(marker)
      expect(everything).not.toContain(other.fullName)
    }
  })

  it('метки второго набора тоже не просачиваются', async () => {
    const everything = JSON.stringify(await collect(a)) + JSON.stringify(await collect(b))
    for (const marker of Object.values(ALT_STUDENT.markers)) expect(everything).not.toContain(marker)
  })

  it('хеша пароля и внутренних полей в ответах нет', async () => {
    const everything = JSON.stringify(await collect(a))
    expect(everything).not.toMatch(/scrypt\$/)
    expect(everything).not.toMatch(/passwordHash|password_hash|tokenHash/i)
  })

  it('расписание принадлежит группе: сегодня есть пары, изменение видно', async () => {
    const day = await studentDal.listMyLessons(a, today, today)
    expect(day.length).toBeGreaterThan(0)
    expect(day[0]).toMatchObject({ room: expect.any(String), teacher: expect.any(String) })
    const nextDate = new Date(`${today}T00:00:00Z`)
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const tomorrow = nextDate.toISOString().slice(0, 10)
    const changed = await studentDal.listMyLessons(a, tomorrow, tomorrow)
    expect(changed.some((l) => l.change !== null)).toBe(true)
  })

  it('в успеваемости есть и оценка, и зачёт (ошибка смены 6)', async () => {
    for (const [actor, student] of [
      [a, STUDENT_A],
      [b, STUDENT_B],
    ] as const) {
      const rows = await studentDal.listMyGrades(actor, today)
      expect(rows.length).toBe(student.grades.length)
      expect(rows.some((r) => r.outcome === 'credit')).toBe(true)
      expect(rows.some((r) => ['5', '4', '3'].includes(r.outcome))).toBe(true)
    }
  })

  it('разные группы: расписание и профиль у студентов разные', async () => {
    const [pa, pb] = [await studentDal.getMyProfile(a), await studentDal.getMyProfile(b)]
    expect(pa?.groupName).not.toBe(pb?.groupName)
    expect(pa?.faculty).not.toBe(pb?.faculty)
  })
})

describe('роли (П-05): студент не вызывает функции сотрудника, сотрудник — функции студента', () => {
  it('студент получает отказ на каждой функции сотрудника', async () => {
    const id = NOT_A_REQUEST
    await expect(staffDal.listCohortRequests(a)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.getCohortRequest(a, id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.changeRequestStatus(a, id, { target: 'ready' })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('сотрудник получает отказ на каждой функции студента', async () => {
    const calls: (() => Promise<unknown>)[] = [
      () => studentDal.getMyProfile(staff),
      () => studentDal.listMyLessons(staff, today, today),
      () => studentDal.listMyGrades(staff, today),
      () => studentDal.getMyDiscipline(staff, NOT_A_REQUEST),
      () => studentDal.listMyAssignmentsDue(staff, today, today),
      () => studentDal.listMyRequests(staff),
      () => studentDal.getMyRequest(staff, NOT_A_REQUEST),
      () => studentDal.createMyRequest(staff, { kind: 'dean_certificate' }, 'test'),
      () => studentDal.countMyUnreadNotifications(staff),
      () => studentDal.listMyNotifications(staff),
      () => studentDal.listMyUnreadAnnouncements(staff),
    ]
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('самодельный объект с теми же полями не принимается: действующее лицо создаёт только модуль сессий', async () => {
    const forged = { userId: a.userId, role: 'student', cohort: 'main', groupId: a.groupId }
    // @ts-expect-error — по форме объект не проходит проверку типов
    await expect(studentDal.getMyProfile(forged)).rejects.toBeInstanceOf(ForbiddenError)
    // Подмена роли у настоящего лица невозможна: объект заморожен.
    expect(() => {
      ;(a as { role: string }).role = 'staff'
    }).toThrow()
    // Конструктор без метки модуля сессий бросает ошибку.
    // @ts-expect-error — метка не экспортируется
    expect(() => new Actor(Symbol('чужая метка'), { userId: a.userId, role: 'staff', cohort: 'main', groupId: null })).toThrow()
  })
})

describe('подача заявки', () => {
  it('создаётся со статусом «Подана», адрес записан, владелец — из сессии', async () => {
    const created = await studentDal.createMyRequest(a, { kind: 'dean_certificate' }, '198.51.100.7')
    const detail = await studentDal.getMyRequest(a, created!.id)
    expect(detail).toMatchObject({ status: 'submitted', kind: 'dean_certificate', studentName: STUDENT_A.fullName })
    expect(detail?.events.map((e) => e.status)).toEqual(['submitted'])
    // Адрес лежит в самой заявке (чистка спама, ADR-0003); наружу студенту он не отдаётся.
    expect(JSON.stringify(detail)).not.toContain('198.51.100.7')
    expect(await studentDal.getMyRequest(b, created!.id)).toBeNull()
  })

  it('неизвестный вид заявки не создаёт запись', async () => {
    // @ts-expect-error — вид не из списка
    expect(await studentDal.createMyRequest(a, { kind: 'выдуманный' }, 'test')).toBeNull()
  })

  it('студент не может передать ни владельца, ни статус: лишние поля игнорируются', async () => {
    const created = await studentDal.createMyRequest(
      a,
      // @ts-expect-error — лишние поля, которых функция не принимает
      { kind: 'tuition_certificate', studentId: b.userId, status: 'ready' },
      'test',
    )
    const detail = await studentDal.getMyRequest(a, created!.id)
    expect(detail?.status).toBe('submitted')
    expect(await studentDal.getMyRequest(b, created!.id)).toBeNull()
  })
})
