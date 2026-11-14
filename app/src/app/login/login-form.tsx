'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { loginAction, type LoginState } from './actions'

const initial: LoginState = { error: null, login: '' }
const ERROR_ID = 'login-error'

// Поле по разделу 5.3 дизайн-системы: высота 52, рамка 2 px --border-strong, скругление --radius-ctl, текст 16 px,
// у ошибки рамка --error, фокус — контур 3 px --focus.
const LABEL = 'flex flex-col gap-1.5 text-[length:var(--fs-sm)] font-bold'
const FIELD =
  'min-h-[var(--control-h)] w-full rounded-control border-2 border-border-strong bg-card px-[var(--sp-4)] text-[length:var(--fs-md)] font-normal text-text focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus aria-[invalid=true]:border-error'

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initial)
  // Номер попытки: каждый ответ сервера — новый объект состояния. Абзац с отказом получает по нему новый ключ и
  // создаётся заново, поэтому тот же текст отказа два раза подряд читается экранным чтецом снова (R-3.1-13).
  const [attempt, setAttempt] = useState({ state, count: 0 })
  if (attempt.state !== state) setAttempt({ state, count: attempt.count + 1 })
  // Сообщение об отказе связано с обоими полями для экранных чтецов (aria-describedby) и объявляется само (role="alert").
  const describedBy = state.error ? ERROR_ID : undefined
  return (
    <form action={action} className="flex flex-col gap-[var(--sp-4)]" noValidate>
      <label className={LABEL}>
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
          className={FIELD}
        />
      </label>
      <label className={LABEL}>
        Пароль
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          aria-required="true"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={describedBy}
          maxLength={256}
          className={FIELD}
        />
      </label>
      {state.error ? (
        <p key={attempt.count} id={ERROR_ID} role="alert" className="flex items-start gap-1.5 text-[length:var(--fs-sm)] font-bold text-error">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18" className="mt-px flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4l9 16H3z" />
            <path d="M12 10v4M12 17.2v.1" />
          </svg>
          <span>{state.error}</span>
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        Войти
      </Button>
    </form>
  )
}
