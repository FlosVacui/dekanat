// Команда: npm run db:migrate. Применяет миграции под ролью владельца базы.
import { roleFromUrl, runMigrations } from './migrate-lib'

const ownerUrl = process.env.DATABASE_OWNER_URL
const appUrl = process.env.DATABASE_URL
if (!ownerUrl || !appUrl) {
  console.error('Нужны переменные DATABASE_OWNER_URL и DATABASE_URL: npm run db:setup создаёт .env.')
  process.exit(1)
}
await runMigrations(ownerUrl, roleFromUrl(appUrl))
console.log('Миграции применены, права роли приложения выданы.')
