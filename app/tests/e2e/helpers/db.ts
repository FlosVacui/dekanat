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
    const n = await c.query('select n.id, n.read_at from notifications n join users u on u.id = n.student_id where u.login = any($1) order by n.id', [logins])
    const r = await c.query(
      'select r.announcement_id, u.login, r.read_at from announcement_reads r join users u on u.id = r.student_id where u.login = any($1) order by r.announcement_id, u.login',
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

// Пакет 3.6: данные, которые экран «Сегодня» показывает по часам и по состоянию базы. Тест берёт их из базы, а не из часов теста.

/** Запись ленты студента с точным временем: личное уведомление (`link` — адрес) или объявление (`link` — null). */
export interface FeedRecord {
  id: string
  title: string
  body: string
  link: string | null
  at: Date
}

/** Личные уведомления студента и объявления его группы и факультета с временем создания: так лента упорядочена (R-3.5-1). */
export async function feedRecords(login: string): Promise<FeedRecord[]> {
  return withOwner(async (c) => {
    const own = await c.query(
      'select n.id, n.title, n.body, n.link, n.created_at from notifications n join users u on u.id = n.student_id where u.login = $1',
      [login],
    )
    const board = await c.query(
      `select a.id, a.title, a.body, a.published_at from announcements a
       join students s on (a.group_id = s.group_id or a.faculty = s.faculty)
       join users u on u.id = s.user_id where u.login = $1`,
      [login],
    )
    return [
      ...own.rows.map((r) => ({ id: r.id as string, title: r.title as string, body: r.body as string, link: (r.link as string | null) ?? null, at: r.created_at as Date })),
      ...board.rows.map((r) => ({ id: r.id as string, title: r.title as string, body: r.body as string, link: null, at: r.published_at as Date })),
    ]
  })
}

export interface DueRecord {
  id: string
  title: string
  discipline: string
  disciplineId: string
  dueDate: string
}

/** Работы дисциплин группы студента со сроком от `from` до `to` включительно, по сроку: то же, что «Что сдать на этой неделе». */
export async function dueRecords(login: string, from: string, to: string): Promise<DueRecord[]> {
  return withOwner(async (c) => {
    const res = await c.query(
      `select a.id, a.title, d.name as discipline, d.id as discipline_id, to_char(a.due_date, 'YYYY-MM-DD') as due_date
       from assignments a join disciplines d on d.id = a.discipline_id
       join students s on s.group_id = d.group_id join users u on u.id = s.user_id
       where u.login = $1 and a.due_date between $2::date and $3::date order by a.due_date, a.title`,
      [login, from, to],
    )
    return res.rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      discipline: r.discipline as string,
      disciplineId: r.discipline_id as string,
      dueDate: r.due_date as string,
    }))
  })
}

/**
 * Работа со сроком `dueDate` у первой по названию дисциплины группы студента: тест «Сегодня» создаёт её, чтобы блок
 * «Что сдать на этой неделе» не был пуст в любой день запуска (в воскресенье неделя кончается сегодня). Удаляется `removeAssignments`.
 */
export async function addAssignment(login: string, title: string, dueDate: string): Promise<DueRecord> {
  return withOwner(async (c) => {
    const res = await c.query(
      `insert into assignments (id, discipline_id, title, due_date, max_points)
       select gen_random_uuid(), d.id, $2, $3::date, 10 from disciplines d
       join students s on s.group_id = d.group_id join users u on u.id = s.user_id
       where u.login = $1 order by d.name limit 1
       returning id, discipline_id, (select name from disciplines where id = discipline_id) as discipline`,
      [login, title, dueDate],
    )
    const row = res.rows[0]
    if (!row) throw new Error('addAssignment: у студента нет дисциплин')
    return { id: row.id as string, title, discipline: row.discipline as string, disciplineId: row.discipline_id as string, dueDate }
  })
}

/** Убирает работы, созданные `addAssignment`. */
export async function removeAssignments(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await withOwner(async (c) => {
    await c.query('delete from assignments where id = any($1::uuid[])', [ids])
  })
}

/** Сколько у студента непрочитанных объявлений (то, что стоит в «Новых: N» на экране «Сегодня»). */
export async function unreadAnnouncementCount(login: string): Promise<number> {
  return withOwner(async (c) => {
    const res = await c.query(
      `select count(*)::int as n from announcements a
       join students s on (a.group_id = s.group_id or a.faculty = s.faculty)
       join users u on u.id = s.user_id
       where u.login = $1 and not exists (select 1 from announcement_reads r where r.announcement_id = a.id and r.student_id = s.user_id)`,
      [login],
    )
    return res.rows[0].n as number
  })
}

// Пакет 3.7: отказ базы для проверки состояния «ошибка». Владелец отзывает у роли приложения право чтения одной таблицы:
// запрос слоя доступа к ней падает, страница бросает ошибку, и Next.js показывает error.tsx. В продукте для этого нет ни обходного
// входа, ни переключателя. Только локальная тестовая база. Тест возвращает право в `finally` каждой проверки и в `afterAll`.

/** Таблицы, у которых тест отзывает право чтения. Другие имена не принимаются: имя идёт в запрос как идентификатор. */
export const REVOCABLE_TABLES = ['lessons', 'disciplines', 'requests', 'notifications', 'groups'] as const
export type RevocableTable = (typeof REVOCABLE_TABLES)[number]

function assertRevocable(table: string): asserts table is RevocableTable {
  if (!(REVOCABLE_TABLES as readonly string[]).includes(table)) throw new Error(`Таблица «${table}» не из списка REVOCABLE_TABLES`)
}

/** Имя роли приложения — из адреса базы приложения (DATABASE_URL). Файл окружения читается тем же способом, что у адреса владельца; значения не печатаются. */
function appRole(): string {
  ownerUrl()
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Нет DATABASE_URL: имя роли приложения взять неоткуда')
  const role = decodeURIComponent(new URL(url).username)
  if (!role) throw new Error('В DATABASE_URL нет имени роли')
  return role
}

/** Есть ли у роли приложения право чтения таблицы. */
export async function appCanRead(table: RevocableTable): Promise<boolean> {
  assertRevocable(table)
  const role = appRole()
  return withOwner(async (c) => {
    const res = await c.query('select has_table_privilege($1, $2, $3) as ok', [role, table, 'select'])
    return res.rows[0].ok as boolean
  })
}

/** Отзывает у роли приложения право чтения таблицы. Право не пропало — тест не может вызвать отказ базы этим способом: ошибка. */
export async function revokeRead(table: RevocableTable): Promise<void> {
  assertRevocable(table)
  const role = appRole()
  await withOwner(async (c) => {
    await c.query(`revoke select on table ${c.escapeIdentifier(table)} from ${c.escapeIdentifier(role)}`)
  })
  if (await appCanRead(table)) throw new Error(`Право чтения «${table}» после отзыва осталось: способ с отзывом права не работает`)
}

/** Возвращает право чтения, как его выдают миграции (`GRANT SELECT ON ALL TABLES`, app/db/migrate-lib.ts). Можно вызывать, когда право на месте. */
export async function restoreRead(table: RevocableTable): Promise<void> {
  assertRevocable(table)
  const role = appRole()
  await withOwner(async (c) => {
    await c.query(`grant select on table ${c.escapeIdentifier(table)} to ${c.escapeIdentifier(role)}`)
  })
}

/** Номер первой по времени заявки студента: для проверки чужой заявки. Заявок нет — null. */
export async function firstRequestIdOf(login: string): Promise<string | null> {
  return withOwner(async (c) => {
    const res = await c.query(
      'select r.id from requests r join users u on u.id = r.student_id where u.login = $1 order by r.created_at, r.id limit 1',
      [login],
    )
    return (res.rows[0]?.id as string | undefined) ?? null
  })
}

/** Заявки студента, о которых «Сегодня» говорит в блоке «Мои заявки»: в работе, готова, отклонена. */
export async function requestNewsCount(login: string): Promise<number> {
  return withOwner(async (c) => {
    const res = await c.query(
      `select count(*)::int as n from requests r join users u on u.id = r.student_id
       where u.login = $1 and r.status in ('in_progress', 'ready', 'rejected')`,
      [login],
    )
    return res.rows[0].n as number
  })
}
