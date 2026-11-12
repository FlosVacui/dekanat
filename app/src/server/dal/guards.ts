import 'server-only'
import { isActor, type Actor } from '../auth/session'

/** Роль действующего лица не подходит функции слоя: отказ, а не пустой ответ (ADR-0002, правило 3). */
export class ForbiddenError extends Error {
  constructor() {
    super('forbidden')
    this.name = 'ForbiddenError'
  }
}

/**
 * Лимит подачи заявок исчерпан (ADR-0003, «Лимит записи»): `pair` — на пару «аккаунт и адрес», `account` — на аккаунт.
 * Исключение, а не результат: прежние вызовы `createMyRequest` ждут `{ id } | null`.
 */
export class RequestLimitError extends Error {
  readonly scope: 'pair' | 'account'
  constructor(scope: 'pair' | 'account') {
    super('request_limit')
    this.name = 'RequestLimitError'
    this.scope = scope
  }
}

const UUID =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Не UUID — значит, такой записи нет: ответ тот же, что для чужой записи, и без ошибки базы. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Первым делом в каждой функции студента. Владелец и группа — только из сессии. */
export function requireStudent(actor: Actor): { studentId: string; groupId: string; cohort: string } {
  if (!isActor(actor) || actor.role !== 'student' || !actor.groupId) throw new ForbiddenError()
  return { studentId: actor.userId, groupId: actor.groupId, cohort: actor.cohort }
}

/** Первым делом в каждой функции сотрудника. */
export function requireStaff(actor: Actor): { staffId: string; cohort: string } {
  if (!isActor(actor) || actor.role !== 'staff') throw new ForbiddenError()
  return { staffId: actor.userId, cohort: actor.cohort }
}
