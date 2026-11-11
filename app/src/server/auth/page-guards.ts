import 'server-only'
import { forbidden, redirect } from 'next/navigation'
import { getCurrentActor } from './cookie'
import type { Actor } from './session'

// Охрана страниц и действий. Функции слоя всё равно проверяют роль сами: это вторая линия, а не замена.

/** Страница студента: не вошёл — на вход; сотрудник — отказ 403, а не пустая страница с кодом 200 (ADR-0002, правило 3). */
export async function requireStudentActor(): Promise<Actor> {
  const actor = await getCurrentActor()
  if (!actor) redirect('/login')
  if (actor.role !== 'student') forbidden()
  return actor
}

/** Страница сотрудника: не вошёл — на вход; студент — отказ 403. */
export async function requireStaffActor(): Promise<Actor> {
  const actor = await getCurrentActor()
  if (!actor) redirect('/login')
  if (actor.role !== 'staff') forbidden()
  return actor
}
