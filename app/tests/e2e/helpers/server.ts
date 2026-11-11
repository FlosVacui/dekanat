// Запуск и остановка сервера приложения для сквозного теста и снимков. Сервер — собранное приложение: npm run build.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const PORT = Number(process.env.E2E_PORT ?? 3100)
export const BASE_URL = `http://localhost:${PORT}`
const APP_DIR = fileURLToPath(new URL('../../../', import.meta.url))

export interface RunningServer {
  child: ChildProcess
  pid: number
}

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/login`, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
    return res.status < 500
  } catch {
    return false
  }
}

async function waitFor(predicate: () => Promise<boolean>, what: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Не дождались: ${what}`)
}

/** Запускает `next start` с файлом окружения из корня репозитория (scripts/with-env.mjs). Порт должен быть свободен. */
export async function startServer(): Promise<RunningServer> {
  if (await isUp()) throw new Error(`Порт ${PORT} уже занят работающим сервером. Остановите его или задайте E2E_PORT`)
  const child = spawn(
    process.execPath,
    ['scripts/with-env.mjs', './node_modules/next/dist/bin/next', 'start', '-p', String(PORT)],
    { cwd: APP_DIR, stdio: 'ignore', windowsHide: true },
  )
  if (!child.pid) throw new Error('Сервер не запустился')
  const pid = child.pid
  let exited = false
  child.on('exit', () => {
    exited = true
  })
  await waitFor(async () => {
    if (exited) throw new Error('Сервер приложения завершился сам. Собрано ли приложение: npm run build?')
    return isUp()
  }, 'ответа сервера', 90_000)
  return { child, pid }
}

/** Останавливает сервер вместе с дочерними процессами и ждёт, пока порт освободится. */
export async function stopServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode === null) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {
        // процесс уже завершился
      }
    } else {
      server.child.kill('SIGTERM')
    }
  }
  await waitFor(async () => !(await isUp()), 'остановки сервера', 30_000)
}
