import type { ReactNode } from 'react'
import { GRADE_ICON_PATHS, type GradeIconName } from '@/components/grades/icons'

// Значки экранов заявок, уведомлений и страниц «не найдено» (D-2.2-system, 5.4–5.11): встроенный svg, без пакета значков
// (политика содержимого запрещает data: и внешние адреса). Значок скрыт от экранного чтеца: смысл несёт слово рядом.
// Семь общих контуров (check, x, clock, alert, chevron, back, inbox) лежат в `grades/icons.tsx` и берутся оттуда;
// здесь — только свои: «заявки» (requests), «метка» (pin), «информация» (info) и «вниз» (down).
export type RequestIconName = GradeIconName | 'requests' | 'pin' | 'info' | 'down'

const OWN_PATHS: Record<Exclude<RequestIconName, GradeIconName>, ReactNode> = {
  requests: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.1" />
    </>
  ),
  down: <path d="M6 9l6 6 6-6" />,
}

function pathOf(name: RequestIconName): ReactNode {
  return name in GRADE_ICON_PATHS ? GRADE_ICON_PATHS[name as GradeIconName] : OWN_PATHS[name as keyof typeof OWN_PATHS]
}

export function RequestIcon({ name, className, strokeWidth = 2.4 }: { name: RequestIconName; className?: string; strokeWidth?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'size-3.5 flex-none'}
    >
      {pathOf(name)}
    </svg>
  )
}
