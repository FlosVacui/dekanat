import Link from 'next/link'
import { GradeIcon, type GradeIconName } from '@/components/grades/icons'
import type { WaitingRow, WaitingTone } from '@/lib/today'
import { WAITING_EMPTY_TEXT } from '@/lib/today'
import { cn } from '@/lib/utils'
import { EmptyRow, TodayBlock } from './row-list'

// «Ждёт вас» (макет docs/design/mockups/design-pass/today.html): главный блок экрана. Строка — цветная полоска слева, значок в квадрате,
// жирная строка, пояснение и одна ссылка-глагол. Смысл не только цветом: у значка есть слово для экранного чтеца и значок своей формы
// (долг — крест, нет допуска — восклицание, готово — галочка).
const TONE: Record<WaitingTone, { bar: string; icon: string; name: GradeIconName }> = {
  err: { bar: 'before:bg-error', icon: 'bg-error-bg text-error', name: 'x' },
  warn: { bar: 'before:bg-warning', icon: 'bg-warning-bg text-warning', name: 'alert' },
  ok: { bar: 'before:bg-success', icon: 'bg-success-bg text-success', name: 'check' },
}

export function WaitingBlock({ rows }: { rows: WaitingRow[] }) {
  return (
    <TodayBlock id="today-waiting" title="Ждёт вас">
      {rows.length === 0 ? (
        <EmptyRow>{WAITING_EMPTY_TEXT}</EmptyRow>
      ) : (
        <ul data-testid="waiting" className="flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card">
          {rows.map((row) => (
            <li
              key={row.key}
              data-kind={row.kind}
              className={cn(
                'relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-[var(--sp-3)] gap-y-1 px-[var(--card-pad)] py-[var(--sp-3)]',
                "before:absolute before:bottom-2.5 before:left-0 before:top-2.5 before:w-1 before:rounded-r-[4px] before:content-['']",
                TONE[row.tone].bar,
              )}
            >
              <span aria-hidden="true" className={cn('grid size-7 place-items-center rounded-lg', TONE[row.tone].icon)}>
                <GradeIcon name={TONE[row.tone].name} className="size-4" />
              </span>
              <b className="text-[length:var(--fs-md)] font-semibold leading-[1.3] [overflow-wrap:anywhere]">
                <span className="sr-only">{row.label}: </span>
                {row.title}
              </b>
              {row.detail ? <span className="col-start-2 text-[length:var(--fs-sm)] text-muted [overflow-wrap:anywhere]">{row.detail}</span> : null}
              {row.note && row.noteHref ? (
                // 20.11, стипендия: строка о стипендии у долга ведёт на раздел «Стипендия», а не дублируется отдельной строкой.
                <Link
                  href={row.noteHref}
                  data-testid="waiting-stipend"
                  className="col-start-2 inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-sm)] font-semibold text-primary underline [overflow-wrap:anywhere]"
                >
                  {row.note}
                </Link>
              ) : row.note ? (
                <span className="col-start-2 text-[length:var(--fs-sm)] text-muted [overflow-wrap:anywhere]">{row.note}</span>
              ) : null}
              <Link
                href={row.href}
                className="col-start-2 mt-1 inline-flex min-h-[var(--tap)] items-center gap-1 justify-self-start rounded-full bg-primary-soft px-[var(--sp-3)] text-[length:var(--fs-sm)] font-semibold text-primary"
              >
                {row.action}
                <GradeIcon name="chevron" className="size-4 flex-none" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </TodayBlock>
  )
}
