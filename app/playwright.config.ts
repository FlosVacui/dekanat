import { defineConfig } from '@playwright/test'

// Сквозной тест М0 на экране 360×800 (ADR-0005). Сервер приложения тест поднимает сам: между шагами 7 и 8 его надо
// перезапустить, поэтому встроенный webServer Playwright не подходит. Перед прогоном: npm run build и npm run db:seed.
const port = Number(process.env.E2E_PORT ?? 3100)

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium-360x800', use: { browserName: 'chromium' } }],
})
