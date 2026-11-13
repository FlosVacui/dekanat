import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { todayIn } from '@/lib/dates'
import { DEAN_PURPOSE_KEYS, PAYMENT_YEAR_MIN, currentYearIn } from '@/lib/requests'
import { Actor, type Actor as ActorType } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { ALT_STUDENT, STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor, withOwner } from './helpers'

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

// Пакет 3.4: поля заявки. Проверка значения — в слое доступа, а не только на странице.
describe('поля заявки: «Куда справка» и «Год оплаты»', () => {
  const year = currentYearIn('Europe/Moscow')
  const count = async () => (await studentDal.listMyRequests(a)).length

  it('справка из деканата с назначением: создаётся и читается', async () => {
    const created = await studentDal.createMyRequest(a, { kind: 'dean_certificate', purpose: 'tax_office' }, 'test')
    expect(created).not.toBeNull()
    const detail = await studentDal.getMyRequest(a, created!.id)
    expect(detail).toMatchObject({ kind: 'dean_certificate', purpose: 'tax_office', paymentYear: null })
    const listed = (await studentDal.listMyRequests(a)).find((r) => r.id === created!.id)
    expect(listed).toMatchObject({ purpose: 'tax_office', paymentYear: null })
    // Чужой студент заявку с этим полем не видит.
    expect(await studentDal.getMyRequest(b, created!.id)).toBeNull()
  })

  it('справка об оплате с годом: число и строка из формы принимаются', async () => {
    const byNumber = await studentDal.createMyRequest(a, { kind: 'tuition_certificate', paymentYear: 2024 }, 'test')
    const byString = await studentDal.createMyRequest(a, { kind: 'tuition_certificate', paymentYear: String(year) }, 'test')
    expect(await studentDal.getMyRequest(a, byNumber!.id)).toMatchObject({ purpose: null, paymentYear: 2024 })
    expect(await studentDal.getMyRequest(a, byString!.id)).toMatchObject({ purpose: null, paymentYear: year })
  })

  it('поле не передано — значение по умолчанию: «По месту требования» и прошлый год (не раньше 2024)', async () => {
    const dean = await studentDal.createMyRequest(a, { kind: 'dean_certificate' }, 'test')
    const tuition = await studentDal.createMyRequest(a, { kind: 'tuition_certificate' }, 'test')
    expect(await studentDal.getMyRequest(a, dean!.id)).toMatchObject({ purpose: 'on_demand', paymentYear: null })
    expect(await studentDal.getMyRequest(a, tuition!.id)).toMatchObject({ purpose: null, paymentYear: Math.max(2024, year - 1) })
  })

  it('материальная помощь: полей нет, оба пустые', async () => {
    const created = await studentDal.createMyRequest(a, { kind: 'financial_aid' }, 'test')
    expect(await studentDal.getMyRequest(a, created!.id)).toMatchObject({ purpose: null, paymentYear: null })
  })

  it('значение не из списка не принимается: заявка не создаётся', async () => {
    const before = await count()
    const refused = [
      await studentDal.createMyRequest(a, { kind: 'dean_certificate', purpose: 'выдуманное' }, 'test'),
      await studentDal.createMyRequest(a, { kind: 'dean_certificate', purpose: 'В налоговую инспекцию' }, 'test'),
      await studentDal.createMyRequest(a, { kind: 'dean_certificate', purpose: '' }, 'test'),
      await studentDal.createMyRequest(a, { kind: 'dean_certificate', purpose: "x'); drop table requests;--" }, 'test'),
      await studentDal.createMyRequest(a, { kind: 'tuition_certificate', paymentYear: 2023 }, 'test'),
      await studentDal.createMyRequest(a, { kind: 'tuition_certificate', paymentYear: year + 1 }, 'test'),
      await studentDal.createMyRequest(a, { kind: 'tuition_certificate', paymentYear: 'abc' }, 'test'),
      await studentDal.createMyRequest(a, { kind: 'tuition_certificate', paymentYear: '' }, 'test'),
      await studentDal.createMyRequest(a, { kind: 'tuition_certificate', paymentYear: 2025.5 }, 'test'),
    ]
    expect(refused).toEqual(refused.map(() => null))
    expect(await count()).toBe(before)
  })

  it('поле чужого вида отбрасывается, даже неверное: заявка создаётся без него', async () => {
    const dean = await studentDal.createMyRequest(a, { kind: 'dean_certificate', purpose: 'embassy', paymentYear: 1999 }, 'test')
    const tuition = await studentDal.createMyRequest(a, { kind: 'tuition_certificate', purpose: 'выдуманное', paymentYear: 2024 }, 'test')
    const aid = await studentDal.createMyRequest(a, { kind: 'financial_aid', purpose: 'embassy', paymentYear: 2024 }, 'test')
    expect(await studentDal.getMyRequest(a, dean!.id)).toMatchObject({ purpose: 'embassy', paymentYear: null })
    expect(await studentDal.getMyRequest(a, tuition!.id)).toMatchObject({ purpose: null, paymentYear: 2024 })
    expect(await studentDal.getMyRequest(a, aid!.id)).toMatchObject({ purpose: null, paymentYear: null })
  })

  it('сотрудник видит поле заявки студента своего набора', async () => {
    const created = await studentDal.createMyRequest(a, { kind: 'dean_certificate', purpose: 'library' }, 'test')
    const seen = await staffDal.getCohortRequest(staff, created!.id)
    expect(seen).toMatchObject({ purpose: 'library', paymentYear: null })
  })

  it('лимиты записи работают как раньше: поля их не обходят', async () => {
    const ip = '203.0.113.77'
    const results: unknown[] = []
    for (let i = 0; i < 10; i += 1) results.push(await studentDal.createMyRequest(a, { kind: 'dean_certificate', purpose: 'library' }, ip))
    expect(results.every((r) => r !== null)).toBe(true)
    await expect(studentDal.createMyRequest(a, { kind: 'dean_certificate', purpose: 'library' }, ip)).rejects.toMatchObject({ scope: 'pair' })
  })
})

describe('поля заявки: ограничения в базе', () => {
  const insert = (client: pg.Client, kind: string, purpose: string | null, paymentYear: number | null) =>
    client.query(
      `insert into requests (student_id, kind, status, ip, purpose, payment_year)
       select id, $2, 'submitted', 'db-check', $3, $4 from users where login = $1`,
      [STUDENT_A.login, kind, purpose, paymentYear],
    )

  /** Каждая проверка идёт в своей транзакции, которая откатывается: заявок в базе не остаётся. */
  async function attempt(kind: string, purpose: string | null, paymentYear: number | null): Promise<'ok' | string> {
    return withOwner(async (c) => {
      await c.query('begin')
      try {
        await insert(c, kind, purpose, paymentYear)
        return 'ok'
      } catch (error) {
        return (error as { constraint?: string }).constraint ?? String(error)
      } finally {
        await c.query('rollback')
      }
    })
  }

  it('все 17 значений списка база принимает', async () => {
    for (const key of DEAN_PURPOSE_KEYS) expect(await attempt('dean_certificate', key, null), key).toBe('ok')
  })

  it('список в ограничении базы — ровно DEAN_PURPOSES из кода', async () => {
    const res = await withOwner((c) =>
      c.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'requests_purpose_check'`),
    )
    const def = String(res.rows[0]?.def)
    const inDb = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
    expect(inDb.sort()).toEqual([...DEAN_PURPOSE_KEYS].sort())
    const year = await withOwner((c) =>
      c.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'requests_payment_year_check'`),
    )
    expect(String(year.rows[0]?.def)).toContain(`>= ${PAYMENT_YEAR_MIN}`)
  })

  it('значение не из списка база не принимает', async () => {
    expect(await attempt('dean_certificate', 'выдуманное', null)).toBe('requests_purpose_check')
  })

  it('год раньше 2024 база не принимает', async () => {
    expect(await attempt('tuition_certificate', null, 2023)).toBe('requests_payment_year_check')
    expect(await attempt('tuition_certificate', null, 2024)).toBe('ok')
  })

  it('назначение — только у справки из деканата, год — только у справки об оплате, у помощи оба пустые', async () => {
    const wrong = 'requests_fields_by_kind_check'
    expect(await attempt('dean_certificate', null, null)).toBe(wrong)
    expect(await attempt('dean_certificate', 'embassy', 2025)).toBe(wrong)
    expect(await attempt('tuition_certificate', 'embassy', 2025)).toBe(wrong)
    expect(await attempt('tuition_certificate', null, null)).toBe(wrong)
    expect(await attempt('financial_aid', 'embassy', null)).toBe(wrong)
    expect(await attempt('financial_aid', null, 2025)).toBe(wrong)
    expect(await attempt('financial_aid', null, null)).toBe('ok')
  })
})
