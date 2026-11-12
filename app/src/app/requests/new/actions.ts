'use server'

import { redirect } from 'next/navigation'
import { isRequestKind } from '@/lib/requests'
import { getClientIp } from '@/server/auth/cookie'
import { requireStudentActor } from '@/server/auth/page-guards'
import { RequestLimitError } from '@/server/dal/guards'
import { createMyRequest } from '@/server/dal/student'
import { logSecurityEvent } from '@/server/security-log'

/**
 * Подача заявки. Студента определяет сессия; из формы берётся только вид. После подачи — экран заявки.
 * Лимит исчерпан — обратно на экран новой заявки с кодом отказа в адресе; текст отказа выбирает страница
 * из двух готовых, число из адреса она не берёт.
 */
export async function createRequestAction(formData: FormData): Promise<void> {
  const actor = await requireStudentActor()
  const kind = formData.get('kind')
  if (!isRequestKind(kind)) redirect('/requests')
  const ip = await getClientIp()
  let createdId: string | null
  try {
    createdId = (await createMyRequest(actor, { kind }, ip))?.id ?? null
  } catch (error) {
    if (!(error instanceof RequestLimitError)) throw error
    logSecurityEvent('request_limit', { userId: actor.userId, ip })
    redirect(`/requests/new?type=${kind}&limit=${error.scope}`)
  }
  if (!createdId) redirect('/requests')
  redirect(`/requests/${createdId}`)
}
