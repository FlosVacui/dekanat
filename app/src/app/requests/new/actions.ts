'use server'

import { redirect } from 'next/navigation'
import { isRequestKind } from '@/lib/requests'
import { getClientIp } from '@/server/auth/cookie'
import { requireStudentActor } from '@/server/auth/page-guards'
import { createMyRequest } from '@/server/dal/student'

/** Подача заявки. Студента определяет сессия; из формы берётся только вид. После подачи — экран заявки. */
export async function createRequestAction(formData: FormData): Promise<void> {
  const actor = await requireStudentActor()
  const kind = formData.get('kind')
  if (!isRequestKind(kind)) redirect('/requests')
  const created = await createMyRequest(actor, { kind }, await getClientIp())
  if (!created) redirect('/requests')
  redirect(`/requests/${created.id}`)
}
