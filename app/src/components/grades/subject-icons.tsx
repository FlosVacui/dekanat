import type { ReactNode } from 'react'

// Значки страницы предмета (М4): человек, лист документа, пометка «i». Контуры — как в макете. Отдельный файл, а не `icons.tsx`:
// у `requests/icons.tsx` свои «info» и «requests», и общий словарь с ними разошёлся бы. Значок скрыт от экранного чтеца.
export type SubjectIconName = 'teacher' | 'doc' | 'info'

const PATHS: Record<SubjectIconName, ReactNode> = {
  teacher: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.1" />
    </>
  ),
}

export function SubjectIcon({ name, className }: { name: SubjectIconName; className?: string }) {
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
      className={className ?? 'size-5 flex-none'}
    >
      {PATHS[name]}
    </svg>
  )
}
