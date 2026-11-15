// Подготовка состояния для сквозных тестов и снимков запросом к базе под владельцем (только вымышленные данные).
// Playwright и tsx запускаются без файла окружения, поэтому, если адреса базы в окружении нет, он читается из `.env`
// в корне репозитория тем же способом, что в scripts/with-env.mjs (значения не печатаются).
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { MAIN_COHORT } from '../../../db/seed-data'
import { buildCohortPlan } from '../../../db/seed-plan'
import { todayIn } from '../../../src/lib/dates'

function ownerUrl(): string {
  if (!process.env.DATABASE_OWNER_URL) {
    const file = process.env.ENV_FILE || fileURLToPath(new URL('../../../../.env', import.meta.url))
    try {
      process.loadEnvFile(file)
    } catch {
      throw new Error('Нет DATABASE_OWNER_URL и не удалось прочитать файл окружения: npm run db:setup создаёт .env')
    }
  }
  const url = process.env.DATABASE_OWNER_URL
  if (!url) throw new Error('Нет DATABASE_OWNER_URL')
  return url
}

/**
 * Пара «адрес и логин» ждёт ещё `seconds` секунд при `fails` неверных. Тест не надеется, что шаги уложатся в секунду
 * после пятой попытки: метка ожидания выставляется запросом (R-3.1-2). Строка пары должна уже существовать.
 */
export async function holdPair(ip: string, login: string, seconds = 30, fails = 5): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl() })
  await client.connect()
  try {
    const res = await client.query(
      `update login_attempts set fails = $3, next_allowed_at = clock_timestamp() + $4 * interval '1 second', last_attempt_at = clock_timestamp()
       where ip = $1 and login = $2`,
      [ip, login, fails, seconds],
    )
    if (res.rowCount !== 1) throw new Error('holdPair: строки пары нет — сначала нужна хотя бы одна попытка входа')
  } finally {
    await client.end()
  }
}

// Прочитанность ленты уведомлений (пакет 3.5). Сквозные тесты и снимки отмечают записи; следующие файлы работают с теми же
// аккаунтами, поэтому тест в конце возвращает прочитанность к тому, что было до него (снимок), а в начале каждой проверки
// ставит её к набору (`resetFeedToSeed`), чтобы не зависеть от порядка файлов.

async function withOwner<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ownerUrl() })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

export interface FeedState {
  notifications: { id: string; readAt: Date | null }[]
  reads: { announcementId: string; studentLogin: string; readAt: Date }[]
}

/** Что сейчас прочитано у студентов: отметки личных уведомлений и объявлений. */
export async function snapshotFeedState(logins: string[]): Promise<FeedState> {
  return withOwner(async (c) => {
    const n = await c.query('select n.id, n.read_at from notifications n join users u on u.id = n.student_id where u.login = any($1)', [logins])
    const r = await c.query(
      'select r.announcement_id, u.login, r.read_at from announcement_reads r join users u on u.id = r.student_id where u.login = any($1)',
      [logins],
    )
    return {
      notifications: n.rows.map((row) => ({ id: row.id as string, readAt: row.read_at as Date | null })),
      reads: r.rows.map((row) => ({ announcementId: row.announcement_id as string, studentLogin: row.login as string, readAt: row.read_at as Date })),
    }
  })
}

/** Возвращает прочитанность к снимку: прежнее `read_at` у уведомлений; отметки объявлений — ровно те, что были. */
export async function restoreFeedState(state: FeedState, logins: string[]): Promise<void> {
  await withOwner(async (c) => {
    for (const n of state.notifications) {
      await c.query('update notifications set read_at = $2 where id = $1 and read_at is distinct from $2', [n.id, n.readAt])
    }
    await c.query('delete from announcement_reads where student_id in (select id from users where login = any($1))', [logins])
    for (const r of state.reads) {
      await c.query(
        'insert into announcement_reads (announcement_id, student_id, read_at) select $1, u.id, $3 from users u where u.login = $2 on conflict do nothing',
        [r.announcementId, r.studentLogin, r.readAt],
      )
    }
  })
}

/**
 * Прочитанность студента основного набора — как после `db:seed`: уведомления, непрочитанные по набору, снова непрочитаны;
 * отметок объявлений нет. Уведомления, которых в наборе нет (их создали события), не трогаются.
 */
export async function resetFeedToSeed(login: string): Promise<void> {
  const plan = buildCohortPlan(MAIN_COHORT, todayIn('Europe/Moscow'))
  const student = plan.students.find((s) => s.spec.login === login)
  if (!student) throw new Error(`resetFeedToSeed: ${login} нет в основном наборе`)
  const unreadIds = student.notifications.filter((n) => n.unread).map((n) => n.id)
  await withOwner(async (c) => {
    await c.query('update notifications set read_at = null where id = any($1::uuid[])', [unreadIds])
    await c.query('delete from announcement_reads where student_id in (select id from users where login = $1)', [login])
  })
}

/** Ставит всем личным уведомлениям студента один вид и возвращает прежние виды по номерам: пустой фильтр на время проверки. */
export async function forceNotificationKind(login: string, kind: 'reminder' | 'news'): Promise<Map<string, string>> {
  return withOwner(async (c) => {
    const before = await c.query('select n.id, n.kind from notifications n join users u on u.id = n.student_id where u.login = $1', [login])
    await c.query('update notifications set kind = $2 where student_id = (select id from users where login = $1)', [login, kind])
    return new Map(before.rows.map((row) => [row.id as string, row.kind as string]))
  })
}

/** Возвращает виды уведомлений, снятые `forceNotificationKind`. */
export async function restoreNotificationKinds(saved: Map<string, string>): Promise<void> {
  await withOwner(async (c) => {
    for (const [id, kind] of saved) await c.query('update notifications set kind = $2 where id = $1 and kind <> $2', [id, kind])
  })
}

/** Убирает заявки, которые создал тест, и уведомления о них. Заявки набора не трогаются. */
export async function removeTestRequests(requestIds: string[]): Promise<void> {
  if (requestIds.length === 0) return
  await withOwner(async (c) => {
    await c.query('delete from notifications where link = any($1)', [requestIds.map((id) => `/requests/${id}`)])
    await c.query('delete from requests where id = any($1::uuid[])', [requestIds])
  })
}
