'use server'

import { revalidatePath } from 'next/cache'
import { isRequestStatus } from '@/lib/requests'
import { requireStaffActor } from '@/server/auth/page-guards'
import { changeRequestStatus } from '@/server/dal/staff'

export interface ChangeStatusState {
  message: string | null
  ok: boolean
}

const REASON_TEXT: Record<'not_found' | 'invalid_transition' | 'invalid_input', string> = {
  not_found: 'Нет такой заявки',
  invalid_transition: 'Так сменить статус нельзя: заявку уже изменили. Обновите страницу',
  invalid_input: 'Выберите статус и, при отклонении, причину',
}

/**
 * Смена статуса. Сотрудника и его набор определяет сессия. Из формы берутся номер заявки, целевой статус и причина
 * из списка; сроки и кабинет подставляет сервер. Проверку перехода делает слой доступа одним запросом.
 */
export async function changeStatusAction(_prev: ChangeStatusState, formData: FormData): Promise<ChangeStatusState> {
  const actor = await requireStaffActor()
  const requestId = formData.get('requestId')
  const target = formData.get('target')
  const reason = formData.get('reason')
  if (typeof requestId !== 'string' || !isRequestStatus(target)) {
    return { ok: false, message: REASON_TEXT.invalid_input }
  }
  const result = await changeRequestStatus(actor, requestId, {
    target,
    reason: typeof reason === 'string' && reason ? reason : undefined,
  })
  if (!result.ok) return { ok: false, message: REASON_TEXT[result.reason] }
  revalidatePath(`/staff/requests/${requestId}`)
  revalidatePath('/staff/requests')
  return { ok: true, message: 'Статус сохранён' }
}
