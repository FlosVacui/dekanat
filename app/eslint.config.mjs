import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**']),
  {
    // ADR-0002, ADR-0004: клиент базы и process.env — только где разрешено.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/dal/**', 'src/server/config.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pg', message: 'Клиент базы — только в src/server/dal/ (ADR-0002).' },
            { name: 'drizzle-orm', message: 'Запросы — только в src/server/dal/ (ADR-0002).' },
          ],
          patterns: [{ group: ['drizzle-orm/*', 'pg/*'], message: 'Запросы — только в src/server/dal/ (ADR-0002).' }],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'process.env читается только в src/server/config.ts (ADR-0004).' },
      ],
    },
  },
])
