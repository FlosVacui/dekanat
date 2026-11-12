// Атакующие проверки пакета 2.6 поиском по коду и настройкам (Vitest, без базы).
// С-02, С-06, С-07, П-10 (Compose), Д-03, Д-04; дополнения аудита R-2.3-25, R-2.3-28, R-2.3-33, R-2.3-34, R-2.3-35;
// Н-02 и «данные вымышленные» — попутно, дёшево. Файлы окружения не читаются: только имена в индексе git.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP = fileURLToPath(new URL('../../', import.meta.url))
const ROOT = join(APP, '..')
const SRC = join(APP, 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx|mjs|js)$/.test(name) ? [full] : []
  })
}

const src = walk(SRC).map((full) => ({ rel: relative(SRC, full).split(sep).join('/'), text: readFileSync(full, 'utf8') }))
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)

describe('С-02, С-06, С-07: секреты только на сервере и не в git', () => {
  it('С-02: нет имён NEXT_PUBLIC_ с секретами; в next.config нет ключа env', () => {
    const files = ['app/next.config.ts', 'app/Dockerfile', 'compose.yaml', '.env.example']
    const names = [...src.map((f) => f.text), ...files.map(read)].flatMap((t) => t.match(/NEXT_PUBLIC_\w+/g) ?? [])
    expect(names).toEqual([])
    expect(read('app/next.config.ts')).not.toMatch(/\benv\s*:/)
  })

  it('С-06: process.env читает только config.ts, он помечен server-only; клиентские файлы не тянут серверные модули', () => {
    expect(src.filter((f) => f.rel !== 'server/config.ts' && /process\.env/.test(f.text)).map((f) => f.rel)).toEqual([])
    expect(src.find((f) => f.rel === 'server/config.ts')?.text).toMatch(/^import 'server-only'/m)
    const client = src.filter((f) => /^['"]use client['"]/m.test(f.text))
    expect(client.length).toBeGreaterThan(0)
    for (const f of client) expect(f.text, f.rel).not.toMatch(/from\s+['"](@\/server|\.\.?\/.*server)\//)
    // Каждый модуль слоя и входа помечен server-only, кроме схемы и чистых модулей без окружения.
    for (const f of src.filter((x) => /^server\/(dal|auth)\//.test(x.rel) && !/schema|gate|password/.test(x.rel))) {
      expect(f.text, f.rel).toMatch(/^import 'server-only'/m)
    }
  })

  it('С-07: файлов окружения в git нет, кроме образца; .env в .gitignore', () => {
    const envFiles = tracked.filter((p) => /(^|\/)\.env(\.|$)/.test(p) && !p.endsWith('.env.example'))
    expect(envFiles).toEqual([])
    expect(read('.gitignore')).toMatch(/^\.env\b/m)
  })
})

describe('П-10: в compose.yaml порты базы и приложения наружу не публикуются', () => {
  it('нет ключа ports и записи вида «5432:5432» / «3000:3000»', () => {
    const compose = read('compose.yaml')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
    expect(compose).not.toMatch(/^\s*ports\s*:/m)
    expect(compose).not.toMatch(/["']?\d+:\d+["']?\s*$/m)
    expect(compose).not.toMatch(/network_mode\s*:\s*host/)
  })
})

describe('R-2.3-25, R-2.3-28: действующее лицо создаёт только модуль сессий', () => {
  it('нет `as Actor`, `new Actor(`, Object.create и setPrototypeOf вне модуля сессий; метка не экспортируется', () => {
    const offenders = src.filter(
      (f) => f.rel !== 'server/auth/session.ts' && /\bas\s+Actor\b|new\s+Actor\s*\(|Object\.create\(|setPrototypeOf\(/.test(f.text),
    )
    expect(offenders.map((f) => f.rel)).toEqual([])
    const session = src.find((f) => f.rel === 'server/auth/session.ts')!.text
    expect(session).not.toMatch(/export\s+(const|let)\s+MINT/)
    expect(session).not.toMatch(/export\s*\{[^}]*MINT/)
  })
})

describe('R-2.3-34: студент статус не передаёт; сотрудник — только целевой статус', () => {
  function formKeys(rel: string): string[] {
    const text = src.find((f) => f.rel === rel)?.text ?? ''
    return [...text.matchAll(/formData\.get\('([^']+)'\)/g)].map((m) => m[1]!).sort()
  }

  it('подача заявки читает из формы только вид; смена статуса — номер, целевой статус и причину', () => {
    expect(formKeys('app/requests/new/actions.ts')).toEqual(['kind'])
    expect(formKeys('app/staff/requests/[id]/actions.ts')).toEqual(['reason', 'requestId', 'target'])
    expect(formKeys('app/login/actions.ts')).toEqual(['login', 'password'])
  })

  it('статус новой заявки ставит слой; переход проверяется по списку допустимых в одном UPDATE', () => {
    const student = src.find((f) => f.rel === 'server/dal/student.ts')!.text
    expect(student).toMatch(/status:\s*'submitted'/)
    const staff = src.find((f) => f.rel === 'server/dal/staff.ts')!.text
    expect(staff).toMatch(/inArray\(requests\.status,\s*\[\.\.\.allowedFrom\]\)/)
  })
})

describe('R-2.3-35: выключателя проверок по окружению или заголовку нет', () => {
  it('конфигурация — только четыре значения, без флагов отключения', () => {
    const config = src.find((f) => f.rel === 'server/config.ts')!.text
    const names = [...config.matchAll(/process\.env(?:\.(\w+)|\[\s*name\s*\])/g)].map((m) => m[1] ?? '(required)')
    expect(new Set(names)).toEqual(new Set(['DB_POOL_MAX', 'CLIENT_IP_HEADER', 'APP_TIMEZONE', '(required)']))
    expect(config.match(/required\('(\w+)'\)/g)).toEqual(["required('DATABASE_URL')"])
  })

  it('в коде нет переключателей вида DISABLE/SKIP/BYPASS/NO_AUTH/NODE_ENV и чтения заголовков, кроме адреса посетителя', () => {
    // Имена переменных — заглавными; слова вида bypass/skipAuth — в любом регистре. Свойство disabled у кнопок — не флаг.
    const switches = src.filter((f) => {
      const code = f.text.replace(/\/\/.*$/gm, '')
      return /\b(DISABLE|SKIP|BYPASS|NO_?AUTH|INSECURE|NODE_ENV|TEST_MODE|E2E)\w*/.test(code) || /\b(bypass\w*|skip(Auth|Check|Limit)\w*|noAuth|insecure)\b/i.test(code)
    })
    expect(switches.map((f) => f.rel)).toEqual([])
    const headerReaders = src.filter((f) => /\bheaders\(\)/.test(f.text)).map((f) => f.rel)
    expect(headerReaders).toEqual(['server/auth/cookie.ts'])
  })
})

describe('R-2.3-33: флаг Secure и префикс __Host- на месте; сквозной тест — Chromium', () => {
  it('нигде нет secure: false; кука называется __Host-session', () => {
    expect(src.filter((f) => /secure\s*:\s*(false|process|!)/.test(f.text)).map((f) => f.rel)).toEqual([])
    const cookie = src.find((f) => f.rel === 'server/auth/cookie.ts')!.text
    expect(cookie).toContain("SESSION_COOKIE = '__Host-session'")
    expect(cookie.match(/secure:\s*true/g)?.length).toBe(2)
  })

  it('в настройках Playwright только Chromium', () => {
    const config = read('app/playwright.config.ts')
    expect(config).toMatch(/browserName:\s*'chromium'/)
    expect(config).not.toMatch(/firefox|webkit/)
  })
})

describe('Д-03, Д-04: версия Next.js и файл блокировки', () => {
  it('Д-03: установлен Next.js не ниже 16.4.5 (рубеж R-1.5 на 11.11.2026), версия закреплена точно', () => {
    const version = JSON.parse(readFileSync(join(APP, 'node_modules/next/package.json'), 'utf8')).version as string
    const [major, minor, patch] = version.split('.').map((x) => Number.parseInt(x, 10))
    expect(major).toBe(16)
    expect((minor ?? 0) * 1000 + (patch ?? 0)).toBeGreaterThanOrEqual(4 * 1000 + 5)
    const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'))
    expect(pkg.dependencies.next).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('Д-04: package-lock.json в git; образ ставит зависимости через npm ci', () => {
    expect(tracked).toContain('app/package-lock.json')
    const dockerfile = read('app/Dockerfile')
    expect(dockerfile).toMatch(/RUN npm ci\b/)
    expect(dockerfile).not.toMatch(/npm install\b/)
    expect(dockerfile).not.toMatch(/^\s*(ARG|ENV)\s+\w*(PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL)/im)
  })
})

describe('Н-02 и данные (попутно)', () => {
  it('нет вывода HTML без экранирования и исполнения строк', () => {
    const risky = src.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|\beval\(|new Function\(|sql\.raw\(/.test(f.text))
    expect(risky.map((f) => f.rel)).toEqual([])
  })

  it('в вымышленных данных нет адресов почты и телефонов', () => {
    const seed = readFileSync(join(APP, 'db/seed-data.ts'), 'utf8')
    expect(seed).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    expect(seed).not.toMatch(/(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/)
  })
})
