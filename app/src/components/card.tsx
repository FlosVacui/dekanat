import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Карточка и заголовки по дизайн-системе (docs/design/D-2.2-system.md, 5.2).
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card', className)}>
      {children}
    </section>
  )
}

// Заголовок раздела: оранжевой точки перед текстом больше нет (дизайн-проход 19.11).
export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-[var(--sp-2)] text-[length:var(--h2-size)] font-bold leading-tight text-[color:var(--h2-color)]">
      {children}
    </h2>
  )
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="mb-3 text-[length:var(--h1-size)] font-bold leading-[1.15]">{children}</h1>
}
