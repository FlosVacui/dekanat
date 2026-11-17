'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getClientIp } from '@/server/auth/cookie'
import { requireStudentActor } from '@/server/auth/page-guards'
import { markAllMyFeedRead, markMyFeedItemRead } from '@/server/dal/student'
import { logSecurityEvent } from '@/server/security-log'
import { notificationsHref, parseFilter, safeInternalPath } from './filter'

/**
 * Открыть запись ленты: она отмечается прочитанной, затем переход. Студента определяет сессия; из формы берутся источник,
 * номер и фильтр. Адрес перехода — только ссылка своего уведомления из базы и только внутренний путь. Нет ссылки, ссылка
 * ведёт на сам экран уведомлений — обратно на ленту с тем же фильтром; ссылка не годится — на `/notifications`.
 * Отметка ставится только отправкой формы: переход по ссылке (в том числе заранее подгруженный) её не ставит.
 */
export async function openFeedItemAction(formData: FormData): Promise<void> {
  const actor = await requireStudentActor()
  const filter = parseFilter(formData.get('filter'))
  const { found, link } = await markMyFeedItemRead(actor, formData.get('source'), formData.get('id'))
  // Чужая или несуществующая запись — подделанная форма: событие, как у страницы чужой записи (R-3.5-5, denyRecord).
  if (!found) logSecurityEvent('access_denied_record', { userId: actor.userId, ip: await getClientIp() })
  // Число у колокольчика стоит на каждом экране: кэш переходов браузера сбрасывается, чтобы «Назад» не показал старое число.
  revalidatePath('/', 'layout')
  if (link === null || link === '/notifications') redirect(notificationsHref(filter))
  const target = safeInternalPath(link)
  redirect(target ?? '/notifications')
}

/** Отметить всё непрочитанное этого студента и вернуться на ленту с тем же фильтром. */
export async function markAllFeedReadAction(formData: FormData): Promise<void> {
  const actor = await requireStudentActor()
  const filter = parseFilter(formData.get('filter'))
  await markAllMyFeedRead(actor)
  revalidatePath('/', 'layout')
  redirect(notificationsHref(filter))
}
