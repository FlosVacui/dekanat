import 'server-only'
import { cookies, headers } from 'next/headers'
import { isIP } from 'node:net'
import { getConfig } from '../config'
import { normalizeIp } from './ip'
import { SESSION_TTL_MS, destroySession, resolveActor, type Actor } from './session'

// Кука сессии и адрес посетителя. Кука: префикс `__Host-`, HttpOnly, Secure, SameSite=Lax, Path=/, без Domain, срок задан
// (ADR-0003). Флаг Secure не снимается нигде. Localhost браузер считает безопасным контекстом: проверка — сквозной тест.

export const SESSION_COOKIE = '__Host-session'

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
}

/** Кто сейчас спрашивает. null — не вошёл или сессия просрочена. */
export async function getCurrentActor(): Promise<Actor | null> {
  const store = await cookies()
  return resolveActor(store.get(SESSION_COOKIE)?.value)
}

/** Выход: сессия удаляется в базе и кука гасится. */
export async function logout(): Promise<void> {
  const store = await cookies()
  await destroySession(store.get(SESSION_COOKIE)?.value)
  await clearSessionCookie()
}

/**
 * Адрес посетителя — из одного заголовка, имя которого задано в окружении (его ставит свой обратный прокси,
 * ADR-0003). Заголовка нет, как при локальном запуске, или в нём не адрес — «unknown».
 */
export async function getClientIp(): Promise<string> {
  const name = getConfig().clientIpHeader
  if (!name) return 'unknown'
  const value = (await headers()).get(name)
  if (!value) return 'unknown'
  const first = (value.split(',')[0] ?? '').trim()
  // IPv6 приводится к сети /64 той же функцией, что и в слое доступа (ip.ts).
  return isIP(first) ? normalizeIp(first) : 'unknown'
}
