import 'server-only'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { todayIn } from '@/lib/dates'
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
import type { Actor } from '../auth/session'
import { getConfig } from '../config'
import { getDb } from './client'
import { isUuid, requireStaff } from './guards'
import { groups, notifications, requestEvents, requests, students, users } from './schema'

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
}

export interface StaffRequestDetail extends StaffRequestItem {
  dueDate: string | null
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
      dueDate: requests.dueDate,
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
  | { ok: false; reason: 'not_found' | 'invalid_transition' | 'invalid_input' }

/**
 * Смена статуса: один запрос `UPDATE … WHERE` с номером, набором и статусом «из какого». Строк изменено ноль —
 * отказ. Сотрудник передаёт только целевой статус и, при отклонении, причину из списка; всё остальное
 * (сроки, кабинет) подставляет сервер. История статусов и уведомление владельцу пишутся в той же транзакции.
 */
export async function changeRequestStatus(
  actor: Actor,
  requestId: string,
  input: { target: RequestStatus; reason?: string },
): Promise<ChangeStatusResult> {
  const { staffId, cohort } = requireStaff(actor)
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
