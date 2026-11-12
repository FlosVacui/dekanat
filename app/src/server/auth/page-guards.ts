import 'server-only'
import { forbidden, notFound, redirect } from 'next/navigation'
import { logSecurityEvent } from '../security-log'
import { getClientIp, getCurrentActor } from './cookie'
import type { Actor } from './session'

// Охрана страниц и действий. Функции слоя всё равно проверяют роль сами: это вторая линия, а не замена.
// Отказ по роли пишется в журнал событий безопасности (ADR-0003): номер пользователя и адрес, больше ничего.

async function denyByRole(actor: Actor): Promise<never> {
  logSecurityEvent('access_denied_role', { userId: actor.userId, ip: await getClientIp() })
  forbidden()
}

/**
 * Слой доступа вернул «не найдено» по номеру заявки: чужая запись или такой нет — слой их не различает (ADR-0002).
 * Страница пишет событие и отвечает 404. В записи номер пользователя и адрес; номера заявки нет: он взят из адреса
 * страницы, то есть это ввод посетителя (ADR-0003, дополнение по RV-3.1-1).
 */
export async function denyRecord(actor: Actor): Promise<never> {
  logSecurityEvent('access_denied_record', { userId: actor.userId, ip: await getClientIp() })
  notFound()
}

/** Страница студента: не вошёл — на вход; сотрудник — отказ 403, а не пустая страница с кодом 200 (ADR-0002, правило 3). */
export async function requireStudentActor(): Promise<Actor> {
  const actor = await getCurrentActor()
  if (!actor) redirect('/login')
  if (actor.role !== 'student') return denyByRole(actor)
  return actor
}

/** Страница сотрудника: не вошёл — на вход; студент — отказ 403. */
export async function requireStaffActor(): Promise<Actor> {
  const actor = await getCurrentActor()
  if (!actor) redirect('/login')
  if (actor.role !== 'staff') return denyByRole(actor)
  return actor
}
