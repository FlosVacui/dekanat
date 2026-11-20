'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { BULK_FAILURES, BULK_MAX, bulkOutcomeParams, isBulkTarget, type BulkOutcome } from '@/components/staff/bulk-result'
import { isAllowedTransition, isRequestStatus } from '@/lib/requests'
import { getClientIp } from '@/server/auth/cookie'
import { requireStaffActor } from '@/server/auth/page-guards'
import { changeRequestStatus, getCohortRequestStatuses } from '@/server/dal/staff'
import { logSecurityEvent } from '@/server/security-log'

type Failure = keyof typeof BULK_FAILURES

/** Куда вернуться: тот же фильтр и поиск, что были на странице. Значения проверяются, чужой текст в адрес не попадает. */
function backTo(formData: FormData, extra: URLSearchParams): string {
  const params = new URLSearchParams()
  const status = formData.get('status')
  if (isRequestStatus(status)) params.set('status', status)
  const q = formData.get('q')
  if (typeof q === 'string' && q.trim()) params.set('q', q.trim().slice(0, 100))
  for (const [k, v] of extra) params.set(k, v)
  const query = params.toString()
  return query ? `/staff/requests?${query}` : '/staff/requests'
}

function fail(formData: FormData, reason: Failure): never {
  redirect(backTo(formData, new URLSearchParams({ bulk: reason })))
}

/**
 * 20.11, деканат: заявки пачкой. Из формы берутся целевой статус (из трёх: «В работу», «Готова», «Выдана») и номера отмеченных заявок
 * (не больше 50, повторы отбрасываются). Сотрудника и набор определяет сессия. Недопустимые переходы пропускаются до вызова слоя,
 * чтобы не тратить предел «30 смен в минуту на пару аккаунт и адрес»; каждая допустимая смена идёт тем же `changeRequestStatus`,
 * что и одиночная: условный UPDATE, история, уведомление студенту, предел. Слой всё равно проверяет всё сам: если статус успел
 * измениться, переход отклонён и посчитан как пропущенный. Предел исчерпан — остальные пропускаются с этой причиной.
 * Исход идёт в параметры адреса, форма без скриптов работает так же.
 */
export async function bulkStatusAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const target = formData.get('target')
  if (!isBulkTarget(target)) return fail(formData, 'invalid')
  const ids = [...new Set(formData.getAll('id').filter((v): v is string => typeof v === 'string' && v !== ''))]
  if (ids.length === 0) return fail(formData, 'none')
  if (ids.length > BULK_MAX) return fail(formData, 'many')

  const ip = await getClientIp()
  const statuses = await getCohortRequestStatuses(actor, ids)
  const outcome: BulkOutcome = { changed: 0, skipped: { transition: 0, limit: 0, missing: 0 } }
  let limited = false
  let foreign = false
  for (const id of ids) {
    const status = statuses.get(id)
    if (status === undefined) {
      outcome.skipped.missing += 1
      foreign = true
      continue
    }
    if (!isRequestStatus(status) || !isAllowedTransition(status, target)) {
      outcome.skipped.transition += 1
      continue
    }
    if (limited) {
      outcome.skipped.limit += 1
      continue
    }
    const result = await changeRequestStatus(actor, id, { target }, ip)
    if (result.ok) outcome.changed += 1
    else if (result.reason === 'rate_limited') {
      limited = true
      outcome.skipped.limit += 1
    } else if (result.reason === 'not_found') {
      outcome.skipped.missing += 1
      foreign = true
    } else outcome.skipped.transition += 1
  }
  if (limited) logSecurityEvent('status_limit', { userId: actor.userId, ip })
  // Номер не из набора или несуществующий — подделанная форма: одно событие на пачку, как у одиночной смены.
  if (foreign) logSecurityEvent('access_denied_record', { userId: actor.userId, ip })
  revalidatePath('/staff/requests')
  revalidatePath('/staff')
  redirect(backTo(formData, bulkOutcomeParams(outcome)))
}
