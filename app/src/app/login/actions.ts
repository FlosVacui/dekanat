'use server'

import { redirect } from 'next/navigation'
import { authenticate } from '@/server/auth/login'
import { getClientIp, logout, setSessionCookie } from '@/server/auth/cookie'
import { newRequestId } from '@/server/security-log'
import { EMPTY_FIELDS_TEXT, loginErrorText } from './messages'

export interface LoginState {
  /** Текст отказа для экрана; null — отказа нет. */
  error: string | null
  /** Введённый логин возвращается в поле. Пароль не возвращается никогда. */
  login: string
}

const MAX_LOGIN_ECHO = 128

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const login = formData.get('login')
  const password = formData.get('password')
  if (typeof login !== 'string' || typeof password !== 'string') {
    return { error: loginErrorText({ ok: false, reason: 'invalid' }), login: '' }
  }
  const echo = login.slice(0, MAX_LOGIN_ECHO)
  // Пустые поля: подсказка без обращения к базе.
  if (!login.trim() || !password) return { error: EMPTY_FIELDS_TEXT, login: echo }
  // Один номер запроса на вызов действия: события одного входа в журнале связаны им (R-3.1-8).
  const outcome = await authenticate(login, password, await getClientIp(), newRequestId())
  if (!outcome.ok) return { error: loginErrorText(outcome), login: echo }
  await setSessionCookie(outcome.token, outcome.expiresAt)
  // Адрес возврата не принимается: после входа всегда на главную, роль выбирает сервер по сессии.
  redirect('/')
}

export async function logoutAction(): Promise<void> {
  await logout()
  redirect('/login')
}
