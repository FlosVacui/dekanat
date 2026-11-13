// Страницы и действия, которые пишут в журнал событий безопасности (пакет 3.1, правки по RV-3.1-1):
//  - R-3.1-4: чужая или несуществующая заявка по номеру — событие access_denied_record, номера заявки в записи нет;
//  - R-3.1-3 (г): отказ смены статуса по лимиту — текст на экране сотрудника и событие status_limit;
//  - R-3.1-8: один номер запроса на вызов действия входа.
// Действия и страницы вызываются как функции; кука, заголовки и переходы Next.js подменены: адрес и вошедшего задаёт тест,
// а вход, сессия и база настоящие.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ actor: null as unknown, ip: 'unknown' }))

vi.mock('@/server/auth/cookie', () => ({
  getCurrentActor: async () => state.actor,
  getClientIp: async () => state.ip,
  setSessionCookie: async () => undefined,
  logout: async () => undefined,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  forbidden: () => {
    throw new Error('NEXT_FORBIDDEN')
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

import { changeStatusAction } from '@/app/staff/requests/[id]/actions'
import { loginAction } from '@/app/login/actions'
import RequestPage from '@/app/requests/[id]/page'
import StaffRequestPage from '@/app/staff/requests/[id]/page'
import { closeDb } from '@/server/dal/client'
import { ALT_STUDENT, STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor, freshIp, withOwner } from './helpers'

afterAll(closeDb)

let written: string[] = []
beforeEach(() => {
  written = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk))
    return true
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

function records(): Record<string, unknown>[] {
  return written
    .join('')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((r) => typeof r.event === 'string')
}

async function requestIdOf(login: string): Promise<string> {
  const res = await withOwner((c) =>
    c.query('select r.id from requests r join users u on u.id = r.student_id where u.login = $1 order by r.created_at limit 1', [login]),
  )
  const id = res.rows[0]?.id as string | undefined
  if (!id) throw new Error(`у ${login} нет заявок`)
  return id
}

describe('отказ по чужой или несуществующей записи пишет access_denied_record (R-3.1-4)', () => {
  it('страница студента: чужая заявка и несуществующий номер — 404 и событие; своя заявка — без события', async () => {
    const actor = await actorFor(STUDENT_A)
    state.actor = actor
    state.ip = freshIp()
    const foreign = await requestIdOf(STUDENT_B.login)
    const own = await requestIdOf(STUDENT_A.login)
    written = []

    for (const id of [foreign, '00000000-0000-4000-8000-000000000000', 'не-номер']) {
      await expect(RequestPage({ params: Promise.resolve({ id }) }), id).rejects.toThrow('NEXT_NOT_FOUND')
    }
    const denied = records()
    expect(denied.map((r) => r.event)).toEqual(['access_denied_record', 'access_denied_record', 'access_denied_record'])
    for (const record of denied) {
      expect(Object.keys(record).sort()).toEqual(['event', 'ip', 'requestId', 'time', 'userId'])
      expect(record.userId).toBe((actor as { userId: string }).userId)
      expect(record.ip).toBe(state.ip)
    }
    // Номера заявки в журнале нет: ни чужого, ни введённого.
    const output = written.join('')
    for (const id of [foreign, '00000000-0000-4000-8000-000000000000', 'не-номер']) expect(output).not.toContain(id)

    written = []
    await expect(RequestPage({ params: Promise.resolve({ id: own }) })).resolves.toBeTruthy()
    expect(records()).toEqual([])
  })

  it('страница сотрудника: заявка другого набора и несуществующий номер — 404 и событие; заявка своего набора — без события', async () => {
    const actor = await actorFor(STAFF_MAIN)
    state.actor = actor
    state.ip = freshIp()
    const foreign = await requestIdOf(ALT_STUDENT.login)
    const own = await requestIdOf(STUDENT_A.login)
    written = []

    for (const id of [foreign, '00000000-0000-4000-8000-000000000000']) {
      await expect(StaffRequestPage({ params: Promise.resolve({ id }) }), id).rejects.toThrow('NEXT_NOT_FOUND')
    }
    const denied = records()
    expect(denied.map((r) => r.event)).toEqual(['access_denied_record', 'access_denied_record'])
    for (const record of denied) {
      expect(record.userId).toBe((actor as { userId: string }).userId)
      expect(record.ip).toBe(state.ip)
    }
    expect(written.join('')).not.toContain(foreign)

    written = []
    await expect(StaffRequestPage({ params: Promise.resolve({ id: own }) })).resolves.toBeTruthy()
    expect(records()).toEqual([])
  })
})

describe('смена статуса по лимиту: текст на экране сотрудника и событие status_limit (R-3.1-3 г)', () => {
  const requestIds: string[] = []
  afterAll(async () => {
    await withOwner(async (c) => {
      await c.query(`delete from notifications where link = any($1)`, [requestIds.map((id) => `/requests/${id}`)])
      await c.query(`delete from requests where id = any($1)`, [requestIds])
    })
  })

  it('31-я смена за минуту с одного адреса: текст отказа, статус не изменён, одна запись status_limit с номером пользователя и адресом', async () => {
    const actor = await actorFor(STAFF_MAIN)
    state.actor = actor
    state.ip = freshIp()
    const created = await withOwner((c) =>
      c.query(
        `insert into requests (student_id, kind, status, ip, purpose)
         select u.id, 'dean_certificate', 'submitted', 'bulk-status-log', 'on_demand' from users u, generate_series(1, 31) where u.login = $1 returning id`,
        [STUDENT_B.login],
      ),
    )
    const ids = created.rows.map((r) => r.id as string)
    requestIds.push(...ids)
    written = []

    const submit = (requestId: string) => {
      const form = new FormData()
      form.set('requestId', requestId)
      form.set('target', 'in_progress')
      return changeStatusAction({ message: null, ok: false }, form)
    }
    for (const id of ids.slice(0, 30)) expect(await submit(id)).toEqual({ ok: true, message: 'Статус сохранён' })
    expect(records().filter((r) => r.event === 'status_limit')).toEqual([])

    const refused = await submit(ids[30]!)
    expect(refused).toEqual({ ok: false, message: 'Слишком много смен статуса за минуту. Подождите минуту и повторите' })
    const status = await withOwner((c) => c.query('select status from requests where id = $1', [ids[30]]))
    expect(status.rows[0].status, 'отказанная смена ничего не изменила').toBe('submitted')

    const limited = records().filter((r) => r.event === 'status_limit')
    expect(limited).toHaveLength(1)
    expect(limited[0]).toMatchObject({ event: 'status_limit', userId: (actor as { userId: string }).userId, ip: state.ip })
    expect(Object.keys(limited[0]!).sort()).toEqual(['event', 'ip', 'requestId', 'time', 'userId'])
    expect(written.join('')).not.toContain(ids[30]!)
  })
})

describe('номер запроса: один на вызов действия входа (R-3.1-8)', () => {
  it('закрытие логина и неудачный вход одного вызова несут один номер; другой вызов — другой', async () => {
    const login = ALT_STUDENT.login
    await withOwner((c) => c.query(`insert into login_streaks (login, fails) values ($1, 99) on conflict (login) do update set fails = 99`, [login]))
    try {
      const attempt = async () => {
        state.ip = freshIp()
        const form = new FormData()
        form.set('login', login)
        form.set('password', 'неверный-пароль-журнал')
        return loginAction({ error: null, login: '' }, form)
      }
      written = []
      expect((await attempt()).error).toBe('Неверный логин или пароль')
      const first = records()
      expect(first.map((r) => r.event)).toEqual(['login_closed', 'login_failed'])
      expect(first[0]!.requestId).toBe(first[1]!.requestId)

      written = []
      await attempt()
      const second = records()
      expect(second.map((r) => r.event)).toEqual(['login_failed'])
      expect(second[0]!.requestId).not.toBe(first[0]!.requestId)
    } finally {
      await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
    }
  })
})
