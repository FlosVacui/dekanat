import { LoginForm } from './login-form'

// Э-1 «Вход»: название, пометка «Концепт…» без прокрутки (ТР-6), логин и пароль. Шапки и вкладок нет.
export default function LoginPage() {
  return (
    <main className="mx-auto max-w-sm p-4">
      <h1 className="mb-2 text-2xl font-semibold">Деканат в кармане</h1>
      <p data-testid="concept-note" className="mb-4 rounded border border-amber-700 bg-amber-50 p-2 text-sm text-amber-950">
        Концепт для конкурса, не официальный сервис вуза
      </p>
      <h2 className="mb-2 text-base font-medium">Вход в личный кабинет</h2>
      <LoginForm />
    </main>
  )
}
