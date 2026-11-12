import pg from 'pg'
import { authenticate } from '@/server/auth/login'
import { resolveActor, type Actor } from '@/server/auth/session'

/** Вход настоящим путём: пароль, хеш, сессия в базе, действующее лицо из сессии. Другого способа получить Actor нет. */
export async function actorFor(account: { login: string; password: string }): Promise<Actor> {
  const outcome = await authenticate(account.login, account.password, 'test')
  if (!outcome.ok) throw new Error(`Вход под ${account.login} не удался: ${outcome.reason}`)
  const actor = await resolveActor(outcome.token)
  if (!actor) throw new Error('Сессия не нашлась')
  return actor
}

/** Подключение владельца базы для проверок «что лежит в таблицах». Только в тестах. */
export async function withOwner<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = process.env.TEST_DATABASE_OWNER_URL
  if (!url) throw new Error('Нет TEST_DATABASE_OWNER_URL')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}
