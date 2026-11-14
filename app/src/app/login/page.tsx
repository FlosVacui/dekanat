import Image from 'next/image'
import { LoginForm } from './login-form'

// Э-1 «Вход» (D-2.2-system, раздел 6, абзац «Вход»): знак 88 px по центру, заголовок, строка под ним, форма в карточке.
// Шапки и вкладок нет, подвал с пометкой «Концепт…» стоит в layout.tsx. Сама пометка продублирована золотой плашкой
// выше формы: она видна без прокрутки на 360×800 (ТР-6).
export default function LoginPage() {
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-[var(--sp-4)] px-[var(--pad-x)] py-[var(--sp-5)]">
      <div className="flex flex-col items-center gap-[var(--sp-2)] text-center">
        <Image src="/owl-512.png" alt="" width={88} height={88} unoptimized priority />
        <h1 className="text-[length:var(--h1-size)] font-[var(--h1-weight)] leading-[1.15]">Деканат в кармане</h1>
        <p className="text-[length:var(--fs-sm)] text-muted">Расписание, оценки и заявки в одном месте</p>
      </div>
      <p
        data-testid="concept-note"
        className="rounded-control bg-accent-2-bg px-[var(--sp-3)] py-[var(--sp-2)] text-center text-[length:var(--fs-sm)] font-bold text-accent-2-text"
      >
        Концепт для конкурса, не официальный сервис вуза
      </p>
      <section className="rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card">
        <h2 className="mb-[var(--sp-3)] text-[length:var(--h2-size)] font-[var(--h2-weight)] leading-tight text-[color:var(--h2-color)]">
          Вход в личный кабинет
        </h2>
        <LoginForm />
      </section>
    </main>
  )
}
