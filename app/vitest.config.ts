import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Файл окружения подаётся явно: node --env-file=../.env (см. npm run test).
// Тесты слоя доступа идут на отдельной тестовой базе: приложение получает её адрес вместо рабочего.
const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  'server-only': fileURLToPath(new URL('./tests/unit/server-only-stub.ts', import.meta.url)),
}

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    globalSetup: ['tests/unit/global-setup.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
    },
  },
})
