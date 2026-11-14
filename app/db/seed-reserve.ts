// Команда: npm run db:seed:reserve [-- 1|2]. Заводит резервные наборы для жюри (без аргумента — оба).
// Логины и пароли берутся только из переменных окружения (имена — в .env.example). Нет переменной или пароль короче 20 знаков —
// команда отказывает, и в базу ничего не пишется. Логины и пароли команда не печатает.
// Счётчики входа не сбрасываются, основной набор не трогается (IMP-019, п. 2).
import pg from 'pg'
import { todayIn } from '../src/lib/dates'
import { ReserveConfigError, readReserveSets, seedReserves, RESERVES } from './seed-reserve-lib'

const ownerUrl = process.env.DATABASE_OWNER_URL
if (!ownerUrl) {
  console.error('Нужна переменная DATABASE_OWNER_URL: npm run db:setup создаёт .env.')
  process.exit(1)
}

const numbers = process.argv.slice(2).length > 0 ? process.argv.slice(2).map(Number) : RESERVES.map((r) => r.n)

let sets: ReturnType<typeof readReserveSets>
try {
  sets = readReserveSets(process.env, numbers)
} catch (error) {
  if (error instanceof ReserveConfigError) {
    console.error(`${error.message}\nВ базу ничего не записано. Имена переменных — в .env.example.`)
    process.exit(1)
  }
  throw error
}

const client = new pg.Client({ connectionString: ownerUrl })
await client.connect()
try {
  const timezone = process.env.APP_TIMEZONE || 'Europe/Moscow'
  await seedReserves(client, sets, todayIn(timezone), timezone)
  console.log(`Резервные наборы записаны: ${sets.map((s) => s.def.n).join(', ')}. Логины и пароли не печатаются.`)
} finally {
  await client.end()
}
