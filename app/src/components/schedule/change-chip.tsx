import type { ScheduleChangeKind } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import { ScheduleIcon, type ScheduleIconName } from './icons'

// Плашка изменения пары (D-2.2-system, 5.4): значок и слово, цвет сам статус не несёт.
// Отмена — красная пара, остальное — «внимание». Плашка — обычный текст, в разметке стоит перед названием.
const ICONS: Record<ScheduleChangeKind, ScheduleIconName> = {
  cancelled: 'x',
  moved: 'move',
  room_changed: 'room',
  teacher_changed: 'teacher',
}

export function ChangeChip({ kind, label, className }: { kind: ScheduleChangeKind; label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 self-start whitespace-nowrap rounded-pill px-2 py-1 text-[length:var(--fs-xs)] font-bold leading-[1.2]',
        kind === 'cancelled' ? 'bg-error-bg text-error' : 'bg-warning-bg text-warning',
        className,
      )}
    >
      <ScheduleIcon name={ICONS[kind]} />
      {label}
    </span>
  )
}
