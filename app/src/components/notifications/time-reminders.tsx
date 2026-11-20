import Link from 'next/link'
import { RequestIcon } from '@/components/requests/icons'
import type { TimeReminder } from '@/lib/reminders/due'

// Строки ленты «Напоминания», которые рождает время (20.11): «Завтра срок: …», «Сегодня экзамен: …». Считаются на лету из данных
// успеваемости, нигде не хранятся и не имеют пометки «прочитано», в число «Непрочитанных» не входят. Каждая строка — ссылка на дисциплину.
// Список — `ol`, а не `ul`: обычная лента (`FeedList`) остаётся единственным `ul` на странице.

const LINK_CARD =
  'flex min-h-[var(--tap)] w-full items-start gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] text-left shadow-card active:bg-primary-soft focus-visible:-outline-offset-3'

export function TimeReminders({ items }: { items: readonly TimeReminder[] }) {
  if (items.length === 0) return null
  return (
    <section aria-label="Ближайшие сроки" data-testid="time-reminders" className="mt-[var(--gap)]">
      <ol className="m-0 flex list-none flex-col gap-[var(--gap)] p-0">
        {items.map((item) => (
          <li key={item.key} data-kind={item.kind}>
            <Link href={item.href} className={LINK_CARD}>
              <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                <span className="text-[length:var(--fs-sm)] text-muted">Ближайшее</span>
                <span className="text-[length:var(--fs-md)] font-bold leading-[1.3]">{item.title}</span>
                <span className="text-[length:var(--fs-sm)]">{item.body}</span>
              </span>
              <RequestIcon name="chevron" className="mt-1 size-4 flex-none text-primary" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
