import { LoginForm } from './login-form'

// Заготовка экрана входа: полный экран Э-1 — этап 2 пакета 2.4.
export default function LoginPage() {
  return (
    <main className="mx-auto max-w-sm p-4">
      <h1 className="mb-1 text-xl font-semibold">Деканат в кармане</h1>
      <p className="mb-4 text-sm text-neutral-700">Концепт для конкурса, не официальный сервис вуза</p>
      <LoginForm />
    </main>
  )
}
