import Link from 'next/link'
import { cn } from '@/lib/utils'
import { dayHref, WEEK_HREF } from './hrefs'

// Переключатель «День / Неделя» — две ссылки, без скриптов в браузере (образец — переключатель вида на экране «Успеваемость»).
// Выбранный вид: заливка и жирность плюс aria-current. Зона касания не ниже --tap.
export function ViewSwitch({ view }: { view: 'day' | 'week' }) {
  const base =
    'inline-flex min-h-[var(--tap)] min-w-[var(--tap)] flex-1 items-center justify-center rounded-pill text-[length:var(--fs-sm)] focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus'
  return (
    <div role="group" aria-label="Вид" className="flex gap-1 rounded-pill border-2 border-border-strong bg-card p-1">
      <Link
        href={dayHref()}
        scroll={false}
        aria-current={view === 'day' ? 'true' : undefined}
        className={cn(base, view === 'day' ? 'bg-primary font-extrabold text-on-primary' : 'font-semibold text-text')}
      >
        День
      </Link>
      <Link
        href={WEEK_HREF}
        scroll={false}
        aria-current={view === 'week' ? 'true' : undefined}
        className={cn(base, view === 'week' ? 'bg-primary font-extrabold text-on-primary' : 'font-semibold text-text')}
      >
        Неделя
      </Link>
    </div>
  )
}
