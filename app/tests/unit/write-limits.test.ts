// Пределы сессий, лимит записи и лимит смены статуса (пакет 3.1, ADR-0003, ADR-0002). Время не ждут: метки сдвигаются
// в базе. Всё, что тесты создали, в конце удаляется: следующие файлы работают с теми же аккаунтами.
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { authenticate } from '@/server/auth/login'
import { createSession, resolveActor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { RequestLimitError } from '@/server/dal/guards'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor, freshIp, withOwner } from './helpers'

afterAll(closeDb)

const sha = (token: string) => createHash('sha256').update(token).digest('hex')

async function loginToken(ip: string, account = STUDENT_B): Promise<string> {
  const outcome = await authenticate(account.login, account.password, ip)
  if (!outcome.ok) throw new Error(`вход не удался: ${outcome.reason}`)
  return outcome.token
}

async function liveSessions(login: string, ip?: string): Promise<number> {
  const res = await withOwner((c) =>
    c.query(
      `select count(*)::int as n from sessions s join users u on u.id = s.user_id
       where u.login = $1 and s.expires_at > now() and ($2::text is null or s.ip = $2)`,
      [login, ip ?? null],
    ),
  )
  return res.rows[0].n
}

describe('пределы сессий: 10 на пару «аккаунт и адрес», 300 на аккаунт', () => {
  it('11-й вход с одного адреса гасит самую старую сессию этой пары; сессии с другого адреса живы', async () => {
    const x = freshIp()
    const y = freshIp()
    const other = await loginToken(y)
    const tokens: string[] = []
    for (let i = 0; i < 11; i += 1) tokens.push(await loginToken(x))
    expect(await liveSessions(STUDENT_B.login, x)).toBe(10)
    expect(await resolveActor(tokens[0]), 'самая старая сессия пары погашена').toBeNull()
    for (const token of tokens.slice(1)) expect(await resolveActor(token)).not.toBeNull()
    expect(await resolveActor(other), 'сессия с другого адреса жива').not.toBeNull()
  })

  it('15 одновременных входов одной пары: живых сессий не больше 10, ни одной ошибки (замок на аккаунт, R-3.1-3 а)', async () => {
    // Хеш пароля дорог, а очередь хеша — восемь: 15 входов через authenticate часть отвергла бы как «сервер занят».
    // Поэтому залп идёт прямо на выдачу сессии — ту самую, которую вход вызывает после проверки пароля.
    const user = await withOwner((c) => c.query('select id from users where login = $1', [STUDENT_B.login]))
    const userId = user.rows[0].id as string
    for (let round = 0; round < 3; round += 1) {
      const ip = freshIp()
      const results = await Promise.allSettled(Array.from({ length: 15 }, () => createSession(userId, ip)))
      expect(results.filter((r) => r.status === 'rejected'), `раунд ${round}: ошибки выдачи`).toEqual([])
      expect(await liveSessions(STUDENT_B.login, ip), `раунд ${round}: живых сессий пары`).toBe(10)
      // Живые — это именно выданные, а не лишние: каждая выжившая сессия узнаётся по своему токену.
      const alive = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createSession>>> => r.status === 'fulfilled')
      const found = (await Promise.all(alive.map((r) => resolveActor(r.value.token)))).filter((a) => a !== null)
      expect(found).toHaveLength(10)
    }
  })

  it('300 живых на аккаунт: следующий вход гасит самую старую сессию аккаунта', async () => {
    const ip = freshIp()
    const oldest = await loginToken(ip)
    // Остальные 299 живых сессий аккаунта (с разных адресов) добавляются запросом к базе: 299 хешей тест считать не должен.
    await withOwner((c) =>
      c.query(
        `insert into sessions (token_hash, user_id, expires_at, ip, created_at)
         select 'bulk-' || g || '-' || md5(random()::text), u.id, now() + interval '1 day', 'bulk-' || g, now() - interval '1 hour' + g * interval '1 second'
         from users u, generate_series(1, 300 - (select count(*) from sessions s2 where s2.user_id = u.id and s2.expires_at > now())) g
         where u.login = $1`,
        [STUDENT_B.login],
      ),
    )
    try {
      // Самая старая сессия аккаунта — та, что создана раньше всех.
      await withOwner((c) =>
        c.query(`update sessions set created_at = now() - interval '2 hours' where token_hash = $1`, [sha(oldest)]),
      )
      expect(await liveSessions(STUDENT_B.login)).toBe(300)
      const fresh = await loginToken(freshIp())
      expect(await liveSessions(STUDENT_B.login)).toBe(300)
      expect(await resolveActor(oldest), 'самая старая сессия аккаунта погашена').toBeNull()
      expect(await resolveActor(fresh)).not.toBeNull()
    } finally {
      await withOwner((c) => c.query(`delete from sessions where token_hash like 'bulk-%'`))
    }
  })

  it('просроченные сессии не занимают место в пределе и стираются при новом входе', async () => {
    const ip = freshIp()
    const old = await loginToken(ip)
    await withOwner((c) => c.query(`update sessions set expires_at = now() - interval '1 minute' where token_hash = $1`, [sha(old)]))
    await loginToken(ip)
    const gone = await withOwner((c) => c.query('select 1 from sessions where token_hash = $1', [sha(old)]))
    expect(gone.rowCount).toBe(0)
  })
})

describe('лимит записи: 10 заявок в сутки на пару «аккаунт и адрес», 200 на аккаунт', () => {
  const addresses: string[] = []
  const fresh = () => {
    const ip = freshIp()
    addresses.push(ip)
    return ip
  }
  afterAll(async () => {
    await withOwner((c) => c.query(`delete from requests where ip = any($1) or ip like 'bulk-%'`, [addresses]))
  })

  it('11-я заявка за сутки с одного адреса — отказ; с другого адреса проходит', async () => {
    const b = await actorFor(STUDENT_B)
    const x = fresh()
    const y = fresh()
    for (let i = 0; i < 10; i += 1) expect(await studentDal.createMyRequest(b, { kind: 'dean_certificate' }, x)).not.toBeNull()
    await expect(studentDal.createMyRequest(b, { kind: 'dean_certificate' }, x)).rejects.toMatchObject({ name: 'RequestLimitError', scope: 'pair' })
    const count = await withOwner((c) => c.query('select count(*)::int as n from requests where ip = $1', [x]))
    expect(count.rows[0].n, 'отказанная заявка не создана').toBe(10)
    expect(await studentDal.createMyRequest(b, { kind: 'financial_aid' }, y)).not.toBeNull()
  })

  it('заявки старше суток в лимит не входят', async () => {
    const b = await actorFor(STUDENT_B)
    const x = fresh()
    for (let i = 0; i < 10; i += 1) await studentDal.createMyRequest(b, { kind: 'dean_certificate' }, x)
    await expect(studentDal.createMyRequest(b, { kind: 'dean_certificate' }, x)).rejects.toBeInstanceOf(RequestLimitError)
    await withOwner((c) => c.query(`update requests set created_at = now() - interval '25 hours' where ip = $1`, [x]))
    expect(await studentDal.createMyRequest(b, { kind: 'dean_certificate' }, x)).not.toBeNull()
  })

  it('20 одновременных подач с одного адреса дают не больше 10 заявок', async () => {
    const b = await actorFor(STUDENT_B)
    const x = fresh()
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => studentDal.createMyRequest(b, { kind: 'tuition_certificate' }, x)))
    const created = results.filter((r) => r.status === 'fulfilled' && r.value !== null)
    const refused = results.filter((r) => r.status === 'rejected' && r.reason instanceof RequestLimitError)
    expect(created).toHaveLength(10)
    expect(refused).toHaveLength(10)
    const count = await withOwner((c) => c.query('select count(*)::int as n from requests where ip = $1', [x]))
    expect(count.rows[0].n).toBe(10)
  })

  it('200 заявок в сутки на аккаунт: с любого адреса — отказ «на аккаунт»', async () => {
    const b = await actorFor(STUDENT_B)
    await withOwner((c) =>
      c.query(
        `insert into requests (student_id, kind, status, ip, purpose)
         select u.id, 'dean_certificate', 'submitted', 'bulk-' || g, 'on_demand'
         from users u, generate_series(1, 200 - (select count(*) from requests r where r.student_id = u.id and r.created_at > now() - interval '1 day')) g
         where u.login = $1`,
        [STUDENT_B.login],
      ),
    )
    await expect(studentDal.createMyRequest(b, { kind: 'dean_certificate' }, fresh())).rejects.toMatchObject({ scope: 'account' })
    // Лимит на аккаунт не мешает другому аккаунту: у первого студента заявка проходит.
    const a = await actorFor(STUDENT_A)
    expect(await studentDal.createMyRequest(a, { kind: 'dean_certificate' }, fresh())).not.toBeNull()
  })

  it('чужое действующее лицо и неверный вид — прежние ответы, лимит им не мешает', async () => {
    const staff = await actorFor(STAFF_MAIN)
    await expect(studentDal.createMyRequest(staff, { kind: 'dean_certificate' }, fresh())).rejects.toMatchObject({ name: 'ForbiddenError' })
    const b = await actorFor(STUDENT_B)
    expect(await studentDal.createMyRequest(b, { kind: 'выдуманный' as 'dean_certificate' }, fresh())).toBeNull()
  })
})

describe('лимит смены статуса: 30 в минуту на пару «аккаунт сотрудника и адрес»', () => {
  const requestIds: string[] = []
  afterAll(async () => {
    await withOwner(async (c) => {
      await c.query(`delete from notifications where link = any($1)`, [requestIds.map((id) => `/requests/${id}`)])
      await c.query(`delete from requests where id = any($1)`, [requestIds])
    })
  })

  async function newSubmitted(count: number): Promise<string[]> {
    const res = await withOwner((c) =>
      c.query(
        `insert into requests (student_id, kind, status, ip, purpose)
         select u.id, 'dean_certificate', 'submitted', 'bulk-status', 'on_demand' from users u, generate_series(1, $2::int) where u.login = $1
         returning id`,
        [STUDENT_B.login, count],
      ),
    )
    const ids = res.rows.map((r) => r.id as string)
    requestIds.push(...ids)
    return ids
  }

  it('31-я смена за минуту с одного адреса — отказ «rate_limited»; с другого адреса проходит; через минуту снова', async () => {
    const staff = await actorFor(STAFF_MAIN)
    const ids = await newSubmitted(33)
    const x = freshIp()
    const y = freshIp()
    for (const id of ids.slice(0, 30)) {
      expect(await staffDal.changeRequestStatus(staff, id, { target: 'in_progress' }, x)).toEqual({ ok: true, status: 'in_progress' })
    }
    expect(await staffDal.changeRequestStatus(staff, ids[30]!, { target: 'in_progress' }, x)).toEqual({ ok: false, reason: 'rate_limited' })
    const status = await withOwner((c) => c.query('select status from requests where id = $1', [ids[30]]))
    expect(status.rows[0].status, 'отказанная смена ничего не изменила').toBe('submitted')
    expect(await staffDal.changeRequestStatus(staff, ids[30]!, { target: 'in_progress' }, y)).toEqual({ ok: true, status: 'in_progress' })
    await withOwner((c) => c.query(`update request_events set created_at = now() - interval '2 minutes' where ip = $1`, [x]))
    expect(await staffDal.changeRequestStatus(staff, ids[31]!, { target: 'in_progress' }, x)).toEqual({ ok: true, status: 'in_progress' })
  })

  it('40 одновременных смен с одного адреса дают не больше 30', async () => {
    const staff = await actorFor(STAFF_MAIN)
    const ids = await newSubmitted(40)
    const x = freshIp()
    const results = await Promise.all(ids.map((id) => staffDal.changeRequestStatus(staff, id, { target: 'in_progress' }, x)))
    expect(results.filter((r) => r.ok)).toHaveLength(30)
    expect(results.filter((r) => !r.ok && r.reason === 'rate_limited')).toHaveLength(10)
  })
})
