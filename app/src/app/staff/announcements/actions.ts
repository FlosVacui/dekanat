'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getClientIp } from '@/server/auth/cookie'
import { requireStaffActor } from '@/server/auth/page-guards'
import { createCohortAnnouncement } from '@/server/dal/staff'
import { logSecurityEvent } from '@/server/security-log'

/**
 * 20.11, блиц: объявление группе или потоку. Сотрудника и его набор определяет сессия; из формы берутся адресат, заголовок и текст.
 * Адресат сверяется слоем доступа со списком набора, длины и предел «20 в сутки» проверяет он же. Исход — в параметре адреса
 * `?result=` (форма без скриптов работает так же): ok, invalid, audience, limit, unavailable. Чужой адресат — подделанная форма: событие в журнал.
 */
export async function createAnnouncementAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const result = await createCohortAnnouncement(actor, {
    audience: formData.get('audience'),
    title: formData.get('title'),
    body: formData.get('body'),
  })
  if (result.ok) {
    revalidatePath('/staff/announcements')
    redirect('/staff/announcements?result=ok')
  }
  const ip = await getClientIp()
  if (result.reason === 'rate_limited') {
    logSecurityEvent('status_limit', { userId: actor.userId, ip })
    redirect('/staff/announcements?result=limit')
  }
  if (result.reason === 'unavailable') redirect('/staff/announcements?result=unavailable')
  if (result.reason === 'invalid_audience') {
    logSecurityEvent('access_denied_record', { userId: actor.userId, ip })
    redirect('/staff/announcements?result=audience')
  }
  redirect('/staff/announcements?result=invalid')
}
