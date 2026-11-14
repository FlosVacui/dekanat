import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../src', import.meta.url))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const files = walk(SRC).map((full) => ({ rel: relative(SRC, full).split(sep).join('/'), text: readFileSync(full, 'utf8') }))

describe('границы слоя доступа и окружения (поиск по коду)', () => {
  it('клиент базы импортируется только в src/server/dal/', () => {
    const offenders = files.filter(
      (f) => !f.rel.startsWith('server/dal/') && /from\s+['"](pg|drizzle-orm)(\/[^'"]*)?['"]/.test(f.text),
    )
    expect(offenders.map((f) => f.rel)).toEqual([])
  })

  it('process.env читается только в src/server/config.ts', () => {
    const offenders = files.filter((f) => f.rel !== 'server/config.ts' && /process\.env/.test(f.text))
    expect(offenders.map((f) => f.rel)).toEqual([])
  })

  it('config.ts и модули слоя помечены server-only', () => {
    const marked = files.filter((f) => f.rel === 'server/config.ts' || /^server\/dal\/(?!schema)/.test(f.rel))
    expect(marked.length).toBeGreaterThanOrEqual(6)
    for (const f of marked) expect(f.text, f.rel).toMatch(/^import 'server-only'/m)
  })

  it('действующее лицо создаётся только в модуле сессий: нет приведения `as Actor` и `new Actor(`', () => {
    const offenders = files.filter((f) => f.rel !== 'server/auth/session.ts' && /\bas\s+Actor\b|new\s+Actor\s*\(/.test(f.text))
    expect(offenders.map((f) => f.rel)).toEqual([])
  })

  it('имён с NEXT_PUBLIC_ в коде нет, ключа env в конфигурации Next.js нет', () => {
    expect(files.filter((f) => /NEXT_PUBLIC_/.test(f.text)).map((f) => f.rel)).toEqual([])
    const config = readFileSync(fileURLToPath(new URL('../../next.config.ts', import.meta.url)), 'utf8')
    expect(config).not.toMatch(/^\s*env\s*:/m)
    expect(config).toMatch(/productionBrowserSourceMaps:\s*false/)
  })

  it('запросы только с параметрами: в слое нет склейки строк в SQL и нет sql.raw', () => {
    const dal = files.filter((f) => f.rel.startsWith('server/dal/'))
    for (const f of dal) {
      expect(f.text, f.rel).not.toMatch(/sql\.raw|sql\.identifier|\.unsafe\(/)
      expect(f.text, f.rel).not.toMatch(/client\.query\(\s*`/)
    }
  })

  it('личное не кэшируется: use cache и unstable_cache в слое и страницах не применяются', () => {
    for (const f of files) expect(f.text, f.rel).not.toMatch(/['"]use cache['"]|unstable_cache/)
  })
})

describe('роль базы у приложения (П-10, ADR-0002)', () => {
  async function asApp<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('Нет DATABASE_URL')
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
      return await run(client)
    } finally {
      await client.end()
    }
  }

  it('без прав суперпользователя, создания баз и ролей, без обхода политик строк', async () => {
    const row = await asApp((c) =>
      c.query('select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication from pg_roles where rolname = current_user'),
    )
    expect(row.rows[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolreplication: false })
  })

  it('роль приложения не владелец таблиц: изменить схему и удалить таблицу не может', async () => {
    await expect(asApp((c) => c.query('drop table users'))).rejects.toThrow(/must be owner|permission denied/)
    await expect(asApp((c) => c.query('alter table users add column x int'))).rejects.toThrow(/must be owner|permission denied/)
  })

  it('учётные записи и оценки приложение изменять не может, только читать', async () => {
    await expect(asApp((c) => c.query(`update users set role = 'staff'`))).rejects.toThrow(/permission denied/)
    await expect(asApp((c) => c.query(`insert into users (login, password_hash, role, cohort) values ('x','x','staff','main')`))).rejects.toThrow(/permission denied/)
    await expect(asApp((c) => c.query(`update grades set points = 100`))).rejects.toThrow(/permission denied/)
    await expect(asApp((c) => c.query(`delete from requests`))).rejects.toThrow(/permission denied/)
  })

  it('поля переноса пары (пакет 3.8) роль приложения читает и не пишет', async () => {
    const rows = await asApp((c) =>
      c.query(
        `select kind, new_date::text as new_date, new_starts_at::text as new_starts_at, new_ends_at::text as new_ends_at, new_room
         from lesson_changes order by kind`,
      ),
    )
    expect(rows.rows.length).toBeGreaterThan(0)
    // Перенос на другой день из набора: все четыре поля заполнены; смена аудитории — только новая аудитория.
    expect(rows.rows.some((r) => r.kind === 'moved' && r.new_date && r.new_starts_at && r.new_ends_at && r.new_room)).toBe(true)
    expect(rows.rows.some((r) => r.kind === 'room_changed' && r.new_room && !r.new_date)).toBe(true)
    await expect(asApp((c) => c.query(`update lesson_changes set new_room = 'x'`))).rejects.toThrow(/permission denied/)
  })

  it('счётчики входа роль приложения пишет и чистит; права выдаёт migrate-lib.ts, а не миграция с именем роли (R-3.1-5)', async () => {
    const probe = 'права-проверка-3-1'
    await asApp(async (c) => {
      const statements = [
        {
          table: 'login_attempts',
          insert: `insert into login_attempts (ip, login, fails, next_allowed_at, last_attempt_at) values ($1, $1, 1, now(), now())`,
          update: `update login_attempts set fails = 2 where ip = $1`,
          remove: `delete from login_attempts where ip = $1`,
        },
        {
          table: 'login_ip_windows',
          insert: `insert into login_ip_windows (ip, window_start, attempts) values ($1, now(), 1)`,
          update: `update login_ip_windows set attempts = 2 where ip = $1`,
          remove: `delete from login_ip_windows where ip = $1`,
        },
        {
          table: 'login_streaks',
          insert: `insert into login_streaks (login, fails) values ($1, 1)`,
          update: `update login_streaks set fails = 2 where login = $1`,
          remove: `delete from login_streaks where login = $1`,
        },
      ]
      for (const s of statements) {
        await c.query(s.insert, [probe])
        expect((await c.query(s.update, [probe])).rowCount, s.table).toBe(1)
        expect((await c.query(s.remove, [probe])).rowCount, s.table).toBe(1)
      }
    })
    const migrations = join(fileURLToPath(new URL('../../db/migrations', import.meta.url)))
    for (const name of readdirSync(migrations).filter((n) => n.endsWith('.sql'))) {
      expect(readFileSync(join(migrations, name), 'utf8'), name).not.toMatch(/dekanat_app|\bGRANT\b/i)
    }
    const lib = readFileSync(fileURLToPath(new URL('../../db/migrate-lib.ts', import.meta.url)), 'utf8')
    expect(lib).toMatch(/GRANT INSERT, UPDATE, DELETE ON login_attempts, login_ip_windows, login_streaks TO \{role\}/)
  })
})
