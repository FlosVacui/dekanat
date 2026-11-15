import { RequestIcon } from './icons'

// Блок «Что сделать вам» (D-2.2-system, 5.9): золотой фон, значок «информация», заголовок второго уровня и текст.
// Без рамки и тени, не карточка. Красным не красится даже у отклонённой заявки: статус несёт плашка. role="alert" не ставится.
export function TodoBlock({ text, testId }: { text: string; testId?: string }) {
  return (
    <section
      aria-labelledby="request-todo-title"
      className="flex items-start gap-[var(--sp-3)] rounded-surface bg-accent-2-bg p-[var(--card-pad)] text-text"
    >
      <RequestIcon name="info" className="mt-px size-6 flex-none text-accent-2-text" strokeWidth={2} />
      <div className="min-w-0">
        <h2 id="request-todo-title" className="mb-0.5 text-[length:var(--fs-md)] font-bold text-accent-2-text">
          Что сделать вам
        </h2>
        <p data-testid={testId} className="text-[length:var(--fs-sm)]">
          {text}
        </p>
      </div>
    </section>
  )
}
