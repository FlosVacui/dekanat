import Link from 'next/link'
import type { ScheduleDay } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import { dayHref } from './hrefs'

// Полоса из семи дней, начиная с сегодняшнего (D-2.2-system, раздел 8: «Выбранный день»).
// Выбранный день — заливка, жирная цифра и aria-current="date". У дня с изменениями — точка и скрытый текст «есть изменения».
// Семь ячеек делят ширину поровну: на 360 px каждая около 45 px, ниже зоны касания 44 px не падает.
export function DayStrip({ days, selected }: { days: ScheduleDay[]; selected: string }) {
  return (
    <nav aria-label="Дни недели">
      <ul className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const isSelected = d.date === selected
          return (
            <li key={d.date} className="min-w-0">
              <Link
                href={dayHref(d.date)}
                aria-current={isSelected ? 'date' : undefined}
                className={cn(
                  'flex min-h-[58px] min-w-[var(--tap)] flex-col items-center justify-center gap-0.5 rounded-control border-2 px-0 py-1 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                  isSelected ? 'border-primary bg-primary text-on-primary' : 'border-transparent text-text',
                )}
              >
                <small className={cn('text-[length:var(--fs-xs)] leading-none', isSelected ? 'text-on-primary' : 'text-muted')}>
                  {d.weekday}
                </small>
                <b className={cn('text-[length:var(--fs-md)] leading-[1.1]', isSelected ? 'font-extrabold' : 'font-semibold')}>
                  {d.dayOfMonth}
                </b>
                <span
                  aria-hidden="true"
                  className={cn('size-1.5 rounded-full', d.hasChanges ? (isSelected ? 'bg-on-primary' : 'bg-warning') : 'invisible')}
                />
                {d.isToday ? <span className="sr-only">, сегодня</span> : null}
                {d.hasChanges ? <span className="sr-only">, есть изменения</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
