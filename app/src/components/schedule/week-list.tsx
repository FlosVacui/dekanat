import { Card } from '@/components/card'
import type { ScheduleDay, ScheduleEntry } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import { EntryChangePanel } from './change-chip'

// Вид «Неделя»: семь дней одной лентой, под заголовком дня — пары строками. Таблицы с колонками по дням нет: на 360 px она не помещается.
// Строка: время, дисциплина, аудитория; у изменённой пары под ними панель изменения. Всё готовое приходит из buildSchedule.

function WeekRow({ entry }: { entry: ScheduleEntry }) {
  const { cancelled } = entry
  const dim = cancelled || entry.placement === 'moved_from'
  return (
    <li className="grid grid-cols-[56px_1fr] gap-[var(--sp-3)] border-t border-border py-[var(--sp-2)] first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-0.5 tabular-nums">
        <b
          className={cn(
            'text-[length:var(--fs-md)] leading-[1.2]',
            entry.placement === 'moved_to' && 'font-extrabold',
            dim && 'font-bold text-muted',
            cancelled && 'line-through decoration-2',
          )}
        >
          {entry.startsAt}
        </b>
        <span className={cn('text-[length:var(--fs-sm)] text-muted', cancelled && 'line-through decoration-2')}>{entry.endsAt}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <p
          className={cn(
            'text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]',
            dim && 'text-muted',
            cancelled && 'line-through decoration-2',
          )}
        >
          {entry.discipline}
          {cancelled ? <span className="sr-only">, отменено</span> : null}
        </p>
        {/* Прежняя аудитория названа в панели изменения, здесь строка не повторяется. */}
        {entry.roomChange ? null : (
          <p className={cn('text-[length:var(--fs-sm)] text-muted', cancelled && 'line-through decoration-2')}>ауд. {entry.room}</p>
        )}
      </div>
      {/* Панель изменения на всю ширину строки (макет М2-Б). Новый преподаватель назван в ней один раз (R-3.2-6). */}
      <EntryChangePanel entry={entry} className="col-span-2 rounded-control px-[var(--sp-3)]" />
    </li>
  )
}

export function WeekList({ days }: { days: ScheduleDay[] }) {
  return (
    <ol className="flex flex-col gap-[var(--gap)]" aria-label="Неделя по дням">
      {days.map((d) => (
        <li key={d.date}>
          <Card>
            <h2 className="mb-[var(--sp-2)] flex flex-wrap items-center gap-x-[var(--sp-2)] text-[length:var(--fs-md)] font-bold">
              <span>
                {d.weekday}, {d.dayMonth}
              </span>
              {d.isToday ? (
                <span className="rounded-pill bg-primary-soft px-2 py-1 text-[length:var(--fs-xs)] font-bold leading-[1.2] text-primary">
                  сегодня
                </span>
              ) : null}
            </h2>
            {d.entries.length === 0 ? (
              <p className="text-[length:var(--fs-sm)] text-muted">Пар нет</p>
            ) : (
              <ul>
                {d.entries.map((e) => (
                  <WeekRow key={e.key} entry={e} />
                ))}
              </ul>
            )}
          </Card>
        </li>
      ))}
    </ol>
  )
}
