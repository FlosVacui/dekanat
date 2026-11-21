'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getClientIp } from '@/server/auth/cookie'
import { requireStaffActor } from '@/server/auth/page-guards'
import { removeCohortAnnouncement } from '@/server/dal/staff'
import { logSecurityEvent } from '@/server/security-log'

/**
 * 20.11, деканат: «Снять» объявление. Это второй шаг: первый — ссылка `?remove=<номер>` на странице, которая только показывает вопрос
 * «Снять объявление?» и кнопки «Да, снять» и «Отмена». Сотрудника и набор определяет сессия; из формы берётся только номер объявления.
 * Слой доступа удаляет одним запросом с условием «объявление адресовано группам или факультетам набора»: чужое и несуществующее
 * отвечают одинаково — это подделанная форма, событие в журнал. Исход — в параметре `?result=`: removed, missing, unavailable.
 */
export async function removeAnnouncementAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const id = formData.get('announcementId')
  const result = await removeCohortAnnouncement(actor, typeof id === 'string' ? id : '')
  if (result.ok) {
    revalidatePath('/staff/announcements')
    redirect('/staff/announcements?result=removed')
  }
  if (result.reason === 'unavailable') redirect('/staff/announcements?result=remove-unavailable')
  logSecurityEvent('access_denied_record', { userId: actor.userId, ip: await getClientIp() })
  redirect('/staff/announcements?result=missing')
}
