// Конфигурация drizzle-kit: только создание файлов миграций из схемы. К базе не подключается.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/dal/schema.ts',
  out: './db/migrations',
})
