'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { loginAction, type LoginState } from './actions'

const initial: LoginState = { error: null, login: '' }
const ERROR_ID = 'login-error'

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initial)
  // Сообщение об отказе связано с обоими полями для экранных чтецов (aria-describedby) и объявляется само (role="alert").
  const describedBy = state.error ? ERROR_ID : undefined
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <label className="flex flex-col gap-1 text-sm">
        Логин
        {/* Введённый логин после отказа остаётся в поле (defaultValue из ответа сервера), пароль — нет. */}
        <input
          name="login"
          autoComplete="username"
          aria-required="true"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={describedBy}
          maxLength={128}
          defaultValue={state.login}
          key={state.login}
          className="min-h-11 rounded border border-neutral-400 bg-white px-3 text-base"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Пароль
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          aria-required="true"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={describedBy}
          maxLength={256}
          className="min-h-11 rounded border border-neutral-400 bg-white px-3 text-base"
        />
      </label>
      {state.error ? (
        <p id={ERROR_ID} role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        Войти
      </Button>
    </form>
  )
}
