import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Части каркаса студента, которым не нужны ни база, ни сессия: шапка, нижняя панель и рамка вокруг содержимого.
// Из них собран каркас с данными (student-shell.tsx) и каркас без данных для состояний «загрузка» и «ошибка»
// (loading.tsx и error.tsx: error.tsx — клиентский компонент, серверный код в него не тянется).
// Вид — раздел 6 дизайн-системы (D-2.2-system); знак — раздел 7.

export type StudentTab = 'today' | 'schedule' | 'grades' | 'requests'

// Значки вкладок — простые контуры 24×24 (штрих 2, скруглённые концы), по образцу макета V-AC; встроенные, без пакета значков.
const TAB_ICONS: Record<StudentTab, ReactNode> = {
  today: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M4 10h16" />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" />
    </>
  ),
  schedule: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  grades: <path d="M5 20v-9M12 20V5M19 20v-6" />,
  requests: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </>
  ),
}

const TABS: { id: StudentTab; label: string; href: string }[] = [
  { id: 'today', label: 'Сегодня', href: '/' },
  { id: 'schedule', label: 'Расписание', href: '/schedule' },
  { id: 'grades', label: 'Успеваемость', href: '/grades' },
  { id: 'requests', label: 'Заявки', href: '/requests' },
]

// Рамка фокуса в шапке: 3 px, цвет --on-header (раздел 5, общие правила).
const HEADER_FOCUS = 'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-on-header'

/** Что шапка знает о студенте. Нет данных — `null`: строки группы и недели нет, у колокольчика нет числа, у аватара нет инициалов. */
export interface HeaderData {
  groupName: string
  /** Хвост строки под названием: « · 12-я неделя, чётная» или пустая строка. */
  weekLine: string
  unread: number
  initials: string
}

export function StudentHeader({ data }: { data: HeaderData | null }) {
  const unread = data?.unread ?? 0
  return (
    <header className="flex items-center gap-1 bg-header-bg px-[var(--pad-x)] pb-[var(--sp-3)] pt-[var(--sp-4)] text-on-header">
      {/* Знак 40×40 внутри круга 44×44. Подложка круга — переменная системы: прозрачная в светлой теме. */}
      <div className="grid size-11 flex-none place-items-center rounded-full bg-logo-plate">
        <Image src="/owl-128.png" alt="" width={40} height={40} unoptimized />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[length:var(--fs-md)] font-bold leading-[1.2]">Деканат в кармане</div>
        {data ? (
          <div className="text-[length:var(--fs-xs)] leading-[1.3] text-header-muted">
            {data.groupName}
            {data.weekLine}
          </div>
        ) : null}
      </div>
      <Link
        href="/notifications"
        aria-label={data ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'}
        className={cn('relative grid size-11 flex-none place-items-center rounded-full text-on-header', HEADER_FOCUS)}
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z" />
          <path d="M10 21.5h4" />
        </svg>
        {unread > 0 ? (
          <span
            data-testid="bell-count"
            className="absolute right-px top-[3px] h-5 min-w-5 rounded-full bg-accent px-[5px] text-center text-[length:var(--fs-xs)] font-extrabold leading-5 text-on-accent"
          >
            {unread}
          </span>
        ) : null}
      </Link>
      <Link
        href="/profile"
        aria-label="Профиль"
        className={cn('grid size-11 flex-none place-items-center rounded-full', HEADER_FOCUS)}
      >
        <span className="grid size-9 place-items-center rounded-full bg-avatar-bg text-[length:var(--fs-sm)] font-extrabold text-avatar-fg">
          {data?.initials ?? ''}
        </span>
      </Link>
    </header>
  )
}

export function StudentTabBar({ active }: { active: StudentTab | null }) {
  return (
    <nav
      data-tabbar
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-10 rounded-t-nav-bar border-t border-border bg-nav-bg shadow-nav"
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-4">
        {TABS.map((tab) => {
          const isActive = tab.id === active
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                data-tab={tab.id}
                className={cn(
                  'flex min-h-[var(--nav-h)] flex-col items-center justify-center gap-0.5 px-0 py-1.5 text-[length:var(--fs-xs)] leading-[1.2] focus-visible:outline-[3px] focus-visible:-outline-offset-4 focus-visible:outline-nav-active',
                  isActive ? 'font-bold text-nav-active' : 'font-semibold text-nav-icon',
                )}
              >
                <span
                  className={cn('grid h-8 w-[60px] place-items-center rounded-[16px]', isActive ? 'bg-nav-active-bg' : 'bg-transparent')}
                  aria-hidden="true"
                >
                  <svg focusable="false" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {TAB_ICONS[tab.id]}
                  </svg>
                </span>
                <span data-tab-label className="block w-full overflow-hidden whitespace-nowrap px-0.5 text-center">
                  {tab.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Рамка экрана студента: шапка, середина, нижняя панель. `data` — то, что шапка знает о студенте; `null` — каркас без данных
 * (состояния «загрузка» и «ошибка»).
 */
export function StudentFrame({ data, active, children }: { data: HeaderData | null; active: StudentTab | null; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <StudentHeader data={data} />
      <main className="px-[var(--pad-x)] py-[var(--sp-4)]">{children}</main>
      <StudentTabBar active={active} />
    </div>
  )
}
