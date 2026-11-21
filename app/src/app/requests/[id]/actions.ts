'use server'

import { redirect } from 'next/navigation'
import { parseRatingChoice } from '@/components/requests/rating'
import { getClientIp } from '@/server/auth/cookie'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getMyRequest, rateMyRequest, withdrawMyRequest } from '@/server/dal/student'
import { logSecurityEvent } from '@/server/security-log'

// 20.11: два действия студента над своей заявкой. Владельца определяет сессия; из формы берётся номер заявки (запись ищется
// вместе с владельцем в слое доступа) и, для оценки, одно из двух слов. Статус и оценку как число форма не передаёт.

function formText(entry: FormDataEntryValue | null): string {
  return typeof entry === 'string' ? entry : ''
}

/** Отзыв заявки «Подана». Не прошёл — заявка чужая или нет такой (событие, список), либо её уже взяли в работу (экран заявки с пояснением). */
export async function withdrawRequestAction(formData: FormData): Promise<void> {
  const actor = await requireStudentActor()
  const requestId = formText(formData.get('requestId'))
  const ip = await getClientIp()
  if (await withdrawMyRequest(actor, requestId, ip)) redirect(`/requests/${requestId}`)
  // Слой не различает чужую заявку и «уже в работе»: различает отдельное чтение с владельцем из сессии.
  const own = await getMyRequest(actor, requestId)
  if (!own) {
    logSecurityEvent('access_denied_record', { userId: actor.userId, ip })
    redirect('/requests')
  }
  redirect(`/requests/${own.id}?notice=not-withdrawn`)
}

/** Оценка выдачи: «up» или «down». Другое значение и заявка не в статусе «Выдана» — ничего не меняется. */
export async function rateRequestAction(formData: FormData): Promise<void> {
  const actor = await requireStudentActor()
  const requestId = formText(formData.get('requestId'))
  const choice = parseRatingChoice(formData.get('value'))
  const ip = await getClientIp()
  if (choice !== null && (await rateMyRequest(actor, requestId, choice))) redirect(`/requests/${requestId}`)
  const own = await getMyRequest(actor, requestId)
  if (!own) {
    logSecurityEvent('access_denied_record', { userId: actor.userId, ip })
    redirect('/requests')
  }
  redirect(`/requests/${own.id}`)
}
