import Link from 'next/link'
import { cn } from '@/lib/utils'
import { notificationsHref, type NotificationsFilter } from '@/app/notifications/filter'

// Фильтр ленты — три ссылки с параметром адреса, без скриптов в браузере (образец — grades/view-switch.tsx).
// Выбранный: заливка, жирность и aria-current. Зона касания не ниже --tap. Длинная подпись встаёт в две строки,
// не обрезается и не прокручивается вбок.
const OPTIONS: { filter: NotificationsFilter | null; label: string }[] = [
  { filter: null, label: 'Все' },
  { filter: 'news', label: 'Новости и объявления' },
  { filter: 'reminders', label: 'Напоминания' },
]

export function FilterSwitch({ filter }: { filter: NotificationsFilter | null }) {
  const base =
    'inline-flex min-h-[var(--tap)] min-w-0 flex-auto items-center justify-center rounded-pill px-3 py-1 text-center text-[length:var(--fs-sm)] leading-tight focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus'
  return (
    <div role="group" aria-label="Фильтр уведомлений" className="flex gap-1 rounded-pill border-2 border-border-strong bg-card p-1">
      {OPTIONS.map((o) => {
        const selected = o.filter === filter
        return (
          <Link
            key={o.label}
            href={notificationsHref(o.filter)}
            aria-current={selected ? 'true' : undefined}
            className={cn(base, selected ? 'bg-primary font-extrabold text-on-primary' : 'font-semibold text-text')}
          >
            {o.label}
          </Link>
        )
      })}
    </div>
  )
}
