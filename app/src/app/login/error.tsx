'use client'

import { ErrorCard } from '@/components/states/error-card'

// Вход: каркаса студента нет (D-2.2-system, раздел 6, абзац «Вход»). Сюда попадает сбой действия входа, который не обработан формой.
export default function Error({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto max-w-sm px-[var(--pad-x)] py-[var(--sp-5)]">
      <ErrorCard title="Не удалось загрузить страницу" onRetry={retry} />
    </main>
  )
}
