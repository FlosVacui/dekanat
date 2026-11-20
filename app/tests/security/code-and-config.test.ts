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

  it('подача заявки читает из формы только вид и два поля заявки; смена статуса — номер, целевой статус и причину', () => {
    // Пакет 3.4, решение пользователя 13.11.2026: поля «Куда справка» и «Год оплаты». Владельца и статуса в форме по-прежнему нет.
    expect(formKeys('app/requests/new/actions.ts')).toEqual(['kind', 'paymentYear', 'purpose'])
    expect(formKeys('app/staff/requests/[id]/actions.ts')).toEqual(['reason', 'requestId', 'target'])
    // 20.11, блиц: объявление — адресат, заголовок и текст; набора и сотрудника в форме нет.
    expect(formKeys('app/staff/announcements/actions.ts')).toEqual(['audience', 'body', 'title'])
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
    // 19.11, ИИ-функции: четыре переменные модели (getAiConfig). Остальные имена прежние.
    expect(new Set(names)).toEqual(
      new Set(['DB_POOL_MAX', 'CLIENT_IP_HEADER', 'APP_TIMEZONE', 'CERTIFICATE_SECRET', 'JURY_MODE', 'SITE_ADDRESS', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_FOLDER_ID', '(required)']),
    )
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
    // Печатная справка читает Host, чтобы собрать адрес проверки для QR (19.11, идея №8).
    // 20.11, блиц: профиль читает Host по той же причине — адрес проверки студенческого билета для QR.
    expect(headerReaders).toEqual(['app/profile/page.tsx', 'app/requests/[id]/certificate/page.tsx', 'server/auth/cookie.ts'])
    // R-3.10-10: заголовок можно прочитать и у объекта запроса — request.headers.get(...).
    // Так читает только посредник, и только Origin; любое другое такое чтение — повод для ревью.
    // Проверка грубая (RV-3.10-9-3): не видит headers?.get, headers['…'], деструктуризацию и обход [...headers];
    // это сторож от случайного выключателя, а не разбор кода. Ревью кода посредника остаётся обязательным.
    const requestHeaderReads = src.flatMap((f) =>
      [...f.text.replace(/\/\/.*$/gm, '').matchAll(/\.headers\s*\.\s*(get|has|entries|forEach|keys|values)\s*\(([^)]*)\)/g)].map((m) => `${f.rel}: ${m[1]}(${(m[2] ?? '').trim()})`),
    )
    expect(requestHeaderReads).toEqual(["proxy.ts: get('origin')"])
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

// ---------- Аудит ворот 3, пакет 3.10 (SEC-3.10): Т-01, Ж-04 — раньше без теста (IMP-018, пункт 3) ----------

describe('Т-01: тестовый аккаунт не может испортить доступ — действий над учётной записью нет', () => {
  it('серверных действий ровно десять: вход, выход, подача, «Получить сразу», смена статуса, две отметки ленты, вопрос, ответ на него (пакет 4.1) и черновик ответа ИИ (19.11), плюс действия блица 20.11 (в списке с пометкой); обработчиков маршрутов нет', () => {
    // Новое действие (смена пароля, почты, удаление аккаунта) делает этот тест красным: его надо разобрать в аудите.
    const actions = src
      .filter((f) => /^['"]use server['"]/m.test(f.text))
      .flatMap((f) => [...f.text.matchAll(/^export\s+async\s+function\s+(\w+)/gm)].map((m) => `${f.rel}:${m[1]}`))
      .sort()
    expect(actions).toEqual(
      [
        'app/login/actions.ts:loginAction',
        'app/login/actions.ts:logoutAction',
        'app/notifications/actions.ts:markAllFeedReadAction',
        'app/notifications/actions.ts:openFeedItemAction',
        'app/questions/new/actions.ts:createQuestionAction',
        'app/requests/new/actions.ts:createReadyCertificateAction',
        'app/requests/new/actions.ts:createRequestAction',
        'app/staff/questions/[id]/actions.ts:answerQuestionAction',
        // 19.11, ИИ-функции: «Черновик ИИ» ничего не пишет в базу и не отправляет, только возвращает текст форме.
        'app/staff/questions/[id]/actions.ts:draftAnswerAction',
        'app/staff/announcements/actions.ts:createAnnouncementAction', // 20.11, блиц: объявление группе или потоку, набор и предел — в слое доступа
        'app/staff/(home)/actions.ts:weekSummaryAction', // 20.11, сводка: «Сводка недели от ИИ» — читает числа набора из сессии, ничего не пишет и не принимает из формы
        'app/staff/requests/[id]/actions.ts:changeStatusAction',
        // 20.11, блиц: фото профиля (только своё, тип и размер проверяет слой доступа) и настройки отображения (кука `ui` из списка значений).
        'app/profile/actions.ts:deleteAvatarAction',
        'app/profile/actions.ts:saveUiSettingsAction',
        'app/profile/actions.ts:uploadAvatarAction',
      ].sort(),
    )
    // Обработчик маршрута — тоже вход для записи. Промежуточный слой (proxy.ts) не запрещён: им можно закрыть R-3.10-1.
    // 20.11, блиц: два обработчика только на чтение (GET) — своё фото и своё расписание файлом календаря. Владелец — из сессии, записи нет.
    const routes = src.filter((f) => /(^|\/)route\.(ts|js|mjs)$/.test(f.rel))
    expect(routes.map((f) => f.rel).sort()).toEqual(['app/profile/avatar/route.ts', 'app/schedule/calendar.ics/route.ts'])
    for (const route of routes) {
      expect([...route.text.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]), route.rel).toEqual(['GET'])
    }
  })

  it('слой доступа не пишет в таблицы users и students: пароль, логин, роль и ФИО приложение не меняет', () => {
    const writers = src.filter((f) => /\.(update|insert|delete)\(\s*(users|students)\s*\)/.test(f.text) || /\b(update|insert\s+into|delete\s+from)\s+"?(users|students)\b/i.test(f.text))
    expect(writers.map((f) => f.rel)).toEqual([])
  })
})

describe('Ж-04: в коде нет вывода запросов целиком', () => {
  it('console.* нет нигде в src; в стандартный вывод пишет только журнал событий безопасности', () => {
    expect(src.filter((f) => /\bconsole\.\w+\(/.test(f.text)).map((f) => f.rel)).toEqual([])
    expect(src.filter((f) => /process\.(stdout|stderr)\.write/.test(f.text)).map((f) => f.rel)).toEqual(['server/security-log.ts'])
    // Запись журнала собирается из пяти полей; объекта запроса, формы, сессии в ней нет.
    const log = src.find((f) => f.rel === 'server/security-log.ts')!.text
    const body = log.slice(log.indexOf('JSON.stringify({'), log.indexOf('})', log.indexOf('JSON.stringify({')))
    expect([...body.matchAll(/^\s*(\w+)\s*[:,]/gm)].map((m) => m[1]).sort()).toEqual(['event', 'ip', 'requestId', 'time', 'userId'])
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

// 20.11, стипендия: страница `/scholarship` читает только оценки студента через слой доступа, владельца берёт из сессии
// и ничего не принимает из адреса; платежей и реквизитов в ней нет.
describe('20.11, стипендия: владелец из сессии, без записи и без платежей', () => {
  const page = src.find((f) => f.rel === 'app/scholarship/page.tsx')
  const lib = src.find((f) => f.rel === 'lib/scholarship.ts')

  it('страница есть, охрана студента стоит первой, данные — только через слой доступа', () => {
    expect(page, 'app/scholarship/page.tsx').toBeDefined()
    const text = page!.text
    expect(text).toMatch(/await\s+requireStudentActor\(\)/)
    expect(text).toMatch(/listMyGrades\(actor,/)
    expect(text).not.toMatch(/from\s+'@\/server\/dal\/(client|schema)'|getDb\(|drizzle-orm/)
  })

  it('из адреса и формы страница ничего не читает: ни searchParams, ни params, ни cookies, ни headers; серверных действий нет', () => {
    const text = page!.text
    expect(text).not.toMatch(/searchParams|\bparams\b|cookies\(|headers\(|'use server'|<form\b|method=/)
    expect(src.some((f) => f.rel.startsWith('app/scholarship/') && /'use server'/.test(f.text))).toBe(false)
  })

  it('расчёт — чистый модуль: ни базы, ни сервера, ни часов', () => {
    expect(lib, 'lib/scholarship.ts').toBeDefined()
    expect(lib!.text).not.toMatch(/server-only|@\/server|drizzle|new Date\(\)|Date\.now\(/)
  })

  it('в разделе нет кнопок оплаты, реквизитов и квитанций', () => {
    const text = `${page!.text}\n${lib!.text}`.replace(/^\s*(\/\/|\{\/\*).*$/gm, '')
    expect(text).not.toMatch(/Оплатить|реквизит|квитанц|номер\s+карты|\bIBAN\b|\bБИК\b/i)
  })
})
