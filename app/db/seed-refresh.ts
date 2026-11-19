// Команда: npm run db:refresh. «Освежить»: переносит вымышленный набор на сегодняшний день — пары, изменения, сроки,
// экзамены, объявления, уведомления и заявки набора. Заявки и уведомления, которые создало приложение, не удаляются и не
// меняются; счётчики входа и пароли не трогаются; повторный запуск в тот же день ничего не меняет.
// Безопасна на сервере с посетителями. На сервере её раз в ночь запускает таймер.
// Только сдвигает даты и ничего не удаляет, кроме вопросов посетителей и уведомлений об ответах на них (вопросы студентов
// набора, которых нет в наборе данных, уходят вместе с ответами). Сменился состав набора в коде (другие группы, заявки, уведомления) — один раз
// нужен `db:seed`: он стирает заявки основного набора, а прежние заявки и уведомления набора `db:refresh` не убирает
// (их ключи не входят в новый набор). Порядок на сервере: сначала `db:seed`, потом таймер.
// Резервные наборы освежаются тоже, если они есть в базе и заданы их переменные окружения. Резерв, который есть в базе,
// но чьих переменных нет, пропускается с сообщением: набор и причина, без значений переменных.
import pg from 'pg'
import { todayIn } from '../src/lib/dates'
import { MAIN_COHORT } from './seed-data'
import { seedCohort } from './seed-lib'
import { describeSkippedReserves, refreshReservesReport } from './seed-reserve-lib'

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
  const reserves = await refreshReservesReport(client, process.env, today, timezone)
  const tail = reserves.refreshed.length > 0 ? ` Резервы освежены: ${reserves.refreshed.join(', ')}.` : ''
  console.log(`Основной набор освежён (дата отсчёта расписания: ${today}). Заявки и счётчики входа не тронуты.${tail}`)
  for (const line of describeSkippedReserves(reserves.skipped)) console.warn(line)
} finally {
  await client.end()
}
