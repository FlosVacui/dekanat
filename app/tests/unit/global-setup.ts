// Перед всеми модульными тестами: тестовая база приводится к известному состоянию.
// Работает только на базе, имя которой заканчивается на `_test`: рабочую базу тест не тронет.
import pg from 'pg'
import { roleFromUrl, runMigrations } from '../../db/migrate-lib'
import { MAIN_COHORT } from '../../db/seed-data'
import { seedCohort } from '../../db/seed-lib'
import { todayIn } from '../../src/lib/dates'
import { ALT_COHORT } from './fixtures'

const TABLES = [
  'announcement_reads',
  'announcements',
  'notifications',
  'request_events',
  'requests',
  'grades',
  'assignments',
  'disciplines',
  'lesson_changes',
  'lessons',
  'sessions',
  'students',
  'groups',
  'users',
]

export default async function setup(): Promise<void> {
  const ownerUrl = process.env.TEST_DATABASE_OWNER_URL
  const appUrl = process.env.TEST_DATABASE_URL
  if (!ownerUrl || !appUrl) {
    throw new Error('Нужны TEST_DATABASE_OWNER_URL и TEST_DATABASE_URL. Создайте окружение: npm run db:setup')
  }
  const dbName = new URL(ownerUrl).pathname.replace(/^\//, '')
  if (!dbName.endsWith('_test')) {
    throw new Error('Тесты идут только на базе с именем на _test: рабочую базу они очищали бы.')
  }

  await runMigrations(ownerUrl, roleFromUrl(appUrl))

  const client = new pg.Client({ connectionString: ownerUrl })
  await client.connect()
  try {
    await client.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`)
    const today = todayIn('Europe/Moscow')
    await seedCohort(client, MAIN_COHORT, today)
    // Второй набор — только в тестах: им проверяется граница области сотрудника.
    await seedCohort(client, ALT_COHORT, today)
  } finally {
    await client.end()
  }
}
