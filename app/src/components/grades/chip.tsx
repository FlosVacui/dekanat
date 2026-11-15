import { outcomeLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { GradeIcon, type GradeIconName } from './icons'

// Плашка статуса (D-2.2-system, 5.4): значок и слово, цвет сам статус не несёт. Плашка не нажимается.
export type ChipTone = 'ok' | 'err' | 'warn' | 'info'

const TONE_CLASS: Record<ChipTone, string> = {
  ok: 'bg-success-bg text-success',
  err: 'bg-error-bg text-error',
  warn: 'bg-warning-bg text-warning',
  info: 'bg-primary-soft text-primary',
}
const TONE_ICON: Record<ChipTone, GradeIconName> = { ok: 'check', err: 'x', warn: 'alert', info: 'clock' }

/** Общий класс плашки: его берёт и плашка статуса заявки (`requests/status-chip.tsx`). */
export const CHIP_CLASS =
  'inline-flex items-center gap-1 self-start whitespace-nowrap rounded-pill px-2 py-1 align-middle text-[length:var(--fs-xs)] font-bold leading-[1.2]'

export function Chip({ tone, children, className }: { tone: ChipTone; children: string; className?: string }) {
  return (
    <span
      className={cn(
        CHIP_CLASS,
        TONE_CLASS[tone],
        className,
      )}
    >
      <GradeIcon name={TONE_ICON[tone]} />
      {children}
    </span>
  )
}

/** Тон плашки итога: оценка 3–5 и «зачтено» — успех; 2 и «не зачтено» — ошибка; «впереди» — нейтральная. */
export function outcomeTone(outcome: string): ChipTone {
  if (outcome === '2' || outcome === 'no_credit') return 'err'
  if (outcome === 'pending') return 'info'
  return 'ok'
}

/** Плашка итога: «Оценка 4», «Зачтено», «Не зачтено», «Впереди». */
export function OutcomeChip({ outcome, className }: { outcome: string; className?: string }) {
  return (
    <Chip tone={outcomeTone(outcome)} className={className}>
      {outcomeLabel(outcome)}
    </Chip>
  )
}
