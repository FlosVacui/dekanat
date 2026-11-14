import type { ReactNode } from 'react'

// Значки экрана «Расписание»: линия 2.4 px как в плашках дизайн-системы (D-2.2-system, 5.4). Значок всегда скрыт от экранного чтеца:
// смысл несёт слово рядом.
export type ScheduleIconName = 'x' | 'move' | 'room' | 'teacher' | 'inbox'

const PATHS: Record<ScheduleIconName, ReactNode> = {
  x: <path d="M6 6l12 12M18 6L6 18" />,
  move: <path d="M5 12h14M13 6l6 6-6 6" />,
  room: (
    <>
      <path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z" />
      <circle cx="12" cy="11" r="2" />
    </>
  ),
  teacher: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13l2-8h12l2 8v6H4z" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </>
  ),
}

export function ScheduleIcon({ name, className }: { name: ScheduleIconName; className?: string }) {
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
      {PATHS[name]}
    </svg>
  )
}
