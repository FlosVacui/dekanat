import { randomInt } from 'node:crypto'
import pg from 'pg'
import { vi } from 'vitest'
import { authenticate } from '@/server/auth/login'
import { resolveActor, type Actor } from '@/server/auth/session'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'

/** Свежий адрес из частной сети: каждый вызов — «новый посетитель» со своими счётчиками. Адреса не повторяются в прогоне. */
const usedAddresses = new Set<string>()
export function freshIp(): string {
  for (;;) {
    const ip = `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`
    if (!usedAddresses.has(ip)) {
      usedAddresses.add(ip)
      return ip
    }
  }
}

/** Свежая сеть IPv6 /64 из документационного диапазона: первые четыре группы адреса. */
export function freshNet6(): string {
  return `2001:db8:${randomInt(0, 0x10000).toString(16)}:${randomInt(0, 0x10000).toString(16)}`
}

// Стенд для прежних тестов слоя (пакет 3.1). Они подают заявки и меняют статусы с адресом 'test' или без адреса, и для
// лимитов записи (10 заявок в сутки и 30 смен в минуту на пару «аккаунт и адрес») это один посетитель. Лимиты не
// выключаются и не повышаются: прежним вызовам подставляется свежий адрес, как будто каждый вызов пришёл от нового
// посетителя. Проверки в тестах те же. Вызовы с любым другим адресом идут как есть, поэтому тесты лимитов
// передают свои адреса и подмены не замечают.
const realCreateMyRequest = studentDal.createMyRequest
vi.spyOn(studentDal, 'createMyRequest').mockImplementation((actor, input, ip) =>
  realCreateMyRequest(actor, input, ip === 'test' ? freshIp() : ip),
)
const realChangeRequestStatus = staffDal.changeRequestStatus
vi.spyOn(staffDal, 'changeRequestStatus').mockImplementation((actor, requestId, input, ip) =>
  realChangeRequestStatus(actor, requestId, input, ip ?? freshIp()),
)

/** Вход настоящим путём: пароль, хеш, сессия в базе, действующее лицо из сессии. Другого способа получить Actor нет. */
export async function actorFor(account: { login: string; password: string }, ip: string = freshIp()): Promise<Actor> {
  const outcome = await authenticate(account.login, account.password, ip)
  if (!outcome.ok) throw new Error(`Вход под ${account.login} не удался: ${outcome.reason}`)
  const actor = await resolveActor(outcome.token)
  if (!actor) throw new Error('Сессия не нашлась')
  return actor
}

/** Подключение владельца базы для проверок «что лежит в таблицах». Только в тестах. */
export async function withOwner<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = process.env.TEST_DATABASE_OWNER_URL
  if (!url) throw new Error('Нет TEST_DATABASE_OWNER_URL')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

/**
 * Пара «адрес и логин» ждёт ещё `seconds` секунд, счётчик неверных — `fails`. Метка выставляется запросом к базе:
 * тест не надеется, что шаги уложатся в секунду после пятой попытки (R-3.1-2). Строка пары должна уже существовать.
 */
export async function holdPair(ip: string, login: string, seconds = 120, fails = 5): Promise<void> {
  const res = await withOwner((c) =>
    c.query(
      `update login_attempts set fails = $3, next_allowed_at = clock_timestamp() + $4 * interval '1 second', last_attempt_at = clock_timestamp()
       where ip = $1 and login = $2`,
      [ip, login, fails, seconds],
    ),
  )
  if (res.rowCount !== 1) throw new Error('holdPair: строки пары нет, сначала нужна хотя бы одна попытка')
}
