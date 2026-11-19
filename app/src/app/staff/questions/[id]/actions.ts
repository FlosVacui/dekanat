'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getClientIp } from '@/server/auth/cookie'
import { requireStaffActor } from '@/server/auth/page-guards'
import { answerQuestion } from '@/server/dal/staff'
import { logSecurityEvent } from '@/server/security-log'

/**
 * Ответ на вопрос. Сотрудника и его набор определяет сессия; из формы берутся номер вопроса и текст ответа.
 * Проверку набора, статуса «Отправлен», длины и предела делает слой доступа одним запросом.
 * Адрес посетителя передаётся в слой для предела «30 ответов в минуту на пару аккаунт и адрес».
 * Любой исход — обратно на экран вопроса: при успехе там виден ответ. Новых текстов отказа нет, поэтому отказ по пределу
 * и по длине экран не объясняет: он остаётся с формой; отказ по пределу пишется в журнал безопасности.
 * Номер чужого набора или несуществующий — подделанная форма: событие, как у страницы чужой записи, и возврат к списку.
 */
export async function answerQuestionAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const questionId = formData.get('questionId')
  const text = formData.get('text')
  if (typeof questionId !== 'string' || typeof text !== 'string') redirect('/staff/requests?view=questions')
  const ip = await getClientIp()
  const result = await answerQuestion(actor, questionId, text, ip)
  if (!result.ok) {
    if (result.reason === 'rate_limited') logSecurityEvent('status_limit', { userId: actor.userId, ip })
    if (result.reason === 'not_found') {
      logSecurityEvent('access_denied_record', { userId: actor.userId, ip })
      redirect('/staff/requests?view=questions')
    }
    redirect(`/staff/questions/${questionId}`)
  }
  revalidatePath(`/staff/questions/${questionId}`)
  revalidatePath('/staff/requests')
  redirect(`/staff/questions/${questionId}`)
}
