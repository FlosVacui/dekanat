import 'server-only'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { todayIn } from '@/lib/dates'
import { normalizeQuestionText, topicLabel } from '@/lib/questions'
import {
  ALLOWED_FROM,
  REQUEST_KIND_INFO,
  STATUS_LABELS,
  computeDueDate,
  computePickupUntil,
  isRejectReason,
  isRequestKind,
  isRequestStatus,
  type RequestStatus,
} from '@/lib/requests'
import { normalizeIp } from '../auth/ip'
import type { Actor } from '../auth/session'
import { getConfig } from '../config'
import { getDb } from './client'
import { isUuid, requireStaff } from './guards'
import { groups, notifications, questions, requestEvents, requests, students, users } from './schema'

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
