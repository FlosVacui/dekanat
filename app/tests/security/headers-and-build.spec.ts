// Атакующие тесты пакета 2.6: заголовки ответов (З-02, З-03, З-05, З-06) и секреты в том, что получает браузер (С-03).
// Локально, на собранном приложении. Тест сам поднимает и гасит сервер на порту 3100.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { startServer, stopServer, type RunningServer } from '../e2e/helpers/server'
import { A, login, raw, rawRsc, requestIdWithMarker, type Session } from './helpers'

test.describe.configure({ mode: 'serial' })

const NEXT_DIR = fileURLToPath(new URL('../../.next/', import.meta.url))

let server: RunningServer | null = null
let a: Session
let ownRequestId = ''

test.beforeAll(async ({ browser }) => {
  server = await startServer()
  a = await login(browser, A)
  ownRequestId = await requestIdWithMarker(a.token, A.markers.requests)
})

test.afterAll(async () => {
  await a?.context.close()
  if (server) await stopServer(server)
  server = null
})

/** Страницы для проверки заголовков: вход, главная, личная страница, страница записи. */
function samples(): { path: string; token?: string }[] {
  return [
    { path: '/login' },
    { path: '/', token: a.token },
    { path: '/profile', token: a.token },
    { path: `/requests/${ownRequestId}`, token: a.token },
  ]
}

test('контроль: стенд жив, вход под А работает', async () => {
  const res = await raw('/profile', { token: a.token })
  expect(res.status).toBe(200)
  expect(res.text).toContain(A.markers.profile)
  // Запрос RSC отдаёт настоящие данные страницы: иначе проверка С-03 по RSC была бы пустой.
  expect((await rawRsc('/profile', a.token)).text).toContain(A.markers.profile)
})

test('R-2.6-1 З-02: заголовки защиты на каждой странице — nosniff, Referrer-Policy, Permissions-Policy, CSP', async () => {
  for (const { path, token } of samples()) {
    const res = await raw(path, { token })
    const h = res.headers
    expect(h.get('x-content-type-options'), `${path}: X-Content-Type-Options`).toBe('nosniff')
    expect(h.get('referrer-policy'), `${path}: Referrer-Policy`).toBeTruthy()
    expect(h.get('permissions-policy'), `${path}: Permissions-Policy`).toBeTruthy()
    const csp = h.get('content-security-policy') ?? ''
    expect(csp, `${path}: CSP frame-ancestors`).toMatch(/frame-ancestors\s+('none'|'self')/)
    expect(csp, `${path}: CSP object-src`).toContain("object-src 'none'")
    expect(csp, `${path}: CSP base-uri`).toContain("base-uri 'self'")
    expect(csp, `${path}: CSP без unsafe-eval`).not.toContain('unsafe-eval')
  }
})

test('З-03: версия сервера не раскрывается', async () => {
  for (const { path, token } of samples()) {
    const res = await raw(path, { token })
    expect(res.headers.get('x-powered-by'), path).toBeNull()
    expect(res.headers.get('server') ?? '', path).not.toMatch(/\d/)
  }
})

test('З-05: CORS — чужой сайт не получает разрешения читать ответы', async () => {
  for (const { path, token } of samples()) {
    for (const method of ['GET', 'OPTIONS']) {
      const res = await raw(path, {
        token,
        method,
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
      })
      const allow = res.headers.get('access-control-allow-origin')
      expect(allow === '*' || allow === 'https://evil.example', `${method} ${path}: ACAO ${allow}`).toBe(false)
    }
  }
})

test('З-06: личные ответы не кэшируются публично', async () => {
  for (const path of ['/', '/profile', '/schedule', '/grades', '/notifications', '/requests', `/requests/${ownRequestId}`]) {
    const res = await raw(path, { token: a.token })
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc, path).toMatch(/no-store|private/)
    expect(cc, path).not.toMatch(/public|s-maxage/)
  }
})

/** Признаки секретов сервера: строка подключения, имена серверных переменных, хеш пароля, метки тестовой сборки. */
const SECRET_PATTERNS = [
  /postgres(ql)?:\/\//i,
  /DATABASE_(OWNER_)?URL/,
  /POSTGRES_(OWNER|APP)_PASSWORD/,
  /TEST_DATABASE/,
  /CANARY_/,
  /password_?hash/i,
  /scrypt\$N=/,
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

test('С-03: в файлах сборки для браузера (.next/static) нет секретов и карт кода', async () => {
  const files = walk(join(NEXT_DIR, 'static'))
  expect(files.length).toBeGreaterThan(0)
  const offenders: string[] = []
  for (const file of files) {
    if (file.endsWith('.map')) offenders.push(`${file}: карта кода`)
    if (!/\.(js|css|json|txt|html)$/.test(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const p of SECRET_PATTERNS) if (p.test(text)) offenders.push(`${file}: ${p}`)
  }
  expect(offenders).toEqual([])
})

test('С-03: в HTML и данных RSC страниц под А и без входа нет секретов', async () => {
  const paths = ['/login', '/', '/profile', '/schedule', '/grades', '/notifications', '/requests', `/requests/${ownRequestId}`]
  for (const path of paths) {
    for (const token of [a.token, undefined]) {
      for (const [kind, res] of [
        ['HTML', await raw(path, { token })],
        ['RSC', await rawRsc(path, token)],
      ] as const) {
        for (const p of SECRET_PATTERNS) expect(p.test(res.text), `${kind} ${path} (${token ? 'А' : 'без входа'}): ${p}`).toBe(false)
      }
    }
  }
})
