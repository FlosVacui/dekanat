import 'server-only'
import { findLoginRecord } from '../dal/auth'
import {
  LOGIN_CLOSE_AFTER,
  clearLoginCounters,
  recordAddressAttempt,
  recordLoginStreak,
  recordPairAttempt,
} from '../dal/login-limits'
import { logSecurityEvent } from '../security-log'
import { BusyError, hashGate } from './gate'
import { normalizeIp } from './ip'
import { MAX_PASSWORD_LENGTH, hashPassword, verifyPassword } from './password'
import { createSession } from './session'

// Вход (ADR-0003). Порядок одинаков для «нет логина», «неверный пароль» и «логин закрыт»:
//   1. адрес: не больше 30 попыток за 10 минут, считается до хеша;
//   2. пара «адрес и логин»: пять попыток без задержки, дальше 1, 2, 4 секунды и так до 5 минут;
//   3. поиск логина; для логина с неопубликованным паролем — счётчик «100 неверных подряд»;
//   4. хеш — всегда, для выдуманного логина по заготовленной строке;
//   5. отказ или сессия.
// Каждая попытка записывается в базу до проверки пароля одной атомарной операцией (слой доступа, login-limits.ts).
// Отказы «подождите» и «лимит адреса» хеш не считают. Код HTTP вход не задаёт: это действие на сервере,
// вид отказа и число секунд возвращаются экрану (поправка ADR-0003 от 12.11.2026).

const MAX_LOGIN_LENGTH = 128

/** Логин приводится к одному виду одной функцией: пробелы по краям срезаны, буквы строчные. */
export function normalizeLogin(raw: string): string {
  return raw.trim().toLowerCase()
}

export type LoginOutcome =
  | { ok: true; token: string; expiresAt: Date }
  /** Неверная пара — и «нет такого логина», и «неверный пароль», и «логин закрыт». Различить их снаружи нельзя. */
  | { ok: false; reason: 'invalid' }
  /** Пара «адрес и логин» ждёт: следующая попытка не раньше чем через `retryAfterSeconds`. */
  | { ok: false; reason: 'wait'; retryAfterSeconds: number }
  /** С этого адреса слишком много попыток: окно закрывается через `retryAfterSeconds`. */
  | { ok: false; reason: 'ip_limited'; retryAfterSeconds: number }
  /** Очередь хеша полна. */
  | { ok: false; reason: 'busy' }

const INVALID = { ok: false, reason: 'invalid' } as const

/**
 * Заготовка для несуществующего логина: хеш ненастоящего пароля считается в самом начале работы процесса,
 * а не при первом выдуманном логине, иначе первый такой вход занял бы вдвое больше времени.
 */
const dummyHash: Promise<string> = hashPassword('нет-такого-пользователя')
dummyHash.catch(() => undefined)

export async function authenticate(rawLogin: string, password: string, ip: string): Promise<LoginOutcome> {
  const login = normalizeLogin(rawLogin)
  if (!login || login.length > MAX_LOGIN_LENGTH || !password || password.length > MAX_PASSWORD_LENGTH) {
    return INVALID
  }
  const address = normalizeIp(ip)
  let userId: string | null = null
  try {
    const window = await recordAddressAttempt(address)
    if (!window.allowed) {
      logSecurityEvent('login_ip_limited', { ip: address })
      return { ok: false, reason: 'ip_limited', retryAfterSeconds: window.retryAfterSeconds }
    }
    const pair = await recordPairAttempt(address, login)
    if (!pair.allowed) {
      logSecurityEvent('login_wait', { ip: address })
      return { ok: false, reason: 'wait', retryAfterSeconds: pair.retryAfterSeconds }
    }

    const record = await findLoginRecord(login)
    userId = record?.userId ?? null
    // Счётчик логина ведётся только у существующего логина с неопубликованным паролем: выдуманные логины его не растят.
    const streak = record && !record.passwordPublished ? await recordLoginStreak(login) : 0
    const closed = streak > LOGIN_CLOSE_AFTER

    const stored = record?.passwordHash ?? (await dummyHash)
    const matches = await hashGate.run(() => verifyPassword(password, stored))
    if (!record || !matches || closed) {
      if (record && !matches && streak === LOGIN_CLOSE_AFTER) logSecurityEvent('login_closed', { userId, ip: address })
      logSecurityEvent('login_failed', { userId, ip: address })
      return INVALID
    }
    const session = await createSession(record.userId, address)
    await clearLoginCounters(address, login)
    return { ok: true, token: session.token, expiresAt: session.expiresAt }
  } catch (error) {
    if (error instanceof BusyError) {
      logSecurityEvent('login_busy', { userId, ip: address })
      return { ok: false, reason: 'busy' }
    }
    throw error
  }
}
