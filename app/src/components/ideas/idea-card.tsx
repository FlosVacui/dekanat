import type { ReactNode } from 'react'

// Карточка идеи на «Идеи и планы» (макет М6). Пунктирная рамка — это планы, а не работающие функции: ссылок и кнопок в карточке нет.
// Значок на нейтральной плашке (--primary-soft, --primary), заголовок идеи — h2, под ним одна фраза.
export function IdeaCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="flex h-full flex-col items-start gap-[var(--sp-2)] rounded-surface border-2 border-dashed border-border-strong bg-card p-[var(--card-pad)]">
      <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-primary-soft text-primary">
        <svg focusable="false" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </span>
      <h2 className="m-0 text-[length:var(--fs-lg)] font-bold leading-[1.25] [overflow-wrap:anywhere]">{title}</h2>
      <p className="m-0 text-[length:var(--fs-md)] leading-[1.45]">{text}</p>
    </article>
  )
}
