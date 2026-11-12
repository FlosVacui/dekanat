'use server'

import { redirect } from 'next/navigation'
import { authenticate } from '@/server/auth/login'
import { getClientIp, logout, setSessionCookie } from '@/server/auth/cookie'

export interface LoginState {
  error: string | null
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const login = formData.get('login')
  const password = formData.get('password')
  if (typeof login !== 'string' || typeof password !== 'string') {
    return { error: 'Неверный логин или пароль' }
  }
  const outcome = await authenticate(login, password, await getClientIp())
  if (!outcome.ok) {
    return {
      error: outcome.reason === 'busy' ? 'Сервер занят. Попробуйте через минуту' : 'Неверный логин или пароль',
    }
  }
  await setSessionCookie(outcome.token, outcome.expiresAt)
  // Адрес возврата не принимается: после входа всегда на главную, роль выбирает сервер по сессии.
  redirect('/')
}

export async function logoutAction(): Promise<void> {
  await logout()
  redirect('/login')
}
