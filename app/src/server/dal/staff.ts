import 'server-only'
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm'
import { isIsoDate, todayIn } from '@/lib/dates'
import { QUESTION_TOPICS, normalizeQuestionText, topicLabel, type QuestionTopic } from '@/lib/questions'
import {
  ALLOWED_FROM,
  REQUEST_KIND_INFO,
  STATUS_LABELS,
  computeDueDate,
  computePickupUntil,
  isRejectReason,
  isRequestKind,
  isRequestStatus,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  type RequestKind,
  type RequestStatus,
} from '@/lib/requests'
import { normalizeIp } from '../auth/ip'
import type { Actor } from '../auth/session'
import { getConfig } from '../config'
import { getDb } from './client'
import { isUuid, requireStaff } from './guards'
import { announcements, disciplines, grades, groups, notifications, questions, requestEvents, requests, students, users } from './schema'

// Функции сотрудника (ADR-0002, «Область сотрудника»). Лежат отдельно от функций студента.
// Первым делом проверяется роль. Граница — набор: сотрудник видит и меняет только заявки студентов своего набора.
// Чужой набор и несуществующая заявка — одинаково «нет такой записи». Оценок, расписания и профиля здесь нет.

export interface StaffRequestItem {
  id: string
  kind: string
  status: string
  createdAt: Date
  updatedAt: Date
  studentName: string
  groupName: string
  /** Срок изготовления: записывается, когда заявку взяли в работу; до этого пусто. */
  dueDate: string | null
}

export interface StaffRequestDetail extends StaffRequestItem {
  purpose: string | null
  paymentYear: number | null
  pickupUntil: string | null
  issuedOn: string | null
  rejectReason: string | null
  events: { status: string; createdAt: Date }[]
}

const listColumns = {
  id: requests.id,
  kind: requests.kind,
  status: requests.status,
  createdAt: requests.createdAt,
  updatedAt: requests.updatedAt,
  studentName: students.fullName,
  groupName: groups.name,
  dueDate: requests.dueDate,
}

/** Заявки студентов своего набора. Набор — из сессии. */
export async function listCohortRequests(actor: Actor): Promise<StaffRequestItem[]> {
  const { cohort } = requireStaff(actor)
  return getDb()
    .select(listColumns)
    .from(requests)
    .innerJoin(students, eq(students.userId, requests.studentId))
    .innerJoin(users, eq(users.id, students.userId))
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(eq(users.cohort, cohort))
    .orderBy(desc(requests.createdAt))
}

/** Заявка по номеру вместе с набором сотрудника в одном запросе. Чужой набор — null. */
export async function getCohortRequest(actor: Actor, requestId: string): Promise<StaffRequestDetail | null> {
  const { cohort } = requireStaff(actor)
  if (!isUuid(requestId)) return null
  const db = getDb()
  const rows = await db
    .select({
      ...listColumns,
      purpose: requests.purpose,
      paymentYear: requests.paymentYear,
      pickupUntil: requests.pickupUntil,
      issuedOn: requests.issuedOn,
      rejectReason: requests.rejectReason,
    })
    .from(requests)
    .innerJoin(students, eq(students.userId, requests.studentId))
    .innerJoin(users, eq(users.id, students.userId))
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(and(eq(requests.id, requestId), eq(users.cohort, cohort)))
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

export type ChangeStatusResult =
  | { ok: true; status: RequestStatus }
  | { ok: false; reason: 'not_found' | 'invalid_transition' | 'invalid_input' | 'rate_limited' }

/** Лимит смены статуса (ADR-0002, ADR-0003): не больше 30 в минуту на пару «аккаунт сотрудника и адрес». */
export const STATUS_CHANGES_PER_MINUTE = 30

/**
 * Смена статуса: один запрос `UPDATE … WHERE` с номером, набором и статусом «из какого». Строк изменено ноль —
 * отказ. Сотрудник передаёт только целевой статус и, при отклонении, причину из списка; всё остальное
 * (сроки, кабинет) подставляет сервер. История статусов и уведомление владельцу пишутся в той же транзакции.
 * Лимит: считаются уже сделанные за минуту смены этой пары (адрес записан в строке истории); проверка и смена —
 * одна транзакция под замком на пару, поэтому залп одновременных смен лимит не проходит. Адрес не передан — «unknown».
 */
export async function changeRequestStatus(
  actor: Actor,
  requestId: string,
  input: { target: RequestStatus; reason?: string },
  ip = 'unknown',
): Promise<ChangeStatusResult> {
  const { staffId, cohort } = requireStaff(actor)
  const safeIp = normalizeIp(ip).slice(0, 64) || 'unknown'
  if (!isUuid(requestId)) return { ok: false, reason: 'not_found' }
  const target = input?.target
  if (!isRequestStatus(target)) return { ok: false, reason: 'invalid_input' }
  const reason = target === 'rejected' ? input.reason : undefined
  if (target === 'rejected' && !isRejectReason(reason)) return { ok: false, reason: 'invalid_input' }

  const allowedFrom = ALLOWED_FROM[target]
  const today = todayIn(getConfig().timezone)
  // Срок «В работе» считается от дня, когда заявку взяли в работу, по виду заявки (решение проекта, S-2.1 раздел 5).
  const dueDateByKind = sql`case ${requests.kind} when 'dean_certificate' then ${computeDueDate('dean_certificate', today)}::date when 'tuition_certificate' then ${computeDueDate('tuition_certificate', today)}::date else ${computeDueDate('financial_aid', today)}::date end`

  const pickupUntilByKind = sql`case ${requests.kind} when 'dean_certificate' then ${computePickupUntil('dean_certificate', today)}::date when 'tuition_certificate' then ${computePickupUntil('tuition_certificate', today)}::date else ${computePickupUntil('financial_aid', today)}::date end`

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`status:${staffId}:${safeIp}`}, 0))`)
    const recent = await tx.execute(sql`
      select count(*)::int as n from request_events
      where by_user_id = ${staffId} and ip = ${safeIp} and created_at > clock_timestamp() - interval '1 minute'
    `)
    if (Number(recent.rows[0]?.n ?? 0) >= STATUS_CHANGES_PER_MINUTE) return { ok: false, reason: 'rate_limited' } as const

    const cohortStudents = tx.select({ id: users.id }).from(users).where(and(eq(users.cohort, cohort), eq(users.role, 'student')))

    const updated =
      allowedFrom.length === 0
        ? []
        : await tx
            .update(requests)
            .set({
              status: target,
              updatedAt: new Date(),
              ...(target === 'in_progress' ? { dueDate: dueDateByKind } : {}),
              ...(target === 'rejected' ? { rejectReason: reason } : {}),
              ...(target === 'issued' ? { issuedOn: today } : {}),
              ...(target === 'ready' ? { pickupUntil: pickupUntilByKind } : {}),
            })
            .where(
              and(
                eq(requests.id, requestId),
                inArray(requests.status, [...allowedFrom]),
                inArray(requests.studentId, cohortStudents),
              ),
            )
            .returning({ id: requests.id, studentId: requests.studentId, kind: requests.kind })

    const changed = updated[0]
    if (!changed) {
      // Различаем «нет такой записи» и «переход недопустим» отдельным чтением, тоже с набором.
      const exists = await tx
        .select({ id: requests.id })
        .from(requests)
        .innerJoin(users, eq(users.id, requests.studentId))
        .where(and(eq(requests.id, requestId), eq(users.cohort, cohort)))
        .limit(1)
      return { ok: false, reason: exists.length ? 'invalid_transition' : 'not_found' } as const
    }

    await tx.insert(requestEvents).values({
      requestId: changed.id,
      status: target,
      byUserId: staffId,
      note: target === 'rejected' ? reason : null,
      ip: safeIp,
    })
    const kindTitle = isRequestKind(changed.kind) ? REQUEST_KIND_INFO[changed.kind].title : 'Заявка'
    await tx.insert(notifications).values({
      studentId: changed.studentId,
      kind: 'reminder',
      title: `${kindTitle}: ${STATUS_LABELS[target]}`,
      body: 'Статус заявки изменился. Откройте заявку, чтобы увидеть, что делать дальше.',
      link: `/requests/${changed.id}`,
    })
    return { ok: true, status: target } as const
  })
}

// ---------- Вопросы студентов (пакет 4.1) ----------

export interface StaffQuestionItem {
  id: string
  topic: string
  status: string
  createdAt: Date
  studentName: string
  groupName: string
}

export interface StaffQuestionDetail extends StaffQuestionItem {
  body: string
  /** Ответ деканата и время ответа: пусты, пока вопрос в статусе «Отправлен». */
  answer: string | null
  answeredAt: Date | null
}

const questionListColumns = {
  id: questions.id,
  topic: questions.topic,
  status: questions.status,
  createdAt: questions.createdAt,
  studentName: students.fullName,
  groupName: groups.name,
}

/** Вопросы студентов своего набора, новые сверху. Набор — из сессии. */
export async function listCohortQuestions(actor: Actor): Promise<StaffQuestionItem[]> {
  const { cohort } = requireStaff(actor)
  return getDb()
    .select(questionListColumns)
    .from(questions)
    .innerJoin(students, eq(students.userId, questions.studentId))
    .innerJoin(users, eq(users.id, students.userId))
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(eq(users.cohort, cohort))
    .orderBy(desc(questions.createdAt))
}

/** Вопрос по номеру вместе с набором сотрудника в одном запросе. Чужой набор и несуществующий — одинаково null. */
export async function getCohortQuestion(actor: Actor, questionId: string): Promise<StaffQuestionDetail | null> {
  const { cohort } = requireStaff(actor)
  if (!isUuid(questionId)) return null
  const rows = await getDb()
    .select({ ...questionListColumns, body: questions.body, answer: questions.answer, answeredAt: questions.answeredAt })
    .from(questions)
    .innerJoin(students, eq(students.userId, questions.studentId))
    .innerJoin(users, eq(users.id, students.userId))
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(and(eq(questions.id, questionId), eq(users.cohort, cohort)))
    .limit(1)
  return rows[0] ?? null
}

export type AnswerQuestionResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'already_answered' | 'invalid_input' | 'rate_limited' }

/** Лимит ответов (ADR-0002, ADR-0003): не больше 30 в минуту на пару «аккаунт сотрудника и адрес», как у смены статуса. */
export const ANSWERS_PER_MINUTE = 30

/**
 * Ответ на вопрос — один раз. Один запрос `UPDATE … WHERE` с номером, набором сотрудника и статусом «Отправлен»; ноль строк —
 * отказ, причину («нет такой записи» или «уже отвечен») отдельным чтением, тоже с набором. Ответ — от 1 до 1000 знаков после
 * обрезки пробелов. Уведомление владельцу пишется в той же транзакции: вид `reminder`, заголовок «Деканат ответил на вопрос»,
 * текст — подпись темы, ссылка на вопрос. Лимит считается по ответам этой пары, уже данным за минуту (адрес ответа записан
 * в вопросе, поле `answer_ip`); проверка и ответ — одна транзакция под замком на пару. Адрес не передан — «unknown».
 */
export async function answerQuestion(actor: Actor, questionId: string, text: string, ip = 'unknown'): Promise<AnswerQuestionResult> {
  const { staffId, cohort } = requireStaff(actor)
  const safeIp = normalizeIp(ip).slice(0, 64) || 'unknown'
  if (!isUuid(questionId)) return { ok: false, reason: 'not_found' }
  const answer = normalizeQuestionText(text)
  if (answer === null) return { ok: false, reason: 'invalid_input' }

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`answer:${staffId}:${safeIp}`}, 0))`)
    const recent = await tx.execute(sql`
      select count(*)::int as n from questions
      where answered_by = ${staffId} and answer_ip = ${safeIp} and answered_at > clock_timestamp() - interval '1 minute'
    `)
    if (Number(recent.rows[0]?.n ?? 0) >= ANSWERS_PER_MINUTE) return { ok: false, reason: 'rate_limited' } as const

    const cohortStudents = tx.select({ id: users.id }).from(users).where(and(eq(users.cohort, cohort), eq(users.role, 'student')))
    const updated = await tx
      .update(questions)
      .set({ status: 'answered', answer, answeredBy: staffId, answeredAt: sql`clock_timestamp()`, answerIp: safeIp })
      .where(and(eq(questions.id, questionId), eq(questions.status, 'sent'), inArray(questions.studentId, cohortStudents)))
      .returning({ id: questions.id, studentId: questions.studentId, topic: questions.topic })

    const changed = updated[0]
    if (!changed) {
      // Различаем «нет такой записи» и «уже отвечен» отдельным чтением, тоже с набором.
      const exists = await tx
        .select({ id: questions.id })
        .from(questions)
        .innerJoin(users, eq(users.id, questions.studentId))
        .where(and(eq(questions.id, questionId), eq(users.cohort, cohort)))
        .limit(1)
      return { ok: false, reason: exists.length ? 'already_answered' : 'not_found' } as const
    }

    await tx.insert(notifications).values({
      studentId: changed.studentId,
      kind: 'reminder',
      title: 'Деканат ответил на вопрос',
      body: topicLabel(changed.topic),
      link: `/questions/${changed.id}`,
    })
    return { ok: true } as const
  })
}

// ---------- 20.11, блиц: сводка, студенты набора, объявления ----------
// Граница та же — набор из сессии. Номера студента, группы и факультета из адреса и формы только сверяются со списками набора.
// Оценки студента сотрудник теперь видит (карточка студента); пересчёт в «долг» и «не хватает до допуска» делает страница по lib/grades.

/** Адресаты набора: группы и факультеты его студентов. Объявление, адресованное им, относится к набору. */
function addressedToCohort(cohort: string) {
  const db = getDb()
  const groupIds = db
    .select({ id: students.groupId })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .where(and(eq(users.cohort, cohort), eq(users.role, 'student')))
  const faculties = db
    .select({ faculty: students.faculty })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .where(and(eq(users.cohort, cohort), eq(users.role, 'student')))
  return or(inArray(announcements.groupId, groupIds), inArray(announcements.faculty, faculties))
}

export interface StaffSummary {
  /** Заявки набора по статусам; нулевые статусы есть в карте. */
  byStatus: Record<RequestStatus, number>
  total: number
  /** «В работе» с прошедшим сроком: то же правило, что `overdueDays` на списке заявок. */
  overdue: number
  /** Вопросы в статусе «Отправлен». */
  unanswered: number
  /** Объявления набора за 7 суток. */
  announcementsWeek: number
}

/** Числа сводки одним заходом. `today` — «ГГГГ-ММ-ДД» в часовом поясе вуза. */
export async function getCohortSummary(actor: Actor, today: string, now: Date = new Date()): Promise<StaffSummary> {
  const { cohort } = requireStaff(actor)
  const db = getDb()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const [byStatusRows, overdueRows, unansweredRows, weekRows] = await Promise.all([
    db
      .select({ status: requests.status, n: sql<number>`count(*)::int` })
      .from(requests)
      .innerJoin(users, eq(users.id, requests.studentId))
      .where(eq(users.cohort, cohort))
      .groupBy(requests.status),
    isIsoDate(today)
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(requests)
          .innerJoin(users, eq(users.id, requests.studentId))
          .where(and(eq(users.cohort, cohort), eq(requests.status, 'in_progress'), lt(requests.dueDate, today)))
      : Promise.resolve([{ n: 0 }]),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(questions)
      .innerJoin(users, eq(users.id, questions.studentId))
      .where(and(eq(users.cohort, cohort), eq(questions.status, 'sent'))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(announcements)
      .where(and(addressedToCohort(cohort), gte(announcements.publishedAt, weekAgo))),
  ])
  const byStatus = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>
  for (const row of byStatusRows) if (isRequestStatus(row.status)) byStatus[row.status] = Number(row.n)
  return {
    byStatus,
    total: REQUEST_STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
    overdue: Number(overdueRows[0]?.n ?? 0),
    unanswered: Number(unansweredRows[0]?.n ?? 0),
    announcementsWeek: Number(weekRows[0]?.n ?? 0),
  }
}

export interface StaffStudentItem {
  id: string
  fullName: string
  course: number
  groupId: string
  groupName: string
}

/** Студенты своего набора по алфавиту. Поиск и фильтр по группе делает страница из этого списка. */
export async function listCohortStudents(actor: Actor): Promise<StaffStudentItem[]> {
  const { cohort } = requireStaff(actor)
  return getDb()
    .select({ id: students.userId, fullName: students.fullName, course: students.course, groupId: groups.id, groupName: groups.name })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(and(eq(users.cohort, cohort), eq(users.role, 'student')))
    .orderBy(asc(students.fullName))
}

export interface StaffDisciplineRow {
  name: string
  controlKind: string
  semester: number
  points: number | null
  outcome: string
  admitted: boolean
}

export interface StaffStudentCard {
  id: string
  fullName: string
  faculty: string
  programme: string
  course: number
  groupName: string
  disciplines: StaffDisciplineRow[]
  requests: { id: string; kind: string; status: string; createdAt: Date; dueDate: string | null }[]
  questions: { id: string; topic: string; status: string; createdAt: Date }[]
}

/**
 * Карточка студента своего набора. Номер студента из адреса ищется вместе с набором сотрудника в одном запросе:
 * чужой набор, сотрудник под этим номером и несуществующий номер дают одинаковое null. Дисциплины берутся по группе,
 * заявки и вопросы — по номеру студента, уже найденному в наборе.
 */
export async function getCohortStudent(actor: Actor, studentId: string): Promise<StaffStudentCard | null> {
  const { cohort } = requireStaff(actor)
  if (!isUuid(studentId)) return null
  const db = getDb()
  const found = await db
    .select({
      id: students.userId,
      fullName: students.fullName,
      faculty: students.faculty,
      programme: students.programme,
      course: students.course,
      groupId: groups.id,
      groupName: groups.name,
    })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(and(eq(students.userId, studentId), eq(users.cohort, cohort), eq(users.role, 'student')))
    .limit(1)
  const row = found[0]
  if (!row) return null
  const [disciplineRows, requestRows, questionRows] = await Promise.all([
    db
      .select({
        name: disciplines.name,
        controlKind: disciplines.controlKind,
        semester: disciplines.semester,
        points: grades.points,
        outcome: grades.outcome,
        admitted: grades.admitted,
      })
      .from(disciplines)
      .leftJoin(grades, and(eq(grades.disciplineId, disciplines.id), eq(grades.studentId, row.id)))
      .where(eq(disciplines.groupId, row.groupId))
      .orderBy(asc(disciplines.name)),
    db
      .select({ id: requests.id, kind: requests.kind, status: requests.status, createdAt: requests.createdAt, dueDate: requests.dueDate })
      .from(requests)
      .where(eq(requests.studentId, row.id))
      .orderBy(desc(requests.createdAt))
      .limit(50),
    db
      .select({ id: questions.id, topic: questions.topic, status: questions.status, createdAt: questions.createdAt })
      .from(questions)
      .where(eq(questions.studentId, row.id))
      .orderBy(desc(questions.createdAt))
      .limit(50),
  ])
  return {
    id: row.id,
    fullName: row.fullName,
    faculty: row.faculty,
    programme: row.programme,
    course: row.course,
    groupName: row.groupName,
    disciplines: disciplineRows.map((d) => ({ ...d, outcome: d.outcome ?? 'pending', admitted: d.admitted ?? true })),
    requests: requestRows,
    questions: questionRows,
  }
}

// ---------- Объявления сотрудника ----------

export const ANNOUNCEMENT_TITLE_MAX = 120
export const ANNOUNCEMENT_BODY_MAX = 2000
/** Не больше 20 объявлений в сутки на сотрудника; счёт — в памяти процесса, как у предела вызовов ИИ. */
export const ANNOUNCEMENTS_PER_DAY = 20
const DAY_MS = 24 * 60 * 60 * 1000
const sentAnnouncements = new Map<string, number[]>()

/** Только для тестов: сбросить счётчики объявлений. */
export function resetAnnouncementLimits(): void {
  sentAnnouncements.clear()
}

/** Занять место в суточном пределе сотрудника (скользящие 24 часа). Проверка и запись — без пауз между ними. */
function takeAnnouncementSlot(staffId: string, now: number): boolean {
  const recent = (sentAnnouncements.get(staffId) ?? []).filter((t) => now - t < DAY_MS)
  if (recent.length >= ANNOUNCEMENTS_PER_DAY) {
    sentAnnouncements.set(staffId, recent)
    return false
  }
  recent.push(now)
  sentAnnouncements.set(staffId, recent)
  return true
}

/** Заголовок: пробелы и переводы строк сжимаются в один пробел, край обрезается; 1–120 знаков. Иначе null. */
export function normalizeAnnouncementTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length === 0 || text.includes('\u0000')) return null
  return Array.from(text).length <= ANNOUNCEMENT_TITLE_MAX ? text : null
}

/** Текст: переводы строк приводятся к `\n`, край обрезается; 1–2000 знаков. Иначе null. */
export function normalizeAnnouncementBody(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\r\n?/g, '\n').trim()
  if (text.length === 0 || text.includes('\u0000')) return null
  return Array.from(text).length <= ANNOUNCEMENT_BODY_MAX ? text : null
}

export interface CohortAudiences {
  groups: { id: string; name: string; faculty: string }[]
  /** Факультеты студентов набора: «весь поток». */
  faculties: string[]
}

/** Кому сотрудник может адресовать объявление: группы и факультеты студентов своего набора. */
export async function listCohortAudiences(actor: Actor): Promise<CohortAudiences> {
  const { cohort } = requireStaff(actor)
  const rows = await getDb()
    .selectDistinct({ id: groups.id, name: groups.name, faculty: students.faculty })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(and(eq(users.cohort, cohort), eq(users.role, 'student')))
    .orderBy(asc(groups.name))
  const byGroup = new Map<string, { id: string; name: string; faculty: string }>()
  for (const r of rows) if (!byGroup.has(r.id)) byGroup.set(r.id, r)
  const faculties = [...new Set(rows.map((r) => r.faculty))].sort((a, b) => a.localeCompare(b, 'ru'))
  return { groups: [...byGroup.values()], faculties }
}

export interface StaffAnnouncementItem {
  id: string
  title: string
  body: string
  publishedAt: Date
  /** Группа или «Весь поток: факультет». */
  audience: string
}

/** Объявления, адресованные группам и факультетам набора, за последние `days` суток; новые сверху. */
export async function listCohortAnnouncements(actor: Actor, days = 30, now: Date = new Date()): Promise<StaffAnnouncementItem[]> {
  const { cohort } = requireStaff(actor)
  const since = new Date(now.getTime() - days * DAY_MS)
  const rows = await getDb()
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      publishedAt: announcements.publishedAt,
      groupName: groups.name,
      faculty: announcements.faculty,
    })
    .from(announcements)
    .leftJoin(groups, eq(groups.id, announcements.groupId))
    .where(and(addressedToCohort(cohort), gte(announcements.publishedAt, since)))
    .orderBy(desc(announcements.publishedAt))
    .limit(100)
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    publishedAt: r.publishedAt,
    audience: r.groupName ? `Группа ${r.groupName}` : `Весь поток: ${r.faculty ?? ''}`,
  }))
}

/**
 * Может ли роль приложения писать в `announcements`. Права роли задаёт `db/migrate-lib.ts` (GRANTS, ADR-0002), и записи объявлений
 * там пока нет: без права форма не показывается, а `createCohortAnnouncement` отвечает `unavailable`, а не ошибкой базы.
 * Появится строка `GRANT INSERT ON announcements` — объявления заработают без правок кода.
 */
export async function canPostAnnouncements(actor: Actor): Promise<boolean> {
  requireStaff(actor)
  const res = await getDb().execute(sql`select has_table_privilege(current_user, 'public.announcements', 'INSERT') as ok`)
  return res.rows[0]?.ok === true
}

export type CreateAnnouncementResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'invalid_input' | 'invalid_audience' | 'rate_limited' | 'unavailable' }

/**
 * Объявление группе или всему потоку. Адресат приходит строкой `group:<номер>` или `faculty:<название>` и сверяется со списком
 * набора сотрудника: чужая группа и чужой факультет — `invalid_audience`, запись не создаётся. Заголовок до 120 знаков и текст до 2000
 * проверяются здесь, а не только полями формы. Предел — 20 в сутки на сотрудника, место занимается после проверок.
 * Студенты видят объявление в ленте «Объявления» по тому же условию «группа или факультет», что и прежние.
 */
export async function createCohortAnnouncement(
  actor: Actor,
  input: { audience: unknown; title: unknown; body: unknown },
  now: number = Date.now(),
): Promise<CreateAnnouncementResult> {
  const { staffId } = requireStaff(actor)
  const title = normalizeAnnouncementTitle(input?.title)
  const body = normalizeAnnouncementBody(input?.body)
  const audience = typeof input?.audience === 'string' ? input.audience : ''
  if (title === null || body === null) return { ok: false, reason: 'invalid_input' }

  const allowed = await listCohortAudiences(actor)
  let target: { groupId: string | null; faculty: string | null } | null = null
  if (audience.startsWith('group:')) {
    const groupId = audience.slice('group:'.length)
    if (isUuid(groupId) && allowed.groups.some((g) => g.id === groupId)) target = { groupId, faculty: null }
  } else if (audience.startsWith('faculty:')) {
    const faculty = audience.slice('faculty:'.length)
    if (allowed.faculties.includes(faculty)) target = { groupId: null, faculty }
  }
  if (!target) return { ok: false, reason: 'invalid_audience' }
  if (!(await canPostAnnouncements(actor))) return { ok: false, reason: 'unavailable' }
  if (!takeAnnouncementSlot(staffId, now)) return { ok: false, reason: 'rate_limited' }

  const inserted = await getDb()
    .insert(announcements)
    .values({ groupId: target.groupId, faculty: target.faculty, title, body })
    .returning({ id: announcements.id })
  return { ok: true, id: inserted[0]!.id }
}

// ---------- Сводка: вопросы без ответа (шлифовка 20.11) ----------

export interface StaffUnansweredQuestion extends StaffQuestionItem {
  /** Начало текста вопроса: до 120 знаков, без хвоста. */
  excerpt: string
}

export const SUMMARY_UNANSWERED_MAX = 5

/**
 * Вопросы студентов своего набора в статусе «Отправлен», новые сверху, не больше `limit` (по умолчанию и не более 5). Набор — из сессии.
 * Текст вопроса целиком не отдаётся: только начало для строки сводки.
 */
export async function listCohortUnansweredQuestions(actor: Actor, limit = SUMMARY_UNANSWERED_MAX): Promise<StaffUnansweredQuestion[]> {
  const { cohort } = requireStaff(actor)
  const take = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), SUMMARY_UNANSWERED_MAX) : SUMMARY_UNANSWERED_MAX
  return getDb()
    .select({ ...questionListColumns, excerpt: sql<string>`left(${questions.body}, 120)` })
    .from(questions)
    .innerJoin(students, eq(students.userId, questions.studentId))
    .innerJoin(users, eq(users.id, students.userId))
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(and(eq(users.cohort, cohort), eq(questions.status, 'sent')))
    .orderBy(desc(questions.createdAt))
    .limit(take)
}

// ---------- Сводка недели для ИИ (20.11) ----------

/** Заявки одного вида за 7 суток. Только числа: ни имён, ни номеров, ни текста. */
export interface WeekDigestRequestKind {
  kind: RequestKind
  /** Подано за последние 7 суток. */
  total: number
  /** Из них сейчас в каждом статусе; нулевые статусы есть в карте. */
  byStatus: Record<RequestStatus, number>
  /** Подано за 7 суток до этого (8–14 суток назад): для слов «выросло». */
  previousWeek: number
  /** «В работе» с прошедшим сроком, любой давности: то же правило, что `getCohortSummary.overdue`. */
  overdue: number
}

/** Вопросы одной темы за 7 суток. Темы — фиксированный список (`QUESTION_TOPICS`); текста вопросов здесь нет. */
export interface WeekDigestTopic {
  topic: QuestionTopic
  total: number
  /** Из поданных за неделю — без ответа сейчас. */
  unanswered: number
  previousWeek: number
}

export interface WeekDigest {
  requests: WeekDigestRequestKind[]
  questions: WeekDigestTopic[]
}

/**
 * Обезличенные числа недели для «Сводки недели от ИИ». Набор — из сессии. Читаются только счётчики по виду, статусу и теме:
 * ФИО, группы, номера записей, примечания и тексты вопросов в выборку не входят. Недели считаются от `now` назад (7 × 24 часа).
 */
export async function getCohortWeekDigest(actor: Actor, today: string, now: Date = new Date()): Promise<WeekDigest> {
  const { cohort } = requireStaff(actor)
  const db = getDb()
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000)
  const [weekRows, previousRows, overdueRows, questionRows, previousQuestionRows] = await Promise.all([
    db
      .select({ kind: requests.kind, status: requests.status, n: sql<number>`count(*)::int` })
      .from(requests)
      .innerJoin(users, eq(users.id, requests.studentId))
      .where(and(eq(users.cohort, cohort), gte(requests.createdAt, weekAgo)))
      .groupBy(requests.kind, requests.status),
    db
      .select({ kind: requests.kind, n: sql<number>`count(*)::int` })
      .from(requests)
      .innerJoin(users, eq(users.id, requests.studentId))
      .where(and(eq(users.cohort, cohort), gte(requests.createdAt, twoWeeksAgo), lt(requests.createdAt, weekAgo)))
      .groupBy(requests.kind),
    isIsoDate(today)
      ? db
          .select({ kind: requests.kind, n: sql<number>`count(*)::int` })
          .from(requests)
          .innerJoin(users, eq(users.id, requests.studentId))
          .where(and(eq(users.cohort, cohort), eq(requests.status, 'in_progress'), lt(requests.dueDate, today)))
          .groupBy(requests.kind)
      : Promise.resolve([] as { kind: string; n: number }[]),
    db
      .select({ topic: questions.topic, status: questions.status, n: sql<number>`count(*)::int` })
      .from(questions)
      .innerJoin(users, eq(users.id, questions.studentId))
      .where(and(eq(users.cohort, cohort), gte(questions.createdAt, weekAgo)))
      .groupBy(questions.topic, questions.status),
    db
      .select({ topic: questions.topic, n: sql<number>`count(*)::int` })
      .from(questions)
      .innerJoin(users, eq(users.id, questions.studentId))
      .where(and(eq(users.cohort, cohort), gte(questions.createdAt, twoWeeksAgo), lt(questions.createdAt, weekAgo)))
      .groupBy(questions.topic),
  ])

  const kinds = REQUEST_KINDS.map((kind): WeekDigestRequestKind => {
    const byStatus = Object.fromEntries(REQUEST_STATUSES.map((st) => [st, 0])) as Record<RequestStatus, number>
    for (const row of weekRows) if (row.kind === kind && isRequestStatus(row.status)) byStatus[row.status] += Number(row.n)
    return {
      kind,
      total: REQUEST_STATUSES.reduce((sum, st) => sum + byStatus[st], 0),
      byStatus,
      previousWeek: previousRows.filter((r) => r.kind === kind).reduce((sum, r) => sum + Number(r.n), 0),
      overdue: overdueRows.filter((r) => r.kind === kind).reduce((sum, r) => sum + Number(r.n), 0),
    }
  })
  const topics = QUESTION_TOPICS.map((topic): WeekDigestTopic => {
    const mine = questionRows.filter((r) => r.topic === topic)
    return {
      topic,
      total: mine.reduce((sum, r) => sum + Number(r.n), 0),
      unanswered: mine.filter((r) => r.status === 'sent').reduce((sum, r) => sum + Number(r.n), 0),
      previousWeek: previousQuestionRows.filter((r) => r.topic === topic).reduce((sum, r) => sum + Number(r.n), 0),
    }
  })
  return { requests: kinds, questions: topics }
}
