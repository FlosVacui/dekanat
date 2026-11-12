import 'server-only'
import { and, eq, gt, sql } from 'drizzle-orm'
import { getDb } from './client'
import { sessions, students, users } from './schema'

// Запросы входа и сессий (ADR-0002, правило 1: запросы сессий лежат в слое).

export interface LoginRecord {
  userId: string
  passwordHash: string
  /** Опубликован ли пароль: у логина с неопубликованным паролем есть счётчик «100 неверных подряд». */
  passwordPublished: boolean
}

/**
 * Единственная функция слоя, отдающая хеш пароля: он нужен модулю входа для проверки.
 * Дальше модуля входа хеш не идёт. Логин приходит уже приведённым к одному виду.
 */
export async function findLoginRecord(normalizedLogin: string): Promise<LoginRecord | null> {
  const rows = await getDb()
    .select({ userId: users.id, passwordHash: users.passwordHash, passwordPublished: users.passwordPublished })
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

/** Пределы живых сессий (ADR-0003, «Сессия»): на пару «аккаунт и адрес» и на аккаунт. Числа — выбор проекта. */
export const MAX_SESSIONS_PER_PAIR = 10
export const MAX_SESSIONS_PER_ACCOUNT = 300

/**
 * Новая сессия вместе с пределами — одна транзакция. Перед вставкой гасятся просроченные сессии аккаунта; если живых
 * на пару «аккаунт и адрес» уже десять, гасится самая старая сессия пары; если на аккаунт уже 300 — самая старая
 * сессия аккаунта. Замок на аккаунт не даёт залпу входов пройти пределы вместе.
 */
export async function insertSession(input: {
  tokenHash: string
  userId: string
  expiresAt: Date
  ip: string
}): Promise<void> {
  const ip = input.ip.slice(0, 64)
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`sessions:${input.userId}`}, 0))`)
    await tx.execute(sql`delete from sessions where user_id = ${input.userId} and expires_at <= now()`)
    // Остаются самые новые на один меньше предела: вместе с новой сессией выйдет ровно предел.
    await tx.execute(sql`
      delete from sessions where id in (
        select id from sessions where user_id = ${input.userId} and ip = ${ip}
        order by created_at desc, id offset ${MAX_SESSIONS_PER_PAIR - 1})
    `)
    await tx.execute(sql`
      delete from sessions where id in (
        select id from sessions where user_id = ${input.userId}
        order by created_at desc, id offset ${MAX_SESSIONS_PER_ACCOUNT - 1})
    `)
    await tx.insert(sessions).values({ tokenHash: input.tokenHash, userId: input.userId, expiresAt: input.expiresAt, ip })
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
