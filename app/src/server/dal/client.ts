import 'server-only'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getConfig } from '../config'

// Единственное место, где создаётся клиент базы (ADR-0002, правило 1). Соединение идёт под ролью приложения.

type Db = NodePgDatabase

const holder = globalThis as typeof globalThis & { __dekanatPool?: pg.Pool; __dekanatDb?: Db }

export function getDb(): Db {
  if (!holder.__dekanatDb) {
    const config = getConfig()
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      // Запрос не должен висеть дольше десяти секунд.
      statement_timeout: 10_000,
      idleTimeoutMillis: 30_000,
    })
    // Ошибка простаивающего соединения не должна ронять процесс; текст ошибки наружу не идёт.
    pool.on('error', () => {})
    holder.__dekanatPool = pool
    holder.__dekanatDb = drizzle(pool)
  }
  return holder.__dekanatDb
}

/** Закрыть пул: для тестов и корректной остановки. */
export async function closeDb(): Promise<void> {
  const pool = holder.__dekanatPool
  holder.__dekanatPool = undefined
  holder.__dekanatDb = undefined
  if (pool) await pool.end()
}
