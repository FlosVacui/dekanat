import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from './client'

// Счётчики перебора входа (ADR-0003, «Защита от перебора»). Все числа — выбор проекта.
// Попытка записывается ДО проверки пароля одной атомарной операцией: `INSERT … ON CONFLICT DO UPDATE … RETURNING`.
// Отказ даётся по её результату. Схема «прочитать счётчик, посчитать хеш, потом увеличить» запрещена: залп
// одновременных запросов прошёл бы проверку целиком. Время считают часы базы в момент выполнения —
// `clock_timestamp()`, а не `now()`: `now()` — начало запроса, и попытка, начатая раньше, но получившая строку позже,
// увидела бы метку «следующая не раньше» из будущего и получила бы ложное «подождите» (замечание R-3.1-1).
// Внутри одного запроса метки могут разойтись на микросекунды; сравнения только `<=` и `<`, равенства по времени нет.
// Выключателя нет: ни переменной, ни заголовка.

/** Пара «адрес и логин»: столько неверных попыток подряд — без задержки. */
export const FREE_ATTEMPTS = 5
/** Потолок ожидания: 5 минут. */
export const MAX_WAIT_SECONDS = 300
/** Пара сбрасывается после 15 минут тишины. */
export const PAIR_QUIET_MINUTES = 15
/** Адрес: не больше 30 попыток входа за 10 минут, верных и неверных вместе. */
export const ADDRESS_LIMIT = 30
export const ADDRESS_WINDOW_MINUTES = 10
/** Логин с неопубликованным паролем: столько неверных подряд — вход закрыт, пока команда не откроет его. */
export const LOGIN_CLOSE_AFTER = 100

export type Admission = { allowed: true } | { allowed: false; retryAfterSeconds: number }

const MAX_KEY = 128

function key(value: string): string {
  return value.slice(0, MAX_KEY)
}

/** Секунды до конца ожидания: округление вверх, не меньше одной. */
function seconds(value: unknown, cap: number): number {
  const n = Math.ceil(Number(value))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, cap) : 1
}

/**
 * Адрес. Окно фиксированное: первая попытка открывает окно в 10 минут, 31-я в нём получает отказ до конца окна.
 * Отказанные попытки счётчик не растят. Считается до хеша: хеш дорогой.
 */
export async function recordAddressAttempt(ip: string): Promise<Admission> {
  const db = getDb()
  const address = key(ip)
  const expired = sql`w.window_start <= clock_timestamp() - make_interval(mins => ${ADDRESS_WINDOW_MINUTES})`
  const admitted = await db.execute(sql`
    INSERT INTO login_ip_windows AS w (ip, window_start, attempts)
    VALUES (${address}, clock_timestamp(), 1)
    ON CONFLICT (ip) DO UPDATE SET
      window_start = CASE WHEN ${expired} THEN clock_timestamp() ELSE w.window_start END,
      attempts = CASE WHEN ${expired} THEN 1 ELSE w.attempts + 1 END
    WHERE ${expired} OR w.attempts < ${ADDRESS_LIMIT}
    RETURNING attempts
  `)
  await pruneSometimes()
  if (admitted.rows.length > 0) return { allowed: true }
  const left = await db.execute(sql`
    SELECT extract(epoch FROM (window_start + make_interval(mins => ${ADDRESS_WINDOW_MINUTES}) - clock_timestamp())) AS s
    FROM login_ip_windows WHERE ip = ${address}
  `)
  return { allowed: false, retryAfterSeconds: seconds(left.rows[0]?.s, ADDRESS_WINDOW_MINUTES * 60) }
}

/**
 * Пара «адрес и логин». Пять попыток подряд — без задержки; дальше ожидание 1, 2, 4 секунды и так до 5 минут.
 * Одна операция: если ожидание ещё идёт, строка не меняется и RETURNING пуст — отказ; иначе попытка засчитана
 * и сразу выставлено время, раньше которого следующая не принимается. Логин — приведённая строка, не номер пользователя.
 */
export async function recordPairAttempt(ip: string, login: string): Promise<Admission> {
  const db = getDb()
  const address = key(ip)
  const name = key(login)
  const stale = sql`a.last_attempt_at < clock_timestamp() - make_interval(mins => ${PAIR_QUIET_MINUTES})`
  const nextFails = sql`(CASE WHEN ${stale} THEN 1 ELSE least(a.fails + 1, 60) END)`
  const admitted = await db.execute(sql`
    INSERT INTO login_attempts AS a (ip, login, fails, next_allowed_at, last_attempt_at)
    VALUES (${address}, ${name}, 1, clock_timestamp(), clock_timestamp())
    ON CONFLICT (ip, login) DO UPDATE SET
      fails = ${nextFails},
      next_allowed_at = clock_timestamp() + (CASE WHEN ${nextFails} < ${FREE_ATTEMPTS} THEN 0
                                      ELSE least(${MAX_WAIT_SECONDS}, power(2, ${nextFails} - ${FREE_ATTEMPTS})) END)
                                * interval '1 second',
      last_attempt_at = clock_timestamp()
    WHERE ${stale} OR a.next_allowed_at <= clock_timestamp()
    RETURNING fails
  `)
  if (admitted.rows.length > 0) return { allowed: true }
  const left = await db.execute(sql`
    SELECT extract(epoch FROM (next_allowed_at - clock_timestamp())) AS s FROM login_attempts WHERE ip = ${address} AND login = ${name}
  `)
  return { allowed: false, retryAfterSeconds: seconds(left.rows[0]?.s, MAX_WAIT_SECONDS) }
}

/**
 * Логин, пароль которого не опубликован: попытка записывается до проверки пароля. Возвращает номер этой попытки
 * подряд. Больше 100 — вход закрыт; закрытый логин отвечает как неверный пароль и хеш для него считается.
 */
export async function recordLoginStreak(login: string): Promise<number> {
  const result = await getDb().execute(sql`
    INSERT INTO login_streaks AS s (login, fails, updated_at) VALUES (${key(login)}, 1, clock_timestamp())
    ON CONFLICT (login) DO UPDATE SET fails = least(s.fails + 1, 100000), updated_at = clock_timestamp()
    RETURNING fails
  `)
  return Number(result.rows[0]?.fails ?? 1)
}

/** Верный вход: счётчик пары и счётчик логина обнуляются. Счётчик адреса не трогаем: он считает и верные попытки. */
export async function clearLoginCounters(ip: string, login: string): Promise<void> {
  const db = getDb()
  await db.execute(sql`DELETE FROM login_attempts WHERE ip = ${key(ip)} AND login = ${key(login)}`)
  await db.execute(sql`DELETE FROM login_streaks WHERE login = ${key(login)}`)
}

/**
 * Чистка устаревших строк, чтобы поток выдуманных логинов не рос в базе без предела. Идёт примерно после каждой
 * пятидесятой попытки и стирает не больше 500 строк каждой таблицы.
 */
async function pruneSometimes(): Promise<void> {
  if (Math.random() >= 0.02) return
  const db = getDb()
  await db.execute(sql`
    DELETE FROM login_attempts WHERE ctid IN (
      SELECT ctid FROM login_attempts WHERE last_attempt_at < clock_timestamp() - make_interval(mins => ${PAIR_QUIET_MINUTES}) LIMIT 500)
  `)
  await db.execute(sql`
    DELETE FROM login_ip_windows WHERE ctid IN (
      SELECT ctid FROM login_ip_windows WHERE window_start < clock_timestamp() - make_interval(mins => ${ADDRESS_WINDOW_MINUTES}) LIMIT 500)
  `)
}
