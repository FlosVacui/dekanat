'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { loginAction, type LoginState } from './actions'

const initial: LoginState = { error: null }

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initial)
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Логин
        <input
          name="login"
          autoComplete="username"
          required
          maxLength={128}
          className="min-h-11 rounded border border-neutral-400 bg-white px-3 text-base"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Пароль
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          className="min-h-11 rounded border border-neutral-400 bg-white px-3 text-base"
        />
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        Войти
      </Button>
    </form>
  )
}
