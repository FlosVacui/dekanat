// Применение миграций и выдача прав роли приложения. Общий код для команды db:migrate и для тестов.
// Скрипты в app/db/ — исключение из правил «база только в слое» и «process.env только в config.ts»
// (ADR-0002, ADR-0004): они не часть работающего приложения.
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url))

/**
 * Права роли приложения: читает всё, пишет только то, что приложению нужно (ADR-0002).
 * Удалять приложение может только сессии и счётчики входа. Прав владельца и суперпользователя у роли нет.
 */
const GRANTS = [
  'GRANT USAGE ON SCHEMA public TO {role}',
  'GRANT SELECT ON ALL TABLES IN SCHEMA public TO {role}',
  'GRANT INSERT, DELETE ON sessions TO {role}',
  'GRANT INSERT, UPDATE ON requests TO {role}',
  'GRANT INSERT ON request_events TO {role}',
  'GRANT INSERT, UPDATE ON notifications TO {role}',
  'GRANT INSERT ON announcement_reads TO {role}',
  // Вопросы в деканат (пакет 4.1): студент создаёт вопрос, сотрудник отвечает. Удаляет вопросы посетителей только освежение под владельцем.
  'GRANT INSERT, UPDATE ON questions TO {role}',
  // Счётчики входа (пакет 3.1): приложение пишет в них одной атомарной операцией и чистит строки по давности.
  'GRANT INSERT, UPDATE, DELETE ON login_attempts, login_ip_windows, login_streaks TO {role}',
  // Фото профиля (блиц 20.11): студент загружает, меняет и удаляет своё фото.
  'GRANT INSERT, UPDATE, DELETE ON user_avatars TO {role}',
  // Объявления (блиц 20.11): сотрудник пишет объявление своей группе или потоку.
  'GRANT INSERT ON announcements TO {role}',
]

export function roleFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).username)
}

export async function runMigrations(ownerUrl: string, appRole: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(appRole)) throw new Error('Недопустимое имя роли приложения')
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })
    for (const statement of GRANTS) {
      await pool.query(statement.replace('{role}', `"${appRole}"`))
    }
  } finally {
    await pool.end()
  }
}
