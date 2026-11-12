// Подготовка состояния для сквозных тестов и снимков запросом к базе под владельцем (только вымышленные данные).
// Playwright и tsx запускаются без файла окружения, поэтому, если адреса базы в окружении нет, он читается из `.env`
// в корне репозитория тем же способом, что в scripts/with-env.mjs (значения не печатаются).
import { fileURLToPath } from 'node:url'
import pg from 'pg'

function ownerUrl(): string {
  if (!process.env.DATABASE_OWNER_URL) {
    const file = process.env.ENV_FILE || fileURLToPath(new URL('../../../../.env', import.meta.url))
    try {
      process.loadEnvFile(file)
    } catch {
      throw new Error('Нет DATABASE_OWNER_URL и не удалось прочитать файл окружения: npm run db:setup создаёт .env')
    }
  }
  const url = process.env.DATABASE_OWNER_URL
  if (!url) throw new Error('Нет DATABASE_OWNER_URL')
  return url
}

/**
 * Пара «адрес и логин» ждёт ещё `seconds` секунд при `fails` неверных. Тест не надеется, что шаги уложатся в секунду
 * после пятой попытки: метка ожидания выставляется запросом (R-3.1-2). Строка пары должна уже существовать.
 */
export async function holdPair(ip: string, login: string, seconds = 30, fails = 5): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl() })
  await client.connect()
  try {
    const res = await client.query(
      `update login_attempts set fails = $3, next_allowed_at = clock_timestamp() + $4 * interval '1 second', last_attempt_at = clock_timestamp()
       where ip = $1 and login = $2`,
      [ip, login, fails, seconds],
    )
    if (res.rowCount !== 1) throw new Error('holdPair: строки пары нет — сначала нужна хотя бы одна попытка входа')
  } finally {
    await client.end()
  }
}
