// Запуск программы Node.js с файлом окружения из корня репозитория: node scripts/with-env.mjs <программа.js> [аргументы].
// Файл подаётся явно (ADR-0004). Ключ `node --env-file` Next.js не принимает: он передаёт его рабочим процессам
// через NODE_OPTIONS, где такой ключ запрещён. Поэтому файл читается здесь, а переменные уходят в окружение дочернего процесса.
// Значения не печатаются. Скрипт — не часть работающего приложения: исключение из правила «process.env только в config.ts».
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const envFile = process.env.ENV_FILE || fileURLToPath(new URL('../../.env', import.meta.url))
if (!existsSync(envFile)) {
  console.error('Нет файла окружения в корне репозитория. Создайте его командой: npm run db:setup')
  process.exit(1)
}
process.loadEnvFile(envFile)

const [program, ...args] = process.argv.slice(2)
if (!program) {
  console.error('Использование: node scripts/with-env.mjs <программа.js> [аргументы]')
  process.exit(1)
}
const child = spawn(process.execPath, [program, ...args], { stdio: 'inherit', env: process.env })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
