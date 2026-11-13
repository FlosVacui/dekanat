'use server'

import { redirect } from 'next/navigation'
import { isRequestKind } from '@/lib/requests'
import { getClientIp } from '@/server/auth/cookie'
import { requireStudentActor } from '@/server/auth/page-guards'
import { RequestLimitError } from '@/server/dal/guards'
import { createMyRequest } from '@/server/dal/student'
import { logSecurityEvent } from '@/server/security-log'

/** Значение поля из формы: нет поля — undefined (слой подставит значение по умолчанию); не строка — пустая строка (слой откажет). */
function fieldValue(entry: FormDataEntryValue | null): string | undefined {
  if (entry === null) return undefined
  return typeof entry === 'string' ? entry : ''
}

/**
 * Подача заявки. Студента определяет сессия; из формы берутся вид и значение поля этого вида. Проверяет значение слой
 * доступа: не из списка — заявка не создаётся, переход на список заявок. После подачи — экран заявки.
 * Лимит исчерпан — обратно на экран новой заявки с кодом отказа в адресе; текст отказа выбирает страница
 * из двух готовых, число из адреса она не берёт.
 */
export async function createRequestAction(formData: FormData): Promise<void> {
  const actor = await requireStudentActor()
  const kind = formData.get('kind')
  if (!isRequestKind(kind)) redirect('/requests')
  const purpose = fieldValue(formData.get('purpose'))
  const paymentYear = fieldValue(formData.get('paymentYear'))
  const ip = await getClientIp()
  let createdId: string | null
  try {
    createdId = (await createMyRequest(actor, { kind, purpose, paymentYear }, ip))?.id ?? null
  } catch (error) {
    if (!(error instanceof RequestLimitError)) throw error
    logSecurityEvent('request_limit', { userId: actor.userId, ip })
    redirect(`/requests/new?type=${kind}&limit=${error.scope}`)
  }
  if (!createdId) redirect('/requests')
  redirect(`/requests/${createdId}`)
}
