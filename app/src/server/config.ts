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
  /** Секрет подписи кода проверки справки; пусто — «Получить сразу» и проверка справок выключены. */
  certificateSecret: string
  /** Панель «Сценарий для жюри». По умолчанию включена; JURY_MODE=off выключает (e2e). */
  juryMode: boolean
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
    // Не обязателен для остального приложения: нужен только функциям справки с QR. Короче 16 знаков — как пусто.
    certificateSecret: (process.env.CERTIFICATE_SECRET ?? '').trim().length >= 16 ? (process.env.CERTIFICATE_SECRET ?? '').trim() : '',
    juryMode: (process.env.JURY_MODE ?? 'on').trim().toLowerCase() !== 'off',
  }
  return cached
}

// 19.11, ИИ-функции: OpenAI-совместимый API (Yandex AI Studio, Cloud.ru). Читается при каждом вызове и не кэшируется:
// ключа может не быть, и тогда функции идут по запасному пути, а DATABASE_URL для этого не нужен.
export interface AiConfig {
  /** Корень API вместе с `/v1`, без `/chat/completions`. */
  baseUrl: string
  /** Ключ сервиса. Только сервер; в ответы, журнал и браузер не попадает. */
  apiKey: string
  /** Имя модели в формате провайдера. */
  model: string
  /** Каталог Yandex Cloud: уходит заголовком `OpenAI-Project`. Пусто — заголовка нет. */
  folderId: string
}

/** Адрес принимается, только если это https (или http на своём компьютере для проверки); иначе пусто — ИИ выключен. */
function aiBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '')
  return /^https:\/\/[^\s/]+/i.test(value) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(value) ? value : ''
}

export function getAiConfig(): AiConfig {
  return {
    baseUrl: aiBaseUrl(process.env.AI_BASE_URL),
    apiKey: (process.env.AI_API_KEY ?? '').trim(),
    model: (process.env.AI_MODEL ?? '').trim(),
    folderId: (process.env.AI_FOLDER_ID ?? '').trim(),
  }
}
