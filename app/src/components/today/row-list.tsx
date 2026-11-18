import Link from 'next/link'
import type { ReactNode } from 'react'
import { GradeIcon } from '@/components/grades/icons'
import { ChangeChip, changeBarClass } from '@/components/schedule/change-chip'
import { changeBadgeLabel } from '@/lib/labels'
import type { ScheduleEntry } from '@/lib/schedule'
import { cn } from '@/lib/utils'

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

/**
 * Блок изменений расписания на «Сегодня» (макет М1-Б): жёлтая подложка, внутри плитки. Нужен, когда изменения есть;
 * пустой блок «На сегодня и завтра изменений нет» рисуется обычным `TodayBlock`, без тревожной подложки.
 */
export function ChangesBlock({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col rounded-surface bg-warning-bg p-[var(--sp-3)] lg:col-span-2">
      <h2
        id={id}
        className="mb-[var(--sp-2)] flex items-center gap-[var(--sp-2)] text-[length:var(--h2-size)] font-bold leading-tight text-warning before:size-2.5 before:flex-none before:rounded-full before:bg-warning before:content-['']"
      >
        {title}
      </h2>
      <ul className="grid grid-cols-1 gap-[var(--sp-2)] lg:grid-cols-2">{children}</ul>
    </section>
  )
}

/**
 * Плитка изменения: цветная полоса слева, плашка со значком и словом, жирная строка «Завтра, 10:10 · Математический анализ»
 * и одна строка самого изменения. Прежние номер и ФИО названы в этой строке один раз.
 */
export function ChangeTile({ href, dayWord, entry }: { href: string; dayWord: string; entry: ScheduleEntry }) {
  const kind = entry.changeKind
  if (!kind) return null
  // Заметка деканата — причина отмены или единственное объяснение, когда строка изменения не собралась.
  const showNote = entry.note !== null && (entry.cancelled || (!entry.was && !entry.movedTo))
  return (
    <li>
      <Link
        href={href}
        className={cn(
          'flex h-full min-h-[var(--tap)] flex-col items-start gap-[3px] rounded-control border-l-[6px] bg-card py-[var(--sp-3)] pl-[var(--sp-4)] pr-[var(--sp-3)] active:bg-primary-soft focus-visible:outline-offset-2',
          changeBarClass(kind),
        )}
      >
        <ChangeChip kind={kind} label={entry.badge ?? changeBadgeLabel(kind)} />
        <b className="text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]">
          {dayWord}, {entry.startsAt} · {entry.cancelled ? <s className="decoration-2">{entry.discipline}</s> : entry.discipline}
        </b>
        {entry.roomChange ? (
          <span className="text-[length:var(--fs-sm)] leading-[1.35] [overflow-wrap:anywhere]">
            Аудитория: <span className="text-muted">{entry.roomChange.from}</span> <span>→</span>{' '}
            <b className="rounded-lg bg-warning-bg px-2 py-px font-extrabold text-warning">{entry.roomChange.to}</b>
          </span>
        ) : null}
        {!entry.roomChange && (entry.was ?? entry.movedTo) ? (
          <span className="text-[length:var(--fs-sm)] leading-[1.35] [overflow-wrap:anywhere]">{entry.movedTo ?? entry.was}</span>
        ) : null}
        {entry.cancelled ? <span className="text-[length:var(--fs-sm)] leading-[1.35]">Занятие не состоится</span> : null}
        {showNote ? <RowMeta>{entry.note}</RowMeta> : null}
      </Link>
    </li>
  )
}

/** Пустая строка блока: нынешние тексты экрана. */
export function EmptyRow({ children }: { children: string }) {
  return (
    <p className="rounded-surface border border-border bg-card p-[var(--card-pad)] text-[length:var(--fs-sm)] shadow-card">{children}</p>
  )
}
