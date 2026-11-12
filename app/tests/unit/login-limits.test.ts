// Защита входа от перебора (пакет 3.1, ADR-0003): растущая задержка, лимит адреса, закрытие неопубликованного логина,
// одинаковые ответы, параллельный залп, время ответа. Время не ждут: метки сдвигаются в базе (часы базы, now()).
// У каждого теста свои адреса (freshIp): счётчики «адрес и логин» и «адрес» у тестов не пересекаются.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticate, type LoginOutcome } from '@/server/auth/login'
import * as password from '@/server/auth/password'
import { closeDb } from '@/server/dal/client'
import { recordPairAttempt } from '@/server/dal/login-limits'
import { ALT_STUDENT, STUDENT_A } from './fixtures'
import { freshIp, freshNet6, holdPair, withOwner } from './helpers'

vi.mock('@/server/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/password')>()
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) }
})
const verifySpy = vi.mocked(password.verifyPassword)

afterAll(closeDb)
beforeEach(() => {
  verifySpy.mockClear()
})

const WRONG = 'неверный-пароль-3-1'

type Refusal = Exclude<LoginOutcome, { ok: true }>
function refusal(outcome: LoginOutcome): Refusal {
  if (outcome.ok) throw new Error('ждали отказ, получили вход')
  return outcome
}

async function pairRow(ip: string, login: string) {
  const res = await withOwner((c) =>
    c.query(
      // Метки ставятся часами базы в момент выполнения (clock_timestamp), поэтому разность округляется до секунды.
      `select fails, round(extract(epoch from (next_allowed_at - last_attempt_at)))::int as wait, next_allowed_at > now() as waiting
       from login_attempts where ip = $1 and login = $2`,
      [ip, login],
    ),
  )
  return res.rows[0] as { fails: number; wait: number; waiting: boolean } | undefined
}

/** Время ожидания пары прошло: сдвиг метки в базе, а не настоящее ожидание. */
async function waitElapsed(ip: string, login: string): Promise<void> {
  await withOwner((c) =>
    c.query(`update login_attempts set next_allowed_at = now() - interval '1 second' where ip = $1 and login = $2`, [ip, login]),
  )
}

describe('пара «адрес и логин»: пять попыток без задержки, дальше 1, 2, 4 секунды', () => {
  it('задержка растёт 1, 2, 4 секунды; во время ожидания отказ «подождите» с числом секунд и без хеша', async () => {
    const ip = freshIp()
    for (let i = 1; i <= 5; i += 1) {
      expect(await authenticate(STUDENT_A.login, WRONG, ip), `попытка ${i}`).toEqual({ ok: false, reason: 'invalid' })
    }
    // Первое ожидание — 1 с: проверяется по метке в базе, а не по часам.
    expect(await pairRow(ip, STUDENT_A.login)).toMatchObject({ fails: 5, wait: 1 })
    // Метка сдвинута запросом: шестая попытка не должна успеть «до конца секунды».
    await holdPair(ip, STUDENT_A.login, 30)
    verifySpy.mockClear()
    const waiting = refusal(await authenticate(STUDENT_A.login, STUDENT_A.password, ip))
    expect(waiting.reason).toBe('wait')
    expect(waiting.reason === 'wait' && waiting.retryAfterSeconds).toBeGreaterThanOrEqual(29)
    expect(waiting.reason === 'wait' && waiting.retryAfterSeconds).toBeLessThanOrEqual(30)
    expect(verifySpy, 'хеш для отказа «подождите» не считается').not.toHaveBeenCalled()

    // Шестая, седьмая, восьмая попытки после ожидания: 2, 4, 8 секунд.
    for (const [fails, wait] of [
      [6, 2],
      [7, 4],
      [8, 8],
    ] as const) {
      await waitElapsed(ip, STUDENT_A.login)
      expect(await authenticate(STUDENT_A.login, WRONG, ip)).toEqual({ ok: false, reason: 'invalid' })
      expect(await pairRow(ip, STUDENT_A.login)).toMatchObject({ fails, wait })
    }
    const again = refusal(await authenticate(STUDENT_A.login, WRONG, ip))
    expect(again.reason === 'wait' && again.retryAfterSeconds).toBeGreaterThanOrEqual(7)
    expect(again.reason === 'wait' && again.retryAfterSeconds).toBeLessThanOrEqual(8)
  })

  it('ожидание не больше 5 минут', async () => {
    const ip = freshIp()
    await authenticate(STUDENT_A.login, WRONG, ip)
    await withOwner((c) =>
      c.query(`update login_attempts set fails = 40, next_allowed_at = now() - interval '1 second' where ip = $1 and login = $2`, [ip, STUDENT_A.login]),
    )
    expect(await authenticate(STUDENT_A.login, WRONG, ip)).toEqual({ ok: false, reason: 'invalid' })
    expect(await pairRow(ip, STUDENT_A.login)).toMatchObject({ fails: 41, wait: 300 })
    const waiting = refusal(await authenticate(STUDENT_A.login, WRONG, ip))
    expect(waiting.reason === 'wait' && waiting.retryAfterSeconds).toBeGreaterThanOrEqual(299)
    expect(waiting.reason === 'wait' && waiting.retryAfterSeconds).toBeLessThanOrEqual(300)
  })

  it('верный вход сбрасывает счётчик пары', async () => {
    const ip = freshIp()
    for (let i = 0; i < 3; i += 1) await authenticate(STUDENT_A.login, WRONG, ip)
    expect(await pairRow(ip, STUDENT_A.login)).toMatchObject({ fails: 3 })
    expect((await authenticate(STUDENT_A.login, STUDENT_A.password, ip)).ok).toBe(true)
    expect(await pairRow(ip, STUDENT_A.login)).toBeUndefined()
    // С чистого листа: пять неверных подряд снова без задержки, и только после них идёт ожидание.
    for (let i = 0; i < 5; i += 1) {
      expect(await authenticate(STUDENT_A.login, WRONG, ip)).toEqual({ ok: false, reason: 'invalid' })
    }
    await holdPair(ip, STUDENT_A.login, 30)
    expect(refusal(await authenticate(STUDENT_A.login, WRONG, ip)).reason).toBe('wait')
  })

  it('15 минут тишины сбрасывают счётчик', async () => {
    const ip = freshIp()
    for (let i = 0; i < 5; i += 1) await authenticate(STUDENT_A.login, WRONG, ip)
    await holdPair(ip, STUDENT_A.login, 30)
    expect(refusal(await authenticate(STUDENT_A.login, WRONG, ip)).reason).toBe('wait')
    await withOwner((c) =>
      c.query(
        `update login_attempts set last_attempt_at = now() - interval '16 minutes', next_allowed_at = now() - interval '15 minutes'
         where ip = $1 and login = $2`,
        [ip, STUDENT_A.login],
      ),
    )
    expect(await authenticate(STUDENT_A.login, WRONG, ip)).toEqual({ ok: false, reason: 'invalid' })
    expect(await pairRow(ip, STUDENT_A.login)).toMatchObject({ fails: 1, wait: 0 })
    // Тишина короче 15 минут не сбрасывает.
    await withOwner((c) =>
      c.query(`update login_attempts set fails = 5, last_attempt_at = now() - interval '14 minutes', next_allowed_at = now() - interval '13 minutes' where ip = $1 and login = $2`, [ip, STUDENT_A.login]),
    )
    await authenticate(STUDENT_A.login, WRONG, ip)
    expect(await pairRow(ip, STUDENT_A.login)).toMatchObject({ fails: 6 })
  })

  it('счётчик по приведённой строке логина: регистр и пробелы — один счётчик', async () => {
    const ip = freshIp()
    await authenticate(`  ${STUDENT_A.login.toUpperCase()} `, WRONG, ip)
    await authenticate(STUDENT_A.login, WRONG, ip)
    const rows = await withOwner((c) => c.query('select login, fails from login_attempts where ip = $1', [ip]))
    expect(rows.rows).toEqual([{ login: STUDENT_A.login, fails: 2 }])
  })

  it('счётчик пары у другого адреса и у другого логина свой', async () => {
    const x = freshIp()
    const y = freshIp()
    for (let i = 0; i < 6; i += 1) await authenticate(STUDENT_A.login, WRONG, x)
    expect(refusal(await authenticate(STUDENT_A.login, WRONG, x)).reason).toBe('wait')
    expect(await authenticate(STUDENT_A.login, WRONG, y)).toEqual({ ok: false, reason: 'invalid' })
    expect(await authenticate(ALT_STUDENT.login, WRONG, x)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('IPv6: адреса одной сети /64 делят счётчики, адреса разных сетей — нет', async () => {
    const net = freshNet6()
    for (let i = 0; i < 6; i += 1) await authenticate(STUDENT_A.login, WRONG, `${net}::${i + 1}`)
    expect(refusal(await authenticate(STUDENT_A.login, WRONG, `${net}:aaaa:bbbb:cccc:dddd`)).reason).toBe('wait')
    expect(await authenticate(STUDENT_A.login, WRONG, `${freshNet6()}::1`)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })
})

describe('время в запросах счётчиков — часы базы, а не начало запроса (R-3.1-1)', () => {
  it('40 одновременных попыток одной пары при нулевом счётчике: ложных «подождите» нет, пока неверных меньше пяти', async () => {
    // Несколько раундов: гонка плавающая, один раунд на старом коде проходил бы иногда.
    for (let round = 0; round < 5; round += 1) {
      const ip = freshIp()
      const outcomes = await Promise.all(Array.from({ length: 40 }, () => recordPairAttempt(ip, STUDENT_A.login)))
      const allowed = outcomes.filter((o) => o.allowed).length
      // Свободны первые пять попыток: четыре без задержки и пятая, после которой ставится ожидание.
      expect(allowed, `раунд ${round}: принято попыток`).toBeGreaterThanOrEqual(5)
      const row = await pairRow(ip, STUDENT_A.login)
      expect(row?.fails, `раунд ${round}: счётчик равен числу принятых`).toBe(allowed)
      // Отказано ровно столько, сколько не принято, и каждому отказу назван срок не меньше секунды.
      for (const o of outcomes) if (!o.allowed) expect(o.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    }
  })

  it('40 пар, у каждой пять одновременных попыток: все пять приняты, ложного «подождите» нет ни у одной', async () => {
    // Пять попыток свободны. Отказ у любой из них — отказ при счётчике меньше пяти, то есть ложный.
    const ips = Array.from({ length: 40 }, () => freshIp())
    const outcomes = await Promise.all(ips.flatMap((ip) => Array.from({ length: 5 }, () => recordPairAttempt(ip, STUDENT_A.login))))
    expect(outcomes.filter((o) => !o.allowed).length, 'ложных отказов при счётчике меньше пяти').toBe(0)
  })

  it('то же через вход: три одновременных верных входа одной пары принимаются все', async () => {
    for (let round = 0; round < 5; round += 1) {
      const ip = freshIp()
      const outcomes = await Promise.all(Array.from({ length: 3 }, () => authenticate(STUDENT_A.login, STUDENT_A.password, ip)))
      expect(outcomes.map((o) => (o.ok ? 'ok' : o.reason)), `раунд ${round}`).toEqual(['ok', 'ok', 'ok'])
    }
  })
})

describe('параллельный залп (В-04)', () => {
  it('50 одновременных неверных попыток на одну пару: хеш считается не больше чем для пяти', async () => {
    const ip = freshIp()
    const outcomes = await Promise.all(Array.from({ length: 50 }, () => authenticate(STUDENT_A.login, WRONG, ip)))
    const hashed = verifySpy.mock.calls.length
    expect(hashed, 'вызовов хеша').toBeLessThanOrEqual(5)
    expect(hashed).toBeGreaterThanOrEqual(1)
    const kinds = outcomes.map((o) => (o.ok ? 'ok' : o.reason))
    expect(kinds.filter((k) => k === 'invalid').length).toBeLessThanOrEqual(5)
    // Остальные получили «подождите» или лимит адреса (из 50 с одного адреса принимаются только первые 30), ни одной ошибки.
    expect(kinds.every((k) => ['invalid', 'wait', 'ip_limited', 'busy'].includes(k))).toBe(true)
    expect(kinds.filter((k) => k === 'wait').length + kinds.filter((k) => k === 'ip_limited').length).toBeGreaterThanOrEqual(45)
  })

  it('залп на выдуманный логин ограничен так же: хеш не больше чем для пяти', async () => {
    const ip = freshIp()
    await Promise.all(Array.from({ length: 25 }, () => authenticate('выдуманный-залп-3-1', WRONG, ip)))
    expect(verifySpy.mock.calls.length, 'вызовов хеша').toBeLessThanOrEqual(5)
    expect(verifySpy.mock.calls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('залпы на счётчики адреса и логина (R-3.1-3 б, в)', () => {
  it('50 одновременных попыток с одного адреса на разные логины: хеш считается не больше 30 раз, принято ровно 30', async () => {
    const ip = freshIp()
    const outcomes = await Promise.all(Array.from({ length: 50 }, (_, i) => authenticate(`выдуманный-адрес-залп-${i}`, WRONG, ip)))
    // Считаем вызовы хеша, а не ответы: очередь хеша — восемь, часть входов получит «сервер занят», но и она хеша не считает.
    expect(verifySpy.mock.calls.length, 'вызовов хеша').toBeLessThanOrEqual(30)
    expect(verifySpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    const kinds = outcomes.map((o) => (o.ok ? 'ok' : o.reason))
    expect(kinds.filter((k) => k === 'ip_limited'), 'отказов по лимиту адреса').toHaveLength(20)
    expect(kinds.every((k) => ['invalid', 'busy', 'ip_limited'].includes(k))).toBe(true)
    const row = await withOwner((c) => c.query('select attempts from login_ip_windows where ip = $1', [ip]))
    expect(row.rows[0], 'счётчик адреса не потерял попыток и не вышел за предел').toEqual({ attempts: 30 })
  })

  it('100 одновременных неверных попыток на логин с неопубликованным паролем с разных адресов: счётчик логина не теряет попыток', async () => {
    const login = ALT_STUDENT.login
    await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
    try {
      const outcomes = await Promise.all(Array.from({ length: 100 }, () => authenticate(login, WRONG, freshIp())))
      const kinds = outcomes.map((o) => (o.ok ? 'ok' : o.reason))
      expect(kinds.every((k) => k === 'invalid' || k === 'busy'), `виды отказов: ${[...new Set(kinds)].join(', ')}`).toBe(true)
      // Счётчик логина растёт до хеша: «сервер занят» попытку не стирает. Хеш при этом считался не для всех.
      expect(verifySpy.mock.calls.length, 'вызовов хеша').toBeLessThan(100)
      const row = await withOwner((c) => c.query('select fails from login_streaks where login = $1', [login]))
      expect(row.rows[0], 'сто попыток — сто в счётчике').toEqual({ fails: 100 })
      // Сто неверных подряд закрывают вход: верный пароль теперь отвечает как неверный.
      expect(await authenticate(login, ALT_STUDENT.password, freshIp())).toEqual({ ok: false, reason: 'invalid' })
    } finally {
      await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
    }
  }, 120_000)

  it('время ответа: неопубликованный логин с неверным паролем и выдуманный логин — медианы нижней половины различаются меньше чем на четверть', async () => {
    // Лишняя запись счётчика логина (recordLoginStreak) у неопубликованного логина не должна быть заметна по времени.
    const login = ALT_STUDENT.login
    await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
    try {
      await authenticate(login, WRONG, freshIp())
      await authenticate('нет-такого-логина-3-1', WRONG, freshIp())
      const real: number[] = []
      const fake: number[] = []
      for (let i = 0; i < 15; i += 1) {
        let started = performance.now()
        await authenticate(login, WRONG, freshIp())
        real.push(performance.now() - started)
        started = performance.now()
        await authenticate('нет-такого-логина-3-1', WRONG, freshIp())
        fake.push(performance.now() - started)
      }
      const median = (xs: number[]) => {
        const lower = [...xs].sort((a, b) => a - b).slice(0, Math.ceil(xs.length / 2))
        return lower[Math.floor(lower.length / 2)]!
      }
      const mReal = median(real)
      const mFake = median(fake)
      console.log(`Время ответа, неопубликованный логин: ${mReal.toFixed(0)} мс, нет логина ${mFake.toFixed(0)} мс, разность ${Math.abs(mReal - mFake).toFixed(0)} мс`)
      expect(Math.abs(mReal - mFake)).toBeLessThan(Math.max(mReal, mFake) / 4)
    } finally {
      await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
    }
  }, 120_000)
})

describe('одинаковый ответ на «нет логина», «неверный пароль», «логин закрыт» (В-05)', () => {
  it('по семь неверных попыток на настоящий и на выдуманный логин с разных адресов: виды отказа и секунды совпадают попарно', async () => {
    const realIp = freshIp()
    const fakeIp = freshIp()
    const real: string[] = []
    const fake: string[] = []
    const describeOutcome = (o: LoginOutcome) => (o.ok ? 'ok' : 'retryAfterSeconds' in o ? `${o.reason}:${o.retryAfterSeconds}` : o.reason)
    for (let i = 0; i < 7; i += 1) {
      real.push(describeOutcome(await authenticate(STUDENT_A.login, WRONG, realIp)))
      fake.push(describeOutcome(await authenticate('нет-такого-логина-3-1', WRONG, fakeIp)))
      if (i === 4) {
        // После пятой попытки обеим парам выставлено одинаковое ожидание запросом к базе: шестая и седьмая не зависят от часов.
        await holdPair(realIp, STUDENT_A.login, 120)
        await holdPair(fakeIp, 'нет-такого-логина-3-1', 120)
      }
    }
    expect(fake).toEqual(real)
    // Пять «неверно», затем «подождите» с одним и тем же числом секунд.
    expect(real.slice(0, 5)).toEqual(Array(5).fill('invalid'))
    expect(real[5]).toMatch(/^wait:\d+$/)
    expect(real[6]).toBe(real[5])
  })

  it('закрытый логин отвечает как неверный пароль: тот же вид отказа, хеш считается', async () => {
    const login = ALT_STUDENT.login
    await withOwner((c) => c.query(`insert into login_streaks (login, fails) values ($1, 100) on conflict (login) do update set fails = 100`, [login]))
    try {
      verifySpy.mockClear()
      const closedCorrect = await authenticate(login, ALT_STUDENT.password, freshIp())
      const wrong = await authenticate(login, WRONG, freshIp())
      const unknown = await authenticate('нет-такого-логина-3-1', WRONG, freshIp())
      expect(closedCorrect).toEqual({ ok: false, reason: 'invalid' })
      expect(wrong).toEqual(closedCorrect)
      expect(unknown).toEqual(closedCorrect)
      expect(verifySpy.mock.calls.length, 'хеш для закрытого логина считается').toBe(3)
    } finally {
      await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
    }
  })

  it('время ответа: медианы «нет логина» и «неверный пароль» по 15 замеров различаются меньше чем на четверть', async () => {
    // Порог — выбор проекта: четверть медианы (около 80 мс при хеше в 0,3 с). Замеры чередуются, у каждого свой адрес.
    await authenticate(STUDENT_A.login, WRONG, freshIp())
    await authenticate('нет-такого-логина-3-1', WRONG, freshIp())
    const real: number[] = []
    const fake: number[] = []
    for (let i = 0; i < 15; i += 1) {
      let started = performance.now()
      await authenticate(STUDENT_A.login, WRONG, freshIp())
      real.push(performance.now() - started)
      started = performance.now()
      await authenticate('нет-такого-логина-3-1', WRONG, freshIp())
      fake.push(performance.now() - started)
    }
    // Медиана нижней половины замеров: выбросы от загруженной машины (сборка мусора, соседние процессы) в неё не попадают.
    const median = (xs: number[]) => {
      const lower = [...xs].sort((a, b) => a - b).slice(0, Math.ceil(xs.length / 2))
      return lower[Math.floor(lower.length / 2)]!
    }
    const mReal = median(real)
    const mFake = median(fake)
    console.log(`Время ответа: неверный пароль ${mReal.toFixed(0)} мс, нет логина ${mFake.toFixed(0)} мс, разность ${Math.abs(mReal - mFake).toFixed(0)} мс`)
    expect(Math.abs(mReal - mFake)).toBeLessThan(Math.max(mReal, mFake) / 4)
  })
})

describe('адрес: не больше 30 попыток за 10 минут, верных и неверных вместе', () => {
  it('31-я попытка получает отказ с числом секунд до конца окна, хеш для неё не считается; окно закрывается через 10 минут', async () => {
    const ip = freshIp()
    // 30 попыток: разные логины, чтобы пары не ждали; три из них верные.
    for (let batch = 0; batch < 6; batch += 1) {
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, (_, i) => {
          const n = batch * 5 + i
          return n < 3 ? authenticate(STUDENT_A.login, STUDENT_A.password, ip) : authenticate(`выдуманный-${n}`, WRONG, ip)
        }),
      )
      expect(outcomes.every((o) => o.ok || o.reason === 'invalid'), `волна ${batch}`).toBe(true)
    }
    verifySpy.mockClear()
    const refused = refusal(await authenticate(STUDENT_A.login, STUDENT_A.password, ip))
    expect(refused.reason).toBe('ip_limited')
    const seconds = refused.reason === 'ip_limited' ? refused.retryAfterSeconds : 0
    expect(seconds).toBeGreaterThan(500)
    expect(seconds).toBeLessThanOrEqual(600)
    expect(verifySpy, 'хеш для 31-й попытки не считается').not.toHaveBeenCalled()
    // Отказанная попытка счётчик не растит.
    const row = await withOwner((c) => c.query('select attempts from login_ip_windows where ip = $1', [ip]))
    expect(row.rows[0]).toEqual({ attempts: 30 })

    await withOwner((c) => c.query(`update login_ip_windows set window_start = now() - interval '11 minutes' where ip = $1`, [ip]))
    expect((await authenticate(STUDENT_A.login, STUDENT_A.password, ip)).ok).toBe(true)
  }, 120_000)

  it('адрес считается до хеша и до пары: попытка за лимитом не оставляет следа в счётчике пары', async () => {
    const ip = freshIp()
    await withOwner((c) => c.query(`insert into login_ip_windows (ip, window_start, attempts) values ($1, now(), 30)`, [ip]))
    const refused = refusal(await authenticate(STUDENT_A.login, WRONG, ip))
    expect(refused.reason).toBe('ip_limited')
    expect(await pairRow(ip, STUDENT_A.login)).toBeUndefined()
    expect(verifySpy).not.toHaveBeenCalled()
  })

  it('«unknown» — тоже адрес: у всех без заголовка один общий счётчик', async () => {
    await withOwner((c) => c.query(`delete from login_ip_windows where ip = 'unknown'`))
    await authenticate('выдуманный-unknown-1', WRONG, 'unknown')
    await authenticate('выдуманный-unknown-2', WRONG, 'unknown')
    const row = await withOwner((c) => c.query(`select attempts from login_ip_windows where ip = 'unknown'`))
    expect(row.rows[0]).toEqual({ attempts: 2 })
    await withOwner((c) => c.query(`delete from login_ip_windows where ip = 'unknown'`))
  })

  it('IPv6: адреса одной сети /64 делят окно', async () => {
    const net = freshNet6()
    await authenticate('выдуманный-v6-1', WRONG, `${net}::1`)
    await authenticate('выдуманный-v6-2', WRONG, `${net}:1:2:3:4`)
    const row = await withOwner((c) => c.query('select attempts from login_ip_windows where ip = $1', [`${net}::`]))
    expect(row.rows[0]).toEqual({ attempts: 2 })
  })
})

describe('логин, пароль которого не опубликован: 100 неверных подряд закрывают вход (Т-07)', () => {
  const streak = async (login: string) => {
    const r = await withOwner((c) => c.query('select fails from login_streaks where login = $1', [login]))
    return r.rows[0]?.fails as number | undefined
  }

  it('неверные попытки считаются; после 100-й вход закрыт, пока логин не открыт запросом к базе', async () => {
    const login = ALT_STUDENT.login
    await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
    try {
      expect(await authenticate(login, WRONG, freshIp())).toEqual({ ok: false, reason: 'invalid' })
      expect(await streak(login)).toBe(1)
      // 99 неверных подряд уже набрано: сотая закрывает вход (чтобы не считать 100 хешей, счётчик выставлен запросом).
      await withOwner((c) => c.query('update login_streaks set fails = 99 where login = $1', [login]))
      expect(await authenticate(login, WRONG, freshIp())).toEqual({ ok: false, reason: 'invalid' })
      expect(await streak(login)).toBe(100)
      // Верный пароль закрытого логина не принимается и выглядит как неверный.
      expect(await authenticate(login, ALT_STUDENT.password, freshIp())).toEqual({ ok: false, reason: 'invalid' })
      // Команда открывает логин (скрипт пакета 3.8; здесь — прямой запрос): вход снова проходит.
      await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
      expect((await authenticate(login, ALT_STUDENT.password, freshIp())).ok).toBe(true)
    } finally {
      await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
    }
  })

  it('верный вход до закрытия сбрасывает счётчик логина', async () => {
    const login = ALT_STUDENT.login
    await withOwner((c) => c.query(`insert into login_streaks (login, fails) values ($1, 50) on conflict (login) do update set fails = 50`, [login]))
    expect((await authenticate(login, ALT_STUDENT.password, freshIp())).ok).toBe(true)
    expect(await streak(login)).toBeUndefined()
  })

  it('у опубликованного логина счётчика нет: 200 неверных с адреса X — и верный вход с адреса Y проходит сразу', async () => {
    const x = freshIp()
    const y = freshIp()
    for (let i = 0; i < 6; i += 1) await authenticate(STUDENT_A.login, WRONG, x)
    // Остальные неверные попытки до 200 выставлены запросом: 200 хешей тест считать не должен.
    await withOwner((c) =>
      c.query(`update login_attempts set fails = 200, next_allowed_at = now() + interval '300 seconds' where ip = $1 and login = $2`, [x, STUDENT_A.login]),
    )
    await withOwner((c) => c.query(`update login_ip_windows set attempts = 30 where ip = $1`, [x]))
    expect(await streak(STUDENT_A.login)).toBeUndefined()
    // С адреса X вход ждёт, с адреса Y проходит сразу.
    expect(refusal(await authenticate(STUDENT_A.login, STUDENT_A.password, x)).reason).toBe('ip_limited')
    const outcome = await authenticate(STUDENT_A.login, STUDENT_A.password, y)
    expect(outcome.ok).toBe(true)
    // Ни одно число неверных попыток не закрывает публичный логин.
    await withOwner((c) => c.query(`delete from login_ip_windows where ip = $1`, [x]))
    expect(refusal(await authenticate(STUDENT_A.login, STUDENT_A.password, x)).reason).toBe('wait')
  })

  it('выдуманный логин не растит таблицу счётчика логина', async () => {
    const before = await withOwner((c) => c.query('select count(*)::int as n from login_streaks'))
    await authenticate('выдуманный-логин-для-счётчика', WRONG, freshIp())
    const after = await withOwner((c) => c.query('select count(*)::int as n from login_streaks'))
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })
})

describe('лимитов нельзя выключить', () => {
  it('в модулях входа и счётчиков нет чтения окружения и заголовков', async () => {
    const { readFileSync } = await import('node:fs')
    for (const rel of ['../../src/server/auth/login.ts', '../../src/server/dal/login-limits.ts']) {
      const text = readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(text, rel).not.toMatch(/process\.env|NODE_ENV|headers\(|getConfig/)
    }
  })
})
