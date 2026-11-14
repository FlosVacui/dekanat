import Link from 'next/link'
import { cn } from '@/lib/utils'

// Переключатель «Семестр / Сессия» — две ссылки, без скриптов в браузере. «Семестр» — название вида, а не фильтр:
// в обоих видах те же дисциплины. Выбранный вид: заливка и жирность плюс aria-current. Зона касания не ниже --tap.
export type GradesView = 'semester' | 'session'

export function ViewSwitch({ view }: { view: GradesView }) {
  const base =
    'inline-flex min-h-[var(--tap)] min-w-[var(--tap)] flex-1 items-center justify-center rounded-pill text-[length:var(--fs-sm)] focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus'
  return (
    <div role="group" aria-label="Вид" className="flex gap-1 rounded-pill border-2 border-border-strong bg-card p-1">
      <Link
        href="/grades"
        aria-current={view === 'semester' ? 'true' : undefined}
        className={cn(base, view === 'semester' ? 'bg-primary font-extrabold text-on-primary' : 'font-semibold text-text')}
      >
        Семестр
      </Link>
      <Link
        href="/grades?view=session"
        aria-current={view === 'session' ? 'true' : undefined}
        className={cn(base, view === 'session' ? 'bg-primary font-extrabold text-on-primary' : 'font-semibold text-text')}
      >
        Сессия
      </Link>
    </div>
  )
}
