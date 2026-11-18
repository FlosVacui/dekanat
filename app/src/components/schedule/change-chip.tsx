import type { ReactNode } from 'react'
import type { ScheduleChangeKind, ScheduleEntry } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import { ScheduleIcon, type ScheduleIconName } from './icons'

// Плашка и панель изменения пары (D-2.2-system, 5.4; макет М2-Б): четыре вида, у каждого свой значок и свой цвет, слово всегда видно —
// цвет сам изменение не несёт. Другая аудитория — «внимание», замена преподавателя — синяя, перенос — тёмная (цвет текста как фон,
// цвет страницы как текст), отмена — красная. Цвета — только существующие утилиты токенов, новых значений нет.
const ICONS: Record<ScheduleChangeKind, ScheduleIconName> = {
  cancelled: 'x',
  moved: 'move',
  room_changed: 'room',
  teacher_changed: 'teacher',
}

interface KindStyle {
  /** Плашка на светлом фоне (плитка на «Сегодня», у неё своя полоса слева). */
  chip: string
  /** Фон и текст панели внизу карточки. */
  panel: string
  /** Плашка внутри панели: цвета панели наоборот. */
  panelChip: string
  /** Цвет полосы слева у плитки на «Сегодня». */
  bar: string
}

const STYLES: Record<ScheduleChangeKind, KindStyle> = {
  room_changed: { chip: 'bg-warning-bg text-warning', panel: 'bg-warning-bg text-warning', panelChip: 'bg-warning text-warning-bg', bar: 'border-l-warning' },
  teacher_changed: { chip: 'bg-primary-soft text-primary', panel: 'bg-primary-soft text-primary', panelChip: 'bg-primary text-primary-soft', bar: 'border-l-primary' },
  moved: { chip: 'bg-text text-bg', panel: 'bg-text text-bg', panelChip: 'bg-bg text-text', bar: 'border-l-text' },
  cancelled: { chip: 'bg-error-bg text-error', panel: 'bg-error-bg text-error', panelChip: 'bg-error text-error-bg', bar: 'border-l-error' },
}

/** Цвет полосы слева у плитки изменения на «Сегодня». */
export function changeBarClass(kind: ScheduleChangeKind): string {
  return STYLES[kind].bar
}

export function ChangeChip({ kind, label, className }: { kind: ScheduleChangeKind; label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 self-start whitespace-nowrap rounded-pill px-2 py-1 text-[length:var(--fs-xs)] font-bold leading-[1.2]',
        STYLES[kind].chip,
        className,
      )}
    >
      <ScheduleIcon name={ICONS[kind]} />
      {label}
    </span>
  )
}

/** Панель изменения внизу карточки пары: на всю ширину, плашка со значком и словом, под ней строка изменения (`children`). */
export function ChangePanel({ kind, label, children, className }: { kind: ScheduleChangeKind; label: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-[var(--sp-1)] px-[var(--card-pad)] py-[var(--sp-3)]', STYLES[kind].panel, className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1 self-start whitespace-nowrap rounded-pill px-2.5 py-1.5 text-[length:var(--fs-sm)] font-bold leading-[1.2]',
          STYLES[kind].panelChip,
        )}
      >
        <ScheduleIcon name={ICONS[kind]} />
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * Панель изменения для записи расписания: слово плашки и строка изменения. Одна и та же в карточке вида «День» и в строке вида «Неделя».
 * Нет изменения — `null`. Все тексты приходят готовыми из buildSchedule, кроме «Занятие не состоится» и «Заметка деканата:».
 */
export function EntryChangePanel({ entry, className }: { entry: ScheduleEntry; className?: string }) {
  if (!entry.badge || !entry.changeKind) return null
  return (
    <ChangePanel kind={entry.changeKind} label={entry.badge} className={className}>
      {entry.roomChange ? <RoomChangeLine from={entry.roomChange.from} to={entry.roomChange.to} /> : null}
      {entry.was && !entry.roomChange ? <p className="text-[length:var(--fs-md)] font-bold [overflow-wrap:anywhere]">{entry.was}</p> : null}
      {entry.movedTo ? <p className="text-[length:var(--fs-md)] font-bold [overflow-wrap:anywhere]">{entry.movedTo}</p> : null}
      {entry.cancelled ? <p className="text-[length:var(--fs-md)] font-bold">Занятие не состоится</p> : null}
      {/* Заметка нужна, когда сказать больше нечем: при отмене (причина) и когда строка изменения и «Перенесена на» не собрались. */}
      {entry.note && (entry.cancelled || (!entry.was && !entry.movedTo)) ? (
        <p className="text-[length:var(--fs-sm)] [overflow-wrap:anywhere]">Заметка деканата: {entry.note}</p>
      ) : null}
    </ChangePanel>
  )
}

/** Строка аудитории в панели: «Аудитория: 118 → 124», новый номер крупно. Текст целиком читается подряд. */
export function RoomChangeLine({ from, to }: { from: string; to: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-[var(--sp-2)] font-bold [overflow-wrap:anywhere]">
      <span className="text-[length:var(--fs-md)] font-semibold">Аудитория:</span>{' '}
      <span className="text-[length:var(--fs-md)]">{from}</span>{' '}
      <span>→</span>{' '}
      <span className="text-[length:var(--fs-xl)] font-extrabold leading-none">{to}</span>
    </p>
  )
}
