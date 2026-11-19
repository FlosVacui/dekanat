'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getClientIp } from '@/server/auth/cookie'
import { requireStaffActor } from '@/server/auth/page-guards'
import { aiEnabled, draftStaffAnswer } from '@/server/ai'
import { answerQuestion, getCohortQuestion } from '@/server/dal/staff'
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

/** Состояние кнопки «Черновик ИИ»: текст для поля или код отказа (текст отказа выбирает форма). */
export interface DraftState {
  draft: string | null
  error: 'unavailable' | 'failed' | null
  /** Растёт с каждым черновиком: форма понимает, что пришёл новый, даже если текст тот же. */
  version: number
}

/**
 * 19.11, ИИ-функции: «Черновик ИИ». Сотрудника и его набор определяет сессия, вопрос ищется слоем доступа вместе с набором
 * (чужой и несуществующий — одинаковый отказ и событие, как у страницы вопроса). Модели уходит только текст вопроса.
 * Ничего не отправляется и не сохраняется: черновик возвращается форме и попадает в поле, правит и отправляет сотрудник.
 * Из формы берётся один номер вопроса. Без ключа модели действие ничего не делает.
 */
export async function draftAnswerAction(previous: DraftState, formData: FormData): Promise<DraftState> {
  const actor = await requireStaffActor()
  const version = (typeof previous?.version === 'number' ? previous.version : 0) + 1
  const questionId = formData.get('questionId')
  if (typeof questionId !== 'string' || !aiEnabled()) return { draft: null, error: 'unavailable', version }
  const ip = await getClientIp()
  const question = await getCohortQuestion(actor, questionId)
  if (!question) {
    logSecurityEvent('access_denied_record', { userId: actor.userId, ip })
    return { draft: null, error: 'failed', version }
  }
  // Ответ один: на вопрос с ответом черновик не нужен.
  if (question.answer !== null) return { draft: null, error: 'failed', version }
  const result = await draftStaffAnswer(question.body, actor.userId)
  return result.ok ? { draft: result.text, error: null, version } : { draft: null, error: 'failed', version }
}
