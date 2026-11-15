import type { ReactNode } from 'react'

// Значки экранов заявок, уведомлений и страниц «не найдено» (D-2.2-system, 5.4–5.11): встроенный svg, без пакета значков
// (политика содержимого запрещает data: и внешние адреса). Значок скрыт от экранного чтеца: смысл несёт слово рядом.
// Контуры общие с вкладками нижней панели и значками «Успеваемости»; свои — «метка» (pin) и «информация» (info).
export type RequestIconName = 'inbox' | 'requests' | 'pin' | 'check' | 'x' | 'clock' | 'back' | 'info' | 'alert' | 'chevron' | 'down'

const PATHS: Record<RequestIconName, ReactNode> = {
  inbox: (
    <>
      <path d="M4 13l2-8h12l2 8v6H4z" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </>
  ),
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
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.1" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17.5v.01" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  down: <path d="M6 9l6 6 6-6" />,
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
      {PATHS[name]}
    </svg>
  )
}
