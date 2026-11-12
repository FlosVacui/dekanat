import type { LoginOutcome } from '@/server/auth/login'

// Тексты отказов входа для экрана Э-1. Лежат отдельно от действия: файл с 'use server' экспортирует только
// асинхронные функции. Число секунд приходит с сервера (модуль входа), а не из запроса.

/** Секунды -> «8 с» или «6 мин» (минуты округляются вверх). */
export function formatWait(seconds: number): string {
  return seconds < 60 ? `${Math.max(1, Math.ceil(seconds))} с` : `${Math.ceil(seconds / 60)} мин`
}

export const EMPTY_FIELDS_TEXT = 'Введите логин и пароль'

/** Один текст на вид отказа. «Нет логина», «неверный пароль» и «логин закрыт» читаются одинаково. */
export function loginErrorText(outcome: Exclude<LoginOutcome, { ok: true }>): string {
  switch (outcome.reason) {
    case 'wait':
      return `Слишком много попыток. Повторите через ${formatWait(outcome.retryAfterSeconds)}`
    case 'ip_limited':
      return `С вашего адреса слишком много попыток входа. Повторите через ${formatWait(outcome.retryAfterSeconds)}`
    case 'busy':
      return 'Сервер занят. Попробуйте через минуту'
    default:
      return 'Неверный логин или пароль'
  }
}
