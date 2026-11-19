'use server'

import { redirect } from 'next/navigation'
import { isQuestionTopic } from '@/lib/questions'
import { getClientIp } from '@/server/auth/cookie'
import { requireStudentActor } from '@/server/auth/page-guards'
import { RequestLimitError } from '@/server/dal/guards'
import { createMyQuestion } from '@/server/dal/student'
import { logSecurityEvent } from '@/server/security-log'

/**
 * Вопрос в деканат. Студента определяет сессия; из формы берутся тема и текст, номера студента в форме нет. Проверяет значения
 * слой доступа: тема не из списка, пустой или слишком длинный текст — вопрос не создаётся, обратно на форму.
 * После отправки — экран вопроса. Предел исчерпан — обратно на форму с кодом отказа в адресе; текст отказа выбирает страница
 * из двух готовых, число из адреса она не берёт.
 */
export async function createQuestionAction(formData: FormData): Promise<void> {
  const actor = await requireStudentActor()
  const topic = formData.get('topic')
  const text = formData.get('text')
  if (!isQuestionTopic(topic) || typeof text !== 'string') redirect('/questions/new')
  const ip = await getClientIp()
  let createdId: string | null
  try {
    createdId = (await createMyQuestion(actor, { topic, text }, ip))?.id ?? null
  } catch (error) {
    if (!(error instanceof RequestLimitError)) throw error
    logSecurityEvent('request_limit', { userId: actor.userId, ip })
    redirect(`/questions/new?limit=${error.scope}`)
  }
  if (!createdId) redirect('/questions/new')
  redirect(`/questions/${createdId}`)
}
