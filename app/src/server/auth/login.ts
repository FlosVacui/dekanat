import 'server-only'
import { findLoginRecord } from '../dal/auth'
import { BusyError, hashGate } from './gate'
import { MAX_PASSWORD_LENGTH, hashPassword, verifyPassword } from './password'
import { createSession } from './session'

// Вход (ADR-0003). Здесь только часть пакета 2.4: хеш, сессия, одинаковый ответ на «нет логина» и «неверный пароль».
// Счётчики перебора, лимиты по адресу, одинаковое время ответа и пределы сессий — пакет 3.1.

const MAX_LOGIN_LENGTH = 128

/** Логин приводится к одному виду одной функцией: пробелы по краям срезаны, буквы строчные. */
export function normalizeLogin(raw: string): string {
  return raw.trim().toLowerCase()
}

export type LoginOutcome =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'busy' }

let dummyHash: Promise<string> | undefined

/** Для несуществующего логина хеш всё равно считается: время ответа не выдаёт, есть ли такой логин. */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('нет-такого-пользователя')
  return dummyHash
}

export async function authenticate(rawLogin: string, password: string, ip: string): Promise<LoginOutcome> {
  const login = normalizeLogin(rawLogin)
  if (!login || login.length > MAX_LOGIN_LENGTH || !password || password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: 'invalid' }
  }
  try {
    const record = await findLoginRecord(login)
    const stored = record?.passwordHash ?? (await getDummyHash())
    const matches = await hashGate.run(() => verifyPassword(password, stored))
    if (!record || !matches) return { ok: false, reason: 'invalid' }
    const session = await createSession(record.userId, ip)
    return { ok: true, token: session.token, expiresAt: session.expiresAt }
  } catch (error) {
    if (error instanceof BusyError) return { ok: false, reason: 'busy' }
    throw error
  }
}
