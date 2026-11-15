import type { ReactNode } from 'react'

// Значки экрана «Успеваемость»: линия 2.4 px, как в плашках дизайн-системы (D-2.2-system, 5.4). Значок скрыт от экранного чтеца:
// смысл несёт слово рядом.
export type GradeIconName = 'check' | 'x' | 'clock' | 'alert' | 'chevron' | 'inbox' | 'back'

export const GRADE_ICON_PATHS: Record<GradeIconName, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17.5v.01" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  back: <path d="M15 5l-7 7 7 7" />,
  inbox: (
    <>
      <path d="M4 13l2-8h12l2 8v6H4z" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </>
  ),
}

export function GradeIcon({ name, className }: { name: GradeIconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'size-3.5 flex-none'}
    >
      {GRADE_ICON_PATHS[name]}
    </svg>
  )
}
