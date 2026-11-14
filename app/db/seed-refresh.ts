// Команда: npm run db:refresh. «Освежить»: переносит вымышленный набор на сегодняшний день — пары, изменения, сроки,
// экзамены, объявления, уведомления и заявки набора. Заявки и уведомления, которые создало приложение, не удаляются и не
// меняются; счётчики входа и пароли не трогаются; повторный запуск в тот же день ничего не меняет.
// Безопасна на сервере с посетителями. На сервере её раз в ночь запускает таймер.
// Резервные наборы освежаются тоже, если они есть в базе и заданы их переменные окружения (иначе пропускаются).
import pg from 'pg'
import { todayIn } from '../src/lib/dates'
import { MAIN_COHORT } from './seed-data'
import { seedCohort } from './seed-lib'
import { refreshReserves } from './seed-reserve-lib'

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
  await seedCohort(client, MAIN_COHORT, today, { mode: 'refresh', timezone })
  const reserves = await refreshReserves(client, process.env, today, timezone)
  const tail = reserves.length > 0 ? ` Резервы освежены: ${reserves.join(', ')}.` : ''
  console.log(`Основной набор освежён (дата отсчёта расписания: ${today}). Заявки и счётчики входа не тронуты.${tail}`)
} finally {
  await client.end()
}
