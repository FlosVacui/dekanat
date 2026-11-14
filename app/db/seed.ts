// Команда: npm run db:seed. Заводит основной набор вымышленных данных под ролью владельца базы.
// Можно запускать повторно: строки обновляются, а заявки, история статусов и уведомления основного набора,
// которых нет в вымышленных данных, удаляются; пары, группы и объявления прежнего набора убираются. Данные других наборов не трогаются.
// Счётчики перебора входа обнуляются целиком.
// Не запускать на базе с настоящими посетителями: их заявки основного набора будут стёрты. Для такой базы — npm run db:refresh.
import pg from 'pg'
import { todayIn } from '../src/lib/dates'
import { MAIN_COHORT } from './seed-data'
import { seedCohort } from './seed-lib'

const ownerUrl = process.env.DATABASE_OWNER_URL
if (!ownerUrl) {
  console.error('Нужна переменная DATABASE_OWNER_URL: npm run db:setup создаёт .env.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: ownerUrl })
await client.connect()
try {
  const timezone = process.env.APP_TIMEZONE || 'Europe/Moscow'
  const today = todayIn(timezone)
  await seedCohort(client, MAIN_COHORT, today, { mode: 'full', timezone })
  console.log(`Основной набор обновлён (дата отсчёта расписания: ${today}). Логины: ${MAIN_COHORT.students.map((s) => s.login).join(', ')}, ${MAIN_COHORT.staff.login}.`)
} finally {
  await client.end()
}
