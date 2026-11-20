import Link from 'next/link'
import { RequestIcon } from '@/components/requests/icons'
import { cn } from '@/lib/utils'

// Строка-ссылка со числом: подпись слева, число и стрелка справа. Зона касания не ниже --tap.
// `alert` — число требует внимания (просрочено, вопросы без ответа): слово и значок остаются, цвет только усиливает.
export function StatLink({ href, label, value, alert = false, testId }: { href: string; label: string; value: number; alert?: boolean; testId?: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-[var(--tap)] items-center gap-[var(--sp-2)] rounded-control px-1 py-1.5 text-[length:var(--fs-md)] active:bg-primary-soft focus-visible:-outline-offset-3"
    >
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label}</span>
      <span
        data-testid={testId}
        className={cn(
          'rounded-pill px-[var(--sp-2)] text-[length:var(--fs-md)] font-extrabold tabular-nums',
          alert && value > 0 ? 'bg-error-bg text-error' : 'bg-primary-soft text-primary',
        )}
      >
        {value}
      </span>
      <RequestIcon name="chevron" className="size-4 flex-none text-primary" />
    </Link>
  )
}
