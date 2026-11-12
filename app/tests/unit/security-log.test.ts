// Журнал событий безопасности (пакет 3.1, поправка ADR-0003 от 12.11.2026): одна строка JSON в стандартный вывод;
// в записи нет пароля, токена, введённого логина и ФИО (В-03, Ж-02); перевод строки во вводе не создаёт вторую запись (Н-06).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticate } from '@/server/auth/login'
import { closeDb } from '@/server/dal/client'
import { logSecurityEvent, newRequestId } from '@/server/security-log'
import { ALT_STUDENT, STUDENT_A } from './fixtures'
import { freshIp, holdPair, withOwner } from './helpers'

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

/** Записи журнала: строки вывода, разобранные как JSON. Строка, которая не JSON, — провал проверки. */
function records(): Record<string, unknown>[] {
  return written
    .join('')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((r) => typeof r.event === 'string')
}
const events = () => records().map((r) => r.event)

const CANARY = 'PWD-CANARY-7c41e9'

describe('журнал событий безопасности', () => {
  it('неудачный вход записан: время, вид, случайный номер запроса, номер пользователя и адрес — и ничего больше', async () => {
    const ip = freshIp()
    await authenticate(STUDENT_A.login, `${CANARY}-пароль`, ip)
    await authenticate('нет-такого-логина-журнал', `${CANARY}-пароль`, ip)
    const list = records()
    expect(list.map((r) => r.event)).toEqual(['login_failed', 'login_failed'])
    for (const record of list) {
      expect(Object.keys(record).sort()).toEqual(['event', 'ip', 'requestId', 'time', 'userId'])
      expect(record.ip).toBe(ip)
      expect(record.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(new Date(String(record.time)).toString()).not.toBe('Invalid Date')
    }
    expect(list[0]!.userId).toMatch(/^[0-9a-f-]{36}$/)
    expect(list[1]!.userId, 'у выдуманного логина номера пользователя нет').toBeNull()
    expect(list[0]!.requestId).not.toBe(list[1]!.requestId)
  })

  it('в выводе нет пароля-метки, введённой строки логина, токена и ФИО', async () => {
    const ip = freshIp()
    // Пароль по ошибке введён в поле логина: его в журнале быть не должно.
    await authenticate(`${CANARY}-в-поле-логина`, 'другой-пароль', ip)
    await authenticate(STUDENT_A.login, `${CANARY}-пароль`, ip)
    const ok = await authenticate(STUDENT_A.login, STUDENT_A.password, freshIp())
    if (!ok.ok) throw new Error('вход не удался')
    // Журнал обязан быть непустым, иначе поиск ничего не доказывает.
    expect(events().length).toBeGreaterThanOrEqual(2)
    const output = written.join('')
    for (const secret of [CANARY, STUDENT_A.password, ok.token, STUDENT_A.fullName, STUDENT_A.login]) {
      expect(output, `в журнале нашлось «${secret.slice(0, 12)}…»`).not.toContain(secret)
    }
  })

  it('перевод строки во вводе не создаёт вторую запись (Н-06)', async () => {
    const injected = '{"event":"access_denied_role","userId":"подделка"}'
    await authenticate(`подделка\r\n${injected}\r\n`, 'пароль\r\n', `203.0.113.9\r\n${injected}`)
    const lines = written.join('').split('\n').filter((l) => l !== '')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!).event).toBe('login_failed')
    expect(events()).not.toContain('access_denied_role')
    // Прямой вызов функции с переводом строки в адресе: одна строка вывода.
    written = []
    logSecurityEvent('access_denied_role', { userId: null, ip: 'a\r\nb c' })
    expect(written.join('').split('\n').filter((l) => l !== '')).toHaveLength(1)
    expect(written.join('').endsWith('\n')).toBe(true)
  })

  it('отказы «подождите» и «лимит адреса» записаны', async () => {
    const ip = freshIp()
    for (let i = 0; i < 5; i += 1) await authenticate(STUDENT_A.login, 'неверный-пароль', ip)
    // Шестая попытка получает «подождите» не потому, что уложилась в секунду, а потому что метка выставлена запросом.
    await holdPair(ip, STUDENT_A.login, 30)
    await authenticate(STUDENT_A.login, 'неверный-пароль', ip)
    await withOwner((c) => c.query(`insert into login_ip_windows (ip, window_start, attempts) values ($1, now(), 30) on conflict (ip) do update set attempts = 30`, [ip]))
    await authenticate(STUDENT_A.login, 'неверный-пароль', ip)
    expect(events()).toEqual(['login_failed', 'login_failed', 'login_failed', 'login_failed', 'login_failed', 'login_wait', 'login_ip_limited'])
  })

  it('закрытие логина записано один раз, в момент сотой неверной попытки', async () => {
    const login = ALT_STUDENT.login
    await withOwner((c) => c.query(`insert into login_streaks (login, fails) values ($1, 99) on conflict (login) do update set fails = 99`, [login]))
    try {
      await authenticate(login, 'неверный-пароль', freshIp())
      await authenticate(login, 'неверный-пароль', freshIp())
      expect(events()).toEqual(['login_closed', 'login_failed', 'login_failed'])
    } finally {
      await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
    }
  })

  it('номер запроса: переданный действием попадает в обе записи одного входа; не переданный — один на вызов (R-3.1-8)', async () => {
    const login = ALT_STUDENT.login
    await withOwner((c) => c.query(`insert into login_streaks (login, fails) values ($1, 99) on conflict (login) do update set fails = 99`, [login]))
    try {
      const given = newRequestId()
      await authenticate(login, 'неверный-пароль', freshIp(), given)
      let list = records()
      expect(list.map((r) => r.event)).toEqual(['login_closed', 'login_failed'])
      expect(list.map((r) => r.requestId)).toEqual([given, given])

      // Номер не передан: событий два, номер у них один; следующий вызов получает другой.
      await withOwner((c) => c.query(`update login_streaks set fails = 99 where login = $1`, [login]))
      written = []
      await authenticate(login, 'неверный-пароль', freshIp())
      list = records()
      expect(list.map((r) => r.event)).toEqual(['login_closed', 'login_failed'])
      expect(list[0]!.requestId).toBe(list[1]!.requestId)
      expect(list[0]!.requestId).not.toBe(given)
    } finally {
      await withOwner((c) => c.query('delete from login_streaks where login = $1', [login]))
    }
  })

  it('отказ «сервер занят» записан', async () => {
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, i) => authenticate(`занято-${i}`, 'пароль', freshIp())))
    const busy = outcomes.filter((o) => !o.ok && o.reason === 'busy').length
    expect(busy, 'девятый и следующие входы получают «сервер занят»').toBeGreaterThanOrEqual(1)
    expect(events().filter((e) => e === 'login_busy')).toHaveLength(busy)
  })
})
