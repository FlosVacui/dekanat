// 20.11, блиц: сводка, студенты набора и объявления сотрудника. Граница — набор из сессии (ADR-0002).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { ALT_STUDENT, STAFF_ALT, STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { roleFromUrl } from '../../db/migrate-lib'
import { actorFor, withOwner } from './helpers'

const TAG = 'Блиц-тест'
const ZERO = '00000000-0000-4000-8000-000000000000'

let a: Actor
let b: Actor
let altStudent: Actor
let staff: Actor
let altStaff: Actor

beforeAll(async () => {
  ;[a, b, altStudent, staff, altStaff] = await Promise.all([
    actorFor(STUDENT_A),
    actorFor(STUDENT_B),
    actorFor(ALT_STUDENT),
    actorFor(STAFF_MAIN),
    actorFor(STAFF_ALT),
  ])
})
afterEach(() => staffDal.resetAnnouncementLimits())
// Всё, что тесты создали, убирается: следующие файлы работают с теми же аккаунтами и считают их заявки, вопросы и ленту.
const createdRequests: string[] = []
afterAll(async () => {
  await withOwner(async (c) => {
    await c.query(`delete from announcements where title like $1`, [`${TAG}%`])
    await c.query(`delete from questions where body like $1`, [`${TAG}%`])
    await c.query(`delete from notifications where link = any($1::text[])`, [createdRequests.map((id) => `/requests/${id}`)])
    await c.query(`delete from requests where id = any($1::uuid[])`, [createdRequests])
  })
  await closeDb()
})

// Право записи в `announcements` у роли приложения задаёт db/migrate-lib.ts (GRANTS). Пока строки `GRANT INSERT ON announcements` там нет,
// тесты записи пропускаются и видно почему, а тест «без права» проверяет отказ. Появится право — включатся сами.
const appRole = roleFromUrl(process.env.TEST_DATABASE_URL ?? 'postgres://app@localhost/x')
const canPost = (await withOwner((c) => c.query(`select has_table_privilege($1, 'public.announcements', 'INSERT') as ok`, [appRole]))).rows[0].ok === true

const today = () => new Date().toISOString().slice(0, 10)

describe('роль: функции блица только для сотрудника', () => {
  it('студент получает отказ, а не пустой ответ', async () => {
    await expect(staffDal.getCohortSummary(a, today())).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.listCohortStudents(a)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.getCohortStudent(a, a.userId)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.listCohortAnnouncements(a)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.listCohortAudiences(a)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.canPostAnnouncements(a)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(staffDal.createCohortAnnouncement(a, { audience: 'x', title: 'x', body: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('сводка', () => {
  it('числа совпадают со списками слоя; чужой набор в них не входит', async () => {
    const summary = await staffDal.getCohortSummary(staff, today())
    const requests = await staffDal.listCohortRequests(staff)
    const questions = await staffDal.listCohortQuestions(staff)
    expect(summary.total).toBe(requests.length)
    for (const status of ['submitted', 'in_progress', 'ready', 'issued', 'rejected'] as const) {
      expect(summary.byStatus[status]).toBe(requests.filter((r) => r.status === status).length)
    }
    expect(summary.unanswered).toBe(questions.filter((q) => q.status === 'sent').length)
    const overdue = requests.filter((r) => r.status === 'in_progress' && r.dueDate !== null && r.dueDate < today()).length
    expect(summary.overdue).toBe(overdue)

    const alt = await staffDal.getCohortSummary(altStaff, today())
    expect(alt.total).toBe((await staffDal.listCohortRequests(altStaff)).length)
  })

  it('новая заявка и новый вопрос меняют числа только своего набора', async () => {
    const before = await staffDal.getCohortSummary(staff, today())
    const altBefore = await staffDal.getCohortSummary(altStaff, today())
    createdRequests.push((await studentDal.createMyRequest(a, { kind: 'financial_aid' }, 'blitz-test-1'))!.id)
    await studentDal.createMyQuestion(a, { topic: 'other', text: `${TAG}: вопрос` }, 'blitz-test-1')
    const after = await staffDal.getCohortSummary(staff, today())
    expect(after.byStatus.submitted).toBe(before.byStatus.submitted + 1)
    expect(after.total).toBe(before.total + 1)
    expect(after.unanswered).toBe(before.unanswered + 1)
    expect(await staffDal.getCohortSummary(altStaff, today())).toEqual(altBefore)
  })

  it('просрочено: заявка «В работе» со сроком в прошлом', async () => {
    const created = await studentDal.createMyRequest(b, { kind: 'financial_aid' }, 'blitz-test-2')
    createdRequests.push(created!.id)
    await staffDal.changeRequestStatus(staff, created!.id, { target: 'in_progress' })
    const before = await staffDal.getCohortSummary(staff, today())
    await withOwner((c) => c.query(`update requests set due_date = current_date - 3 where id = $1`, [created!.id]))
    const after = await staffDal.getCohortSummary(staff, today())
    expect(after.overdue).toBe(before.overdue + 1)
  })

  it('дата не в формате — просрочено 0, без ошибки базы', async () => {
    expect((await staffDal.getCohortSummary(staff, 'вчера')).overdue).toBe(0)
  })
})

describe('студенты набора', () => {
  it('список — только свой набор', async () => {
    const mine = await staffDal.listCohortStudents(staff)
    const theirs = await staffDal.listCohortStudents(altStaff)
    expect(mine.map((s) => s.id)).toContain(a.userId)
    expect(mine.map((s) => s.id)).toContain(b.userId)
    expect(mine.map((s) => s.id)).not.toContain(altStudent.userId)
    expect(theirs.map((s) => s.id)).toEqual([altStudent.userId])
    expect(JSON.stringify(mine)).not.toContain(ALT_STUDENT.fullName)
    expect(JSON.stringify(theirs)).not.toContain(STUDENT_A.fullName)
  })

  it('карточка: ФИО, группа, долг и нехватка до допуска, заявки и вопросы студента', async () => {
    const card = await staffDal.getCohortStudent(staff, a.userId)
    expect(card).toMatchObject({ id: a.userId, fullName: STUDENT_A.fullName, course: 3, groupName: 'ЦЭ-24-03' })
    const byName = new Map(card!.disciplines.map((d) => [d.name, d]))
    expect(byName.get('Эконометрика')).toMatchObject({ outcome: '2' })
    expect(byName.get('Корпоративные финансы')).toMatchObject({ outcome: 'pending', points: 22, admitted: false })
    // Заявки и вопросы — только этого студента.
    const own = await studentDal.listMyRequests(a)
    expect(card!.requests.map((r) => r.id).sort()).toEqual(own.map((r) => r.id).sort())
    const bCard = await staffDal.getCohortStudent(staff, b.userId)
    expect(bCard!.requests.some((r) => card!.requests.some((x) => x.id === r.id))).toBe(false)
    expect(Object.keys(card!).sort()).toEqual(['course', 'disciplines', 'faculty', 'fullName', 'groupName', 'id', 'programme', 'questions', 'requests'])
  })

  it('чужой набор, сотрудник, мусор и несуществующий номер — одинаково null', async () => {
    expect(await staffDal.getCohortStudent(staff, altStudent.userId)).toBeNull()
    expect(await staffDal.getCohortStudent(altStaff, a.userId)).toBeNull()
    expect(await staffDal.getCohortStudent(staff, staff.userId)).toBeNull()
    expect(await staffDal.getCohortStudent(staff, ZERO)).toBeNull()
    expect(await staffDal.getCohortStudent(staff, "'; drop table users; --")).toBeNull()
    expect(await staffDal.getCohortStudent(staff, undefined as unknown as string)).toBeNull()
    expect(await staffDal.getCohortStudent(altStaff, altStudent.userId)).not.toBeNull()
  })
})

describe('объявления: проверка текста', () => {
  it('заголовок: пробелы сжимаются, до 120 знаков; пусто и длиннее — отказ', () => {
    expect(staffDal.normalizeAnnouncementTitle('  Пересдача \n в  среду ')).toBe('Пересдача в среду')
    expect(staffDal.normalizeAnnouncementTitle('я'.repeat(120))).toHaveLength(120)
    expect(staffDal.normalizeAnnouncementTitle('я'.repeat(121))).toBeNull()
    expect(staffDal.normalizeAnnouncementTitle('   ')).toBeNull()
    expect(staffDal.normalizeAnnouncementTitle('a\u0000b')).toBeNull()
    expect(staffDal.normalizeAnnouncementTitle(42)).toBeNull()
  })
  it('текст: до 2000 знаков, переводы строк сохраняются; считаются знаки, а не байты', () => {
    expect(staffDal.normalizeAnnouncementBody('а\r\nб')).toBe('а\nб')
    expect(staffDal.normalizeAnnouncementBody('я'.repeat(2000))).toHaveLength(2000)
    expect(staffDal.normalizeAnnouncementBody('я'.repeat(2001))).toBeNull()
    expect(staffDal.normalizeAnnouncementBody('😀'.repeat(2000))).not.toBeNull()
    expect(staffDal.normalizeAnnouncementBody('')).toBeNull()
    expect(staffDal.normalizeAnnouncementBody(null)).toBeNull()
  })
})

describe('объявления: адресаты и отказы', () => {
  it('адресаты — группы и факультеты набора; чужих нет', async () => {
    const mine = await staffDal.listCohortAudiences(staff)
    const theirs = await staffDal.listCohortAudiences(altStaff)
    expect(mine.groups.map((g) => g.name)).toContain('ЦЭ-24-03')
    expect(JSON.stringify(mine)).not.toContain('ТЕСТ-Г-9')
    expect(JSON.stringify(mine)).not.toContain('Факультет тестовых данных')
    expect(theirs.groups.map((g) => g.name)).toEqual(['ТЕСТ-Г-9'])
    expect(theirs.faculties).toEqual(['Факультет тестовых данных'])
  })

  it('чужая группа, чужой факультет, мусор и подделка — отказ, записи нет', async () => {
    const alt = await staffDal.listCohortAudiences(altStaff)
    const before = (await withOwner((c) => c.query('select count(*)::int as n from announcements'))).rows[0].n
    const attempts = [
      `group:${alt.groups[0]!.id}`,
      `faculty:${alt.faculties[0]!}`,
      `group:${ZERO}`,
      'group:не-номер',
      'faculty:',
      'faculty:Экономический факультет%',
      '',
      'all',
      "group:' or 1=1 --",
    ]
    for (const audience of attempts) {
      expect(await staffDal.createCohortAnnouncement(staff, { audience, title: `${TAG} чужое`, body: 'x' }), audience).toEqual({ ok: false, reason: 'invalid_audience' })
    }
    expect(await staffDal.createCohortAnnouncement(staff, { audience: undefined, title: `${TAG} чужое`, body: 'x' })).toEqual({ ok: false, reason: 'invalid_audience' })
    const after = (await withOwner((c) => c.query('select count(*)::int as n from announcements'))).rows[0].n
    expect(after).toBe(before)
  })

  it('пустой заголовок и текст, слишком длинные — invalid_input, записи нет', async () => {
    const audiences = await staffDal.listCohortAudiences(staff)
    const audience = `group:${audiences.groups[0]!.id}`
    const count = async () => (await withOwner((c) => c.query('select count(*)::int as n from announcements'))).rows[0].n as number
    const before = await count()
    for (const input of [
      { audience, title: '', body: 'x' },
      { audience, title: 'x', body: '   ' },
      { audience, title: 'я'.repeat(121), body: 'x' },
      { audience, title: 'x', body: 'я'.repeat(2001) },
      { audience, title: 5, body: 'x' },
    ]) {
      expect(await staffDal.createCohortAnnouncement(staff, input)).toEqual({ ok: false, reason: 'invalid_input' })
    }
    expect(await count()).toBe(before)
  })

})

describe.skipIf(canPost)('объявления без права записи у роли приложения', () => {
  it('запись не создаётся: unavailable, а не ошибка базы; место в пределе не занято', async () => {
    const audiences = await staffDal.listCohortAudiences(staff)
    const before = (await withOwner((c) => c.query('select count(*)::int as n from announcements'))).rows[0].n
    expect(await staffDal.canPostAnnouncements(staff)).toBe(false)
    for (let i = 0; i < staffDal.ANNOUNCEMENTS_PER_DAY + 2; i += 1) {
      expect(await staffDal.createCohortAnnouncement(staff, { audience: `group:${audiences.groups[0]!.id}`, title: `${TAG} без права`, body: 'x' })).toEqual({
        ok: false,
        reason: 'unavailable',
      })
    }
    expect((await withOwner((c) => c.query('select count(*)::int as n from announcements'))).rows[0].n).toBe(before)
  })
})

describe.skipIf(!canPost)('объявления: запись, видимость, предел', () => {
  it('группе: видят студенты группы, студент другой группы и чужого набора — нет', async () => {
    const audiences = await staffDal.listCohortAudiences(staff)
    const groupOfA = (await staffDal.getCohortStudent(staff, a.userId))!.groupName
    const groupOfB = (await staffDal.getCohortStudent(staff, b.userId))!.groupName
    expect(groupOfA).not.toBe(groupOfB)
    const g = audiences.groups.find((x) => x.name === groupOfA)!
    const created = await staffDal.createCohortAnnouncement(staff, { audience: `group:${g.id}`, title: `${TAG} группе`, body: 'Текст\nв две строки' })
    expect(created.ok).toBe(true)

    const titles = async (who: Actor) => (await studentDal.listMyFeed(who)).map((i) => i.title)
    expect(await titles(a)).toContain(`${TAG} группе`)
    expect(await titles(b)).not.toContain(`${TAG} группе`)
    expect(await titles(altStudent)).not.toContain(`${TAG} группе`)

    const list = await staffDal.listCohortAnnouncements(staff)
    const item = list.find((x) => x.title === `${TAG} группе`)
    expect(item).toMatchObject({ body: 'Текст\nв две строки', audience: `Группа ${groupOfA}` })
    expect((await staffDal.listCohortAnnouncements(altStaff)).some((x) => x.title === `${TAG} группе`)).toBe(false)
  })

  it('всему потоку (факультету): видят студенты факультета; в списке — «Весь поток»', async () => {
    const audiences = await staffDal.listCohortAudiences(staff)
    const facultyOfA = (await staffDal.getCohortStudent(staff, a.userId))!.faculty
    const created = await staffDal.createCohortAnnouncement(staff, { audience: `faculty:${facultyOfA}`, title: `${TAG} потоку`, body: 'Всем' })
    expect(created.ok).toBe(true)
    expect(audiences.faculties).toContain(facultyOfA)
    expect((await studentDal.listMyFeed(a)).map((i) => i.title)).toContain(`${TAG} потоку`)
    expect((await studentDal.listMyFeed(altStudent)).map((i) => i.title)).not.toContain(`${TAG} потоку`)
    const item = (await staffDal.listCohortAnnouncements(staff)).find((x) => x.title === `${TAG} потоку`)
    expect(item?.audience).toBe(`Весь поток: ${facultyOfA}`)
  })

  it('не больше 20 в сутки на сотрудника; другой сотрудник не затронут; через сутки предел снимается', async () => {
    const audiences = await staffDal.listCohortAudiences(staff)
    const audience = `group:${audiences.groups[0]!.id}`
    const t0 = Date.now()
    for (let i = 0; i < staffDal.ANNOUNCEMENTS_PER_DAY; i += 1) {
      const res = await staffDal.createCohortAnnouncement(staff, { audience, title: `${TAG} ${i}`, body: 'x' }, t0 + i)
      expect(res.ok, `объявление ${i + 1}`).toBe(true)
    }
    expect(await staffDal.createCohortAnnouncement(staff, { audience, title: `${TAG} лишнее`, body: 'x' }, t0 + 1000)).toEqual({ ok: false, reason: 'rate_limited' })
    const altAudience = `group:${(await staffDal.listCohortAudiences(altStaff)).groups[0]!.id}`
    expect((await staffDal.createCohortAnnouncement(altStaff, { audience: altAudience, title: `${TAG} другой`, body: 'x' }, t0 + 1000)).ok).toBe(true)
    // Отказ по пределу записи не создал.
    const extra = await withOwner((c) => c.query(`select 1 from announcements where title = $1`, [`${TAG} лишнее`]))
    expect(extra.rowCount).toBe(0)
    expect((await staffDal.createCohortAnnouncement(staff, { audience, title: `${TAG} завтра`, body: 'x' }, t0 + 25 * 60 * 60 * 1000)).ok).toBe(true)
  })

  it('отказ по тексту и адресату место в пределе не занимает', async () => {
    const audiences = await staffDal.listCohortAudiences(staff)
    const audience = `group:${audiences.groups[0]!.id}`
    const t0 = Date.now()
    for (let i = 0; i < staffDal.ANNOUNCEMENTS_PER_DAY + 5; i += 1) {
      await staffDal.createCohortAnnouncement(staff, { audience, title: '', body: 'x' }, t0)
      await staffDal.createCohortAnnouncement(staff, { audience: 'нет', title: 'x', body: 'x' }, t0)
    }
    expect((await staffDal.createCohortAnnouncement(staff, { audience, title: `${TAG} после отказов`, body: 'x' }, t0)).ok).toBe(true)
  })

  it('список — за 30 дней: старое объявление в него не попадает', async () => {
    const audiences = await staffDal.listCohortAudiences(staff)
    const created = await staffDal.createCohortAnnouncement(staff, { audience: `group:${audiences.groups[0]!.id}`, title: `${TAG} старое`, body: 'x' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await withOwner((c) => c.query(`update announcements set published_at = now() - interval '31 days' where id = $1`, [created.id]))
    expect((await staffDal.listCohortAnnouncements(staff)).some((x) => x.id === created.id)).toBe(false)
    expect((await staffDal.listCohortAnnouncements(staff, 60)).some((x) => x.id === created.id)).toBe(true)
  })

  it('счёт «за неделю» в сводке растёт на новое объявление и не зависит от чужого набора', async () => {
    const audiences = await staffDal.listCohortAudiences(staff)
    const before = await staffDal.getCohortSummary(staff, today())
    const altBefore = await staffDal.getCohortSummary(altStaff, today())
    await staffDal.createCohortAnnouncement(staff, { audience: `group:${audiences.groups[0]!.id}`, title: `${TAG} неделя`, body: 'x' })
    expect((await staffDal.getCohortSummary(staff, today())).announcementsWeek).toBe(before.announcementsWeek + 1)
    expect((await staffDal.getCohortSummary(altStaff, today())).announcementsWeek).toBe(altBefore.announcementsWeek)
  })
})
