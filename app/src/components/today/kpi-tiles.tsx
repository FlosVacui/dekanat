import Link from 'next/link'
import type { ReactNode } from 'react'
import type { TodayTiles } from '@/lib/today'

// Четыре плитки с главными числами на «Сегодня» (макет М5): значок, число 36 px, подпись под ним. Каждая — ссылка в свой раздел.
// Только от 1024 px: ниже `display: none`, в дереве доступности телефона их нет. Ноль — «0» и та же подпись.
const ICONS: Record<'lessons' | 'due' | 'requests' | 'unread', ReactNode> = {
  lessons: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  due: <path d="M5 20v-9M12 20V5M19 20v-6" />,
  requests: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </>
  ),
  unread: (
    <>
      <path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z" />
      <path d="M10 21.5h4" />
    </>
  ),
}

const TILES: { key: keyof typeof ICONS; label: string; href: string }[] = [
  { key: 'lessons', label: 'Пар сегодня', href: '/schedule' },
  { key: 'due', label: 'Сдать на этой неделе', href: '/grades' },
  { key: 'requests', label: 'Заявки в работе', href: '/requests' },
  { key: 'unread', label: 'Новые уведомления', href: '/notifications' },
]

export function KpiTiles({ tiles }: { tiles: TodayTiles }) {
  return (
    <ul data-testid="kpis" className="m-0 hidden list-none grid-cols-4 gap-[var(--gap)] p-0 lg:grid lg:col-span-2">
      {TILES.map((tile) => (
        <li key={tile.key}>
          <Link
            href={tile.href}
            data-kpi={tile.key}
            className="flex h-full min-h-[var(--tap)] flex-col gap-[var(--sp-1)] rounded-surface border border-border bg-card p-[var(--card-pad)] text-text shadow-card active:bg-primary-soft focus-visible:outline-offset-2"
          >
            <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-primary-soft text-primary">
              <svg focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[tile.key]}
              </svg>
            </span>
            <b data-kpi-number className="text-[length:var(--fs-num)] font-extrabold leading-[1.05] [font-variant-numeric:tabular-nums]">
              {tiles[tile.key]}
            </b>
            <span className="text-[length:var(--fs-sm)] font-semibold leading-[1.3]">{tile.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
