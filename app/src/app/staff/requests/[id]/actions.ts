'use server'

import { revalidatePath } from 'next/cache'
import { isRequestStatus } from '@/lib/requests'
import { getClientIp } from '@/server/auth/cookie'
import { requireStaffActor } from '@/server/auth/page-guards'
import { changeRequestStatus } from '@/server/dal/staff'
import { logSecurityEvent } from '@/server/security-log'

export interface ChangeStatusState {
  message: string | null
  ok: boolean
}

const REASON_TEXT: Record<'not_found' | 'invalid_transition' | 'invalid_input' | 'rate_limited', string> = {
  not_found: 'Нет такой заявки',
  invalid_transition: 'Так сменить статус нельзя: заявку уже изменили. Обновите страницу',
  invalid_input: 'Выберите статус и, при отклонении, причину',
  rate_limited: 'Слишком много смен статуса за минуту. Подождите минуту и повторите',
}

/**
 * Смена статуса. Сотрудника и его набор определяет сессия. Из формы берутся номер заявки, целевой статус и причина
 * из списка; сроки и кабинет подставляет сервер. Проверку перехода делает слой доступа одним запросом.
 * Адрес посетителя передаётся в слой для лимита «30 смен в минуту на пару аккаунт и адрес».
 */
export async function changeStatusAction(_prev: ChangeStatusState, formData: FormData): Promise<ChangeStatusState> {
  const actor = await requireStaffActor()
  const requestId = formData.get('requestId')
  const target = formData.get('target')
  const reason = formData.get('reason')
  if (typeof requestId !== 'string' || !isRequestStatus(target)) {
    return { ok: false, message: REASON_TEXT.invalid_input }
  }
  const ip = await getClientIp()
  const result = await changeRequestStatus(
    actor,
    requestId,
    {
      target,
      reason: typeof reason === 'string' && reason ? reason : undefined,
    },
    ip,
  )
  if (!result.ok) {
    if (result.reason === 'rate_limited') logSecurityEvent('status_limit', { userId: actor.userId, ip })
    // Заявка другого набора или несуществующая — подделанная форма: событие, как у страницы чужой заявки (R-3.10-2).
    if (result.reason === 'not_found') logSecurityEvent('access_denied_record', { userId: actor.userId, ip })
    return { ok: false, message: REASON_TEXT[result.reason] }
  }
  revalidatePath(`/staff/requests/${requestId}`)
  revalidatePath('/staff/requests')
  return { ok: true, message: 'Статус сохранён' }
}
