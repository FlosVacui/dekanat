import Link from 'next/link'
import { GradeIcon } from '@/components/grades/icons'
import type { EntitlementRow } from '@/lib/entitlements'
import { TodayBlock } from './row-list'

// «Вам положено» (20.11): блок под «Ждёт вас», зелёные строки того же вида: полоска слева, галочка, жирная строка, пояснение,
// ссылка на пункт положения и кнопка-глагол. Пусто — блока нет (никакой «пустой» строки).
export function EntitlementsBlock({ rows }: { rows: EntitlementRow[] }) {
  if (rows.length === 0) return null
  return (
    <TodayBlock id="today-entitlements" title="Вам положено">
      <ul
        data-testid="entitlements"
        className="flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card"
      >
        {rows.map((row) => (
          <li
            key={row.key}
            data-kind={row.kind}
            className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-[var(--sp-3)] gap-y-1 px-[var(--card-pad)] py-[var(--sp-3)] before:absolute before:bottom-2.5 before:left-0 before:top-2.5 before:w-1 before:rounded-r-[4px] before:bg-success before:content-['']"
          >
            <span aria-hidden="true" className="grid size-7 place-items-center rounded-lg bg-success-bg text-success">
              <GradeIcon name="check" className="size-4" />
            </span>
            <b className="text-[length:var(--fs-md)] font-semibold leading-[1.3] [overflow-wrap:anywhere]">{row.title}</b>
            <span className="col-start-2 text-[length:var(--fs-sm)] text-muted [overflow-wrap:anywhere]">{row.detail}</span>
            <Link
              href={row.pointHref}
              data-point={row.point}
              className="col-start-2 inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-sm)] font-semibold text-primary underline [overflow-wrap:anywhere]"
            >
              {row.pointLabel}
            </Link>
            <Link
              href={row.href}
              className="col-start-2 inline-flex min-h-[var(--tap)] items-center gap-1 justify-self-start rounded-full bg-primary-soft px-[var(--sp-3)] text-[length:var(--fs-sm)] font-semibold text-primary"
            >
              {row.action}
              <GradeIcon name="chevron" className="size-4 flex-none" />
            </Link>
          </li>
        ))}
      </ul>
    </TodayBlock>
  )
}
