import 'server-only'

// Единственное место приложения с process.env (ADR-0004).
// Скрипты в app/db/ и vitest.config.ts читают свои переменные сами: это не часть работающего приложения.
// Значения читаются лениво: сборка (next build) не должна падать без окружения.

export interface AppConfig {
  /** Строка подключения роли приложения (не суперпользователь, не владелец). */
  databaseUrl: string
  /** Размер пула соединений. */
  dbPoolMax: number
  /** Имя заголовка, в котором обратный прокси передаёт адрес посетителя; пусто — заголовка нет. */
  clientIpHeader: string
  /** Часовой пояс вуза: от него зависят «сегодня» и сроки. */
  timezone: string
}

let cached: AppConfig | undefined

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    // В сообщении только имя переменной, значений нет.
    throw new Error(`Не задана переменная окружения ${name}. Образец — .env.example.`)
  }
  return value
}

export function getConfig(): AppConfig {
  if (cached) return cached
  const poolMax = Number.parseInt(process.env.DB_POOL_MAX ?? '10', 10)
  cached = {
    databaseUrl: required('DATABASE_URL'),
    dbPoolMax: Number.isFinite(poolMax) && poolMax > 0 && poolMax <= 50 ? poolMax : 10,
    clientIpHeader: (process.env.CLIENT_IP_HEADER ?? '').trim().toLowerCase(),
    timezone: process.env.APP_TIMEZONE?.trim() || 'Europe/Moscow',
  }
  return cached
}
