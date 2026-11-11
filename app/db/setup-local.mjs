// Подготовка локальной базы: роли, базы, файл окружения. Запускается один раз: npm run db:setup.
//
// Что делает:
//   1. Входит в локальный PostgreSQL как суперпользователь (без пароля, только с этой машины).
//   2. Создаёт роль владельца базы (миграции, вымышленные данные) и роль приложения (без прав
//      суперпользователя) со случайными паролями.
//   3. Создаёт две базы: рабочую и тестовую. Тестовая нужна модульным тестам слоя доступа.
//   4. Если файла окружения в корне репозитория нет — создаёт его. Значения на экран не печатаются.
//      Если файл есть — берёт из него пароли, чтобы роли и файл не разошлись, и ничего не перезаписывает.
//
// Скрипт — исключение из правила «process.env только в config.ts»: он не часть работающего приложения (ADR-0004).
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url))
const HOST = process.env.PGHOST || '127.0.0.1'
const PORT = Number(process.env.PGPORT || 5432)
const SUPERUSER = process.env.PGSUPERUSER || 'postgres'

const OWNER_ROLE = 'dekanat_owner'
const APP_ROLE = 'dekanat_app'
const DATABASES = ['dekanat', 'dekanat_test']

function readExistingEnv() {
  if (!existsSync(ENV_FILE)) return null
  const result = {}
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (match) result[match[1]] = match[2]
  }
  return result
}

function randomPassword() {
  // 24 байта = 192 бита; base64url не содержит символов, которые надо экранировать в адресе подключения.
  return randomBytes(24).toString('base64url')
}

async function connect(database) {
  const client = new pg.Client({ host: HOST, port: PORT, user: SUPERUSER, database })
  await client.connect()
  return client
}

const existing = readExistingEnv()
const ownerPassword = existing?.POSTGRES_OWNER_PASSWORD || randomPassword()
const appPassword = existing?.POSTGRES_APP_PASSWORD || randomPassword()

const admin = await connect('postgres')
try {
  for (const [role, password] of [
    [OWNER_ROLE, ownerPassword],
    [APP_ROLE, appPassword],
  ]) {
    const found = await admin.query('select 1 from pg_roles where rolname = $1', [role])
    const literal = admin.escapeLiteral(password)
    // NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS: у роли приложения нет ничего лишнего (ADR-0002).
    const attrs = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
    if (found.rowCount === 0) {
      await admin.query(`CREATE ROLE ${role} ${attrs} PASSWORD ${literal}`)
    } else {
      await admin.query(`ALTER ROLE ${role} ${attrs} PASSWORD ${literal}`)
    }
  }

  for (const database of DATABASES) {
    const found = await admin.query('select 1 from pg_database where datname = $1', [database])
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${database} OWNER ${OWNER_ROLE}`)
    }
    await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`)
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${APP_ROLE}`)
  }
} finally {
  await admin.end()
}

for (const database of DATABASES) {
  const client = await connect(database)
  try {
    await client.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`)
    await client.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`)
  } finally {
    await client.end()
  }
}

if (existing) {
  console.log('Файл окружения уже есть: оставлен без изменений. Роли и базы приведены в порядок.')
} else {
  const url = (role, password, database) => `postgresql://${role}:${password}@${HOST}:${PORT}/${database}`
  const lines = [
    '# Локальное окружение. Создано скриптом db:setup. В git не попадает. Значения ничего не открывают, кроме локальной базы.',
    `DATABASE_URL=${url(APP_ROLE, appPassword, 'dekanat')}`,
    `DATABASE_OWNER_URL=${url(OWNER_ROLE, ownerPassword, 'dekanat')}`,
    `TEST_DATABASE_URL=${url(APP_ROLE, appPassword, 'dekanat_test')}`,
    `TEST_DATABASE_OWNER_URL=${url(OWNER_ROLE, ownerPassword, 'dekanat_test')}`,
    `POSTGRES_OWNER_PASSWORD=${ownerPassword}`,
    `POSTGRES_APP_PASSWORD=${appPassword}`,
    'CLIENT_IP_HEADER=',
    'APP_TIMEZONE=Europe/Moscow',
    'NEXT_TELEMETRY_DISABLED=1',
    '',
  ]
  writeFileSync(ENV_FILE, lines.join('\n'), { flag: 'wx', mode: 0o600 })
  console.log('Создан файл .env в корне репозитория. Значения не печатаются.')
}
console.log(`Роли: ${OWNER_ROLE}, ${APP_ROLE}. Базы: ${DATABASES.join(', ')}.`)
console.log('Дальше: npm run db:migrate, затем npm run db:seed.')
