import 'server-only'
import { randomUUID } from 'node:crypto'

// Журнал событий безопасности (ADR-0003, «Поправка 12.11.2026»). Одна функция на весь сервер: одна строка JSON
// в стандартный вывод приложения. Таблицы в базе нет: поток неудачных входов не должен растить базу.
// Хранение и предел размера журнала на сервере — пакет 2.5.
//
// В записи только: время, вид события, случайный номер запроса, номер пользователя (если известен), адрес посетителя.
// Номера записи (заявки) в строке нет: адрес страницы с номером заявки — ввод посетителя.
// Пароля, токена сессии, введённой строки логина, ФИО и контактов в записи нет: в поле логина иногда по ошибке
// вводят пароль. Строка собирается через JSON.stringify: перевод строки во вводе не создаёт вторую запись.

export type SecurityEvent =
  | 'login_failed'
  | 'login_wait'
  | 'login_ip_limited'
  | 'login_busy'
  | 'login_closed'
  | 'access_denied_role'
  | 'access_denied_record'
  | 'request_limit'
  | 'status_limit'

export interface SecurityEventFields {
  /** Номер пользователя из базы (UUID). Не введённая строка логина. */
  userId?: string | null
  /** Адрес посетителя после приведения (`normalizeIp`) или «unknown». */
  ip: string
  /**
   * Номер запроса: один на вызов действия или страницы, чтобы события одного входа можно было связать (R-3.1-8).
   * Его создаёт вызывающий через `newRequestId()`. Не передан — запись получает свой.
   */
  requestId?: string
}

const MAX_IP = 64

/** Случайный номер запроса. Действие создаёт его один раз и передаёт во все записи своего вызова. */
export function newRequestId(): string {
  return randomUUID()
}

export function logSecurityEvent(event: SecurityEvent, fields: SecurityEventFields): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    event,
    requestId: fields.requestId ?? newRequestId(),
    userId: fields.userId ?? null,
    ip: String(fields.ip).slice(0, MAX_IP),
  })
  process.stdout.write(`${line}\n`)
}
