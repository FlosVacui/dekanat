import 'server-only'
import { and, eq, gt, sql } from 'drizzle-orm'
import { getDb } from './client'
import { sessions, students, users } from './schema'

// Запросы входа и сессий (ADR-0002, правило 1: запросы сессий лежат в слое).

export interface LoginRecord {
  userId: string
  passwordHash: string
}

/**
 * Единственная функция слоя, отдающая хеш пароля: он нужен модулю входа для проверки.
 * Дальше модуля входа хеш не идёт. Логин приходит уже приведённым к одному виду.
 */
export async function findLoginRecord(normalizedLogin: string): Promise<LoginRecord | null> {
  const rows = await getDb()
    .select({ userId: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.login, normalizedLogin))
    .limit(1)
  return rows[0] ?? null
}

export interface ActorRow {
  userId: string
  role: string
  cohort: string
  groupId: string | null
}

export async function insertSession(input: {
  tokenHash: string
  userId: string
  expiresAt: Date
  ip: string
}): Promise<void> {
  await getDb().insert(sessions).values({
    tokenHash: input.tokenHash,
    userId: input.userId,
    expiresAt: input.expiresAt,
    ip: input.ip.slice(0, 64),
  })
}

/** Живая сессия по хешу токена: просроченная не находится. */
export async function findActorRowByTokenHash(tokenHash: string): Promise<ActorRow | null> {
  const rows = await getDb()
    .select({
      userId: users.id,
      role: users.role,
      cohort: users.cohort,
      groupId: students.groupId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(students, eq(students.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, sql`now()`)))
    .limit(1)
  return rows[0] ?? null
}

export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.tokenHash, tokenHash))
}
