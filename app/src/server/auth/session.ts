import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import {
  deleteSessionByTokenHash,
  findActorRowByTokenHash,
  insertSession,
  type ActorRow,
} from '../dal/auth'

// Модуль сессий: единственное место, где создаётся действующее лицо (ADR-0002, правило 2).
// Токен случаен, в базе лежит только его хеш SHA-256 (ADR-0003).

/** Срок сессии — 7 суток от входа, без продления (ADR-0003). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Метка: объект действующего лица нельзя собрать руками, не зная её. Метка не экспортируется. */
const MINT: unique symbol = Symbol('actor-mint')

/**
 * Тот, кто спрашивает. Первый аргумент каждой функции слоя доступа.
 * Класс с закрытым полем: сверка по форме не пройдёт, а конструктор без метки бросает ошибку.
 * Приведение `as` к этому типу и создание метки вне этого файла запрещены.
 */
export class Actor {
  readonly #sealed = true
  readonly userId: string
  readonly role: 'student' | 'staff'
  /** Набор тестовых аккаунтов: граница области сотрудника. */
  readonly cohort: string
  /** Группа из профиля студента; у сотрудника её нет. */
  readonly groupId: string | null

  constructor(mint: typeof MINT, row: ActorRow) {
    if (mint !== MINT || !this.#sealed) throw new Error('Actor создаёт только модуль сессий')
    this.userId = row.userId
    this.role = row.role === 'staff' ? 'staff' : 'student'
    this.cohort = row.cohort
    this.groupId = row.role === 'student' ? row.groupId : null
    Object.freeze(this)
  }
}

/** Проверка на лету: объект с теми же полями, собранный руками, не пройдёт. */
export function isActor(value: unknown): value is Actor {
  return value instanceof Actor
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface CreatedSession {
  token: string
  expiresAt: Date
}

/** После верного пароля: случайный токен — 32 байта; в базу идёт только его хеш. */
export async function createSession(userId: string, ip: string): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await insertSession({ tokenHash: hashToken(token), userId, expiresAt, ip })
  return { token, expiresAt }
}

/** Токен из куки -> действующее лицо. Просроченная или неизвестная сессия — null. */
export async function resolveActor(token: string | undefined): Promise<Actor | null> {
  if (!token || token.length > 128) return null
  const row = await findActorRowByTokenHash(hashToken(token))
  if (!row) return null
  return new Actor(MINT, row)
}

/** Выход: строка сессии удаляется на сервере. */
export async function destroySession(token: string | undefined): Promise<void> {
  if (!token || token.length > 128) return
  await deleteSessionByTokenHash(hashToken(token))
}
