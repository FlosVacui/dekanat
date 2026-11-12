import 'server-only'
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { isIsoDate } from '@/lib/dates'
import { isRequestKind, type RequestKind } from '@/lib/requests'
import { normalizeIp } from '../auth/ip'
import type { Actor } from '../auth/session'
import { getDb } from './client'
import { RequestLimitError, isUuid, requireStudent } from './guards'
import {
  announcementReads,
  announcements,
  assignments,
  disciplines,
  grades,
  groups,
  lessonChanges,
  lessons,
  notifications,
  requestEvents,
  requests,
  students,
} from './schema'

// Функции студента (ADR-0002). Первый аргумент — действующее лицо из сессии; первым делом проверяется роль.
// Запись ищется вместе с владельцем (или группой) в одном запросе; чужая и несуществующая — одинаково null.
// Наружу идут только перечисленные поля.

const MAX_RANGE_DAYS = 31

function assertRange(from: string, to: string): boolean {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return false
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  return days <= MAX_RANGE_DAYS
}

// ---------- Профиль ----------

export interface Profile {
  fullName: string
  faculty: string
  programme: string
  course: number
  groupName: string
}

export async function getMyProfile(actor: Actor): Promise<Profile | null> {
  const { studentId } = requireStudent(actor)
  const rows = await getDb()
    .select({
      fullName: students.fullName,
      faculty: students.faculty,
      programme: students.programme,
      course: students.course,
      groupName: groups.name,
    })
    .from(students)
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(eq(students.userId, studentId))
    .limit(1)
  return rows[0] ?? null
}

// ---------- Расписание группы ----------

export interface LessonItem {
  id: string
  date: string
  startsAt: string
  endsAt: string
  discipline: string
  kind: string
  room: string
  teacher: string
  change: { kind: string; note: string } | null
}

/** Пары группы студента за промежуток дат (включительно). Группа — из сессии, не из запроса. */
export async function listMyLessons(actor: Actor, from: string, to: string): Promise<LessonItem[]> {
  const { groupId } = requireStudent(actor)
  if (!assertRange(from, to)) return []
  const rows = await getDb()
    .select({
      id: lessons.id,
      date: lessons.lessonDate,
      startsAt: lessons.startsAt,
      endsAt: lessons.endsAt,
      discipline: lessons.discipline,
      kind: lessons.kind,
      room: lessons.room,
      teacher: lessons.teacher,
      changeKind: lessonChanges.kind,
      changeNote: lessonChanges.note,
    })
    .from(lessons)
    .leftJoin(lessonChanges, eq(lessonChanges.lessonId, lessons.id))
    .where(and(eq(lessons.groupId, groupId), gte(lessons.lessonDate, from), lte(lessons.lessonDate, to)))
    .orderBy(asc(lessons.lessonDate), asc(lessons.startsAt))
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    startsAt: r.startsAt.slice(0, 5),
    endsAt: r.endsAt.slice(0, 5),
    discipline: r.discipline,
    kind: r.kind,
    room: r.room,
    teacher: r.teacher,
    change: r.changeKind && r.changeNote ? { kind: r.changeKind, note: r.changeNote } : null,
  }))
}

// ---------- Успеваемость ----------

export interface GradeItem {
  disciplineId: string
  name: string
  controlKind: string
  semester: number
  points: number | null
  /** '5' | '4' | '3' | '2' | 'credit' | 'no_credit' | 'pending' */
  outcome: string
  admitted: boolean
  examDate: string | null
  examTime: string | null
  examRoom: string | null
  /** Ближайшая работа со сроком не раньше `today`. */
  nextDue: { title: string; dueDate: string } | null
}

/** Дисциплины группы студента с его баллами и итогами. */
export async function listMyGrades(actor: Actor, today: string): Promise<GradeItem[]> {
  const { studentId, groupId } = requireStudent(actor)
  if (!isIsoDate(today)) return []
  const db = getDb()
  const rows = await db
    .select({
      disciplineId: disciplines.id,
      name: disciplines.name,
      controlKind: disciplines.controlKind,
      semester: disciplines.semester,
      examDate: disciplines.examDate,
      examTime: disciplines.examTime,
      examRoom: disciplines.examRoom,
      points: grades.points,
      outcome: grades.outcome,
      admitted: grades.admitted,
    })
    .from(disciplines)
    .leftJoin(grades, and(eq(grades.disciplineId, disciplines.id), eq(grades.studentId, studentId)))
    .where(eq(disciplines.groupId, groupId))
    .orderBy(asc(disciplines.name))

  const ids = rows.map((r) => r.disciplineId)
  const due = ids.length
    ? await db
        .select({ disciplineId: assignments.disciplineId, title: assignments.title, dueDate: assignments.dueDate })
        .from(assignments)
        .where(and(inArray(assignments.disciplineId, ids), gte(assignments.dueDate, today)))
        .orderBy(asc(assignments.dueDate))
    : []
  const nextByDiscipline = new Map<string, { title: string; dueDate: string }>()
  for (const d of due) {
    if (!nextByDiscipline.has(d.disciplineId)) nextByDiscipline.set(d.disciplineId, { title: d.title, dueDate: d.dueDate })
  }

  return rows.map((r) => ({
    disciplineId: r.disciplineId,
    name: r.name,
    controlKind: r.controlKind,
    semester: r.semester,
    points: r.points,
    outcome: r.outcome ?? 'pending',
    admitted: r.admitted ?? true,
    examDate: r.examDate,
    examTime: r.examTime ? r.examTime.slice(0, 5) : null,
    examRoom: r.examRoom,
    nextDue: nextByDiscipline.get(r.disciplineId) ?? null,
  }))
}

export interface DisciplineDetail extends Omit<GradeItem, 'nextDue'> {
  assignments: { id: string; title: string; dueDate: string; maxPoints: number }[]
}

/** Дисциплина по номеру: условие «номер и группа из сессии» в одном запросе. Чужая — null. */
export async function getMyDiscipline(actor: Actor, disciplineId: string): Promise<DisciplineDetail | null> {
  const { studentId, groupId } = requireStudent(actor)
  if (!isUuid(disciplineId)) return null
  const db = getDb()
  const rows = await db
    .select({
      disciplineId: disciplines.id,
      name: disciplines.name,
      controlKind: disciplines.controlKind,
      semester: disciplines.semester,
      examDate: disciplines.examDate,
      examTime: disciplines.examTime,
      examRoom: disciplines.examRoom,
      points: grades.points,
      outcome: grades.outcome,
      admitted: grades.admitted,
    })
    .from(disciplines)
    .leftJoin(grades, and(eq(grades.disciplineId, disciplines.id), eq(grades.studentId, studentId)))
    .where(and(eq(disciplines.id, disciplineId), eq(disciplines.groupId, groupId)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const works = await db
    .select({ id: assignments.id, title: assignments.title, dueDate: assignments.dueDate, maxPoints: assignments.maxPoints })
    .from(assignments)
    .where(eq(assignments.disciplineId, row.disciplineId))
    .orderBy(asc(assignments.dueDate))
  return {
    disciplineId: row.disciplineId,
    name: row.name,
    controlKind: row.controlKind,
    semester: row.semester,
    points: row.points,
    outcome: row.outcome ?? 'pending',
    admitted: row.admitted ?? true,
    examDate: row.examDate,
    examTime: row.examTime ? row.examTime.slice(0, 5) : null,
    examRoom: row.examRoom,
    assignments: works,
  }
}

export interface DueAssignment {
  id: string
  disciplineId: string
  discipline: string
  title: string
  dueDate: string
  maxPoints: number
}

/** «Что сдать»: работы дисциплин группы студента со сроком в промежутке. */
export async function listMyAssignmentsDue(actor: Actor, from: string, to: string): Promise<DueAssignment[]> {
  const { groupId } = requireStudent(actor)
  if (!assertRange(from, to)) return []
  return getDb()
    .select({
      id: assignments.id,
      disciplineId: disciplines.id,
      discipline: disciplines.name,
      title: assignments.title,
      dueDate: assignments.dueDate,
      maxPoints: assignments.maxPoints,
    })
    .from(assignments)
    .innerJoin(disciplines, eq(disciplines.id, assignments.disciplineId))
    .where(and(eq(disciplines.groupId, groupId), gte(assignments.dueDate, from), lte(assignments.dueDate, to)))
    .orderBy(asc(assignments.dueDate))
}

// ---------- Заявки ----------

export interface RequestItem {
  id: string
  kind: string
  status: string
  note: string | null
  createdAt: Date
  updatedAt: Date
  dueDate: string | null
  pickupUntil: string | null
  issuedOn: string | null
  rejectReason: string | null
}

export interface RequestEventItem {
  status: string
  createdAt: Date
}

export interface RequestDetail extends RequestItem {
  /** ФИО заявителя: студент видит только свою заявку, поэтому это его собственное имя. */
  studentName: string
  events: RequestEventItem[]
}

const requestColumns = {
  id: requests.id,
  kind: requests.kind,
  status: requests.status,
  note: requests.note,
  createdAt: requests.createdAt,
  updatedAt: requests.updatedAt,
  dueDate: requests.dueDate,
  pickupUntil: requests.pickupUntil,
  issuedOn: requests.issuedOn,
  rejectReason: requests.rejectReason,
}

export async function listMyRequests(actor: Actor): Promise<RequestItem[]> {
  const { studentId } = requireStudent(actor)
  return getDb()
    .select(requestColumns)
    .from(requests)
    .where(eq(requests.studentId, studentId))
    .orderBy(desc(requests.createdAt))
}

/** Заявка по номеру: «номер и владелец» в одном запросе. Чужая и несуществующая — одинаково null. */
export async function getMyRequest(actor: Actor, requestId: string): Promise<RequestDetail | null> {
  const { studentId } = requireStudent(actor)
  if (!isUuid(requestId)) return null
  const db = getDb()
  const rows = await db
    .select({ ...requestColumns, studentName: students.fullName })
    .from(requests)
    .innerJoin(students, eq(students.userId, requests.studentId))
    .where(and(eq(requests.id, requestId), eq(requests.studentId, studentId)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const events = await db
    .select({ status: requestEvents.status, createdAt: requestEvents.createdAt })
    .from(requestEvents)
    .where(eq(requestEvents.requestId, row.id))
    .orderBy(asc(requestEvents.createdAt))
  return { ...row, events }
}

/** Лимит записи (ADR-0003): заявок в сутки на пару «аккаунт и адрес» и на аккаунт. Числа — выбор проекта. */
export const REQUESTS_PER_DAY_PAIR = 10
export const REQUESTS_PER_DAY_ACCOUNT = 200

/**
 * Подача заявки. Студент передаёт только вид; владелец и статус «Подана» ставит слой.
 * Адрес подачи записывается в заявку (ADR-0003, «Чистка спама»); значение «unknown» — заголовка нет.
 * Лимит записи: не больше 10 заявок в сутки на пару «аккаунт и адрес» и 200 на аккаунт. Проверка и вставка — одна
 * транзакция под замком на аккаунт, поэтому залп одновременных подач лимит не проходит. Исчерпан лимит —
 * `RequestLimitError`, заявка не создаётся.
 */
export async function createMyRequest(
  actor: Actor,
  input: { kind: RequestKind },
  ip: string,
): Promise<{ id: string } | null> {
  const { studentId } = requireStudent(actor)
  if (!isRequestKind(input.kind)) return null
  const safeIp = normalizeIp(ip).slice(0, 64) || 'unknown'
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`requests:${studentId}`}, 0))`)
    const counted = await tx.execute(sql`
      select count(*) filter (where ip = ${safeIp})::int as pair, count(*)::int as account
      from requests where student_id = ${studentId} and created_at > clock_timestamp() - interval '1 day'
    `)
    const pair = Number(counted.rows[0]?.pair ?? 0)
    const account = Number(counted.rows[0]?.account ?? 0)
    if (pair >= REQUESTS_PER_DAY_PAIR) throw new RequestLimitError('pair')
    if (account >= REQUESTS_PER_DAY_ACCOUNT) throw new RequestLimitError('account')
    const inserted = await tx
      .insert(requests)
      .values({ studentId, kind: input.kind, status: 'submitted', ip: safeIp })
      .returning({ id: requests.id })
    const created = inserted[0]
    if (!created) return null
    await tx.insert(requestEvents).values({ requestId: created.id, status: 'submitted', byUserId: studentId, ip: safeIp })
    return { id: created.id }
  })
}

// ---------- Уведомления и объявления ----------

export interface NotificationItem {
  id: string
  kind: string
  title: string
  body: string
  link: string | null
  createdAt: Date
  read: boolean
}

export async function countMyUnreadNotifications(actor: Actor): Promise<number> {
  const { studentId } = requireStudent(actor)
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.studentId, studentId), isNull(notifications.readAt)))
  return rows[0]?.n ?? 0
}

export async function listMyNotifications(actor: Actor): Promise<NotificationItem[]> {
  const { studentId } = requireStudent(actor)
  const rows = await getDb()
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(eq(notifications.studentId, studentId))
    .orderBy(desc(notifications.createdAt))
    .limit(100)
  return rows.map(({ readAt, ...rest }) => ({ ...rest, read: readAt !== null }))
}

export interface AnnouncementItem {
  id: string
  title: string
  body: string
  publishedAt: Date
}

/** Непрочитанные объявления группы или факультета студента. Группа и факультет — из профиля. */
export async function listMyUnreadAnnouncements(actor: Actor): Promise<AnnouncementItem[]> {
  const { studentId, groupId } = requireStudent(actor)
  const db = getDb()
  const profile = await db
    .select({ faculty: students.faculty })
    .from(students)
    .where(eq(students.userId, studentId))
    .limit(1)
  const faculty = profile[0]?.faculty
  if (!faculty) return []
  return db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      publishedAt: announcements.publishedAt,
    })
    .from(announcements)
    .leftJoin(
      announcementReads,
      and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.studentId, studentId)),
    )
    .where(
      and(
        isNull(announcementReads.announcementId),
        sql`(${announcements.groupId} = ${groupId} or ${announcements.faculty} = ${faculty})`,
      ),
    )
    .orderBy(desc(announcements.publishedAt))
}
