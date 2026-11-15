import Link from 'next/link'
import type { ReactNode } from 'react'
import { GradeIcon } from '@/components/grades/icons'

// Карточка со строками-ссылками экрана «Сегодня» (D-2.2-system, 5.2, «строка списка»): плашка, жирная строка, мелкая строка, стрелка.
// Карточка без внутреннего отступа, строки разделены линией; рамка фокуса внутри строки с отступом −3 px (раздел 5, «Общие правила»).
export function RowList({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card shadow-card">
      {children}
    </ul>
  )
}

export function RowLink({
  href,
  chip,
  title,
  meta,
}: {
  href: string
  /** Плашка над жирной строкой; у объявления её нет. */
  chip?: ReactNode
  title: string
  /** Мелкие строки под жирной. */
  meta?: ReactNode
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-[var(--tap)] items-center gap-[var(--sp-3)] px-[var(--card-pad)] py-[var(--sp-3)] active:bg-primary-soft focus-visible:-outline-offset-3"
      >
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          {chip}
          <b className="text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]">{title}</b>
          {meta}
        </span>
        <GradeIcon name="chevron" className="size-5 flex-none text-primary" />
      </Link>
    </li>
  )
}

/** Мелкая строка строки списка. */
export function RowMeta({ children, clamp = false }: { children: ReactNode; clamp?: boolean }) {
  return (
    <span className={`text-[length:var(--fs-sm)] text-muted [overflow-wrap:anywhere]${clamp ? ' line-clamp-2' : ''}`}>{children}</span>
  )
}

/** Блок экрана: заголовок уровня 2 и содержимое; `aside` стоит в заголовке рядом с текстом (плашка «Новых: N»). */
export function TodayBlock({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h2
        id={id}
        className="mb-[var(--sp-2)] flex flex-wrap items-center gap-[var(--sp-2)] text-[length:var(--h2-size)] font-bold leading-tight text-[color:var(--h2-color)] before:size-2.5 before:flex-none before:rounded-full before:bg-accent before:content-['']"
      >
        <span>{title}</span>
        {aside}
      </h2>
      {children}
    </section>
  )
}

/** Пустая строка блока: нынешние тексты экрана. */
export function EmptyRow({ children }: { children: string }) {
  return (
    <p className="rounded-surface border border-border bg-card p-[var(--card-pad)] text-[length:var(--fs-sm)] shadow-card">{children}</p>
  )
}
