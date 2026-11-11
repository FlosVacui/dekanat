import Link from 'next/link'
import type { ReactNode } from 'react'
import { todayIn, weekInfo } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { getConfig } from '@/server/config'
import { countMyUnreadNotifications, getMyProfile } from '@/server/dal/student'
import type { Actor } from '@/server/auth/session'

// Каркас экранов студента Э-2…Э-10 (S-2.1, раздел 2): шапка с группой и неделей, колокольчик и аватар вверху,
// четыре вкладки внизу. Пометка «Концепт…» стоит в подвале страницы — layout.tsx.

export type StudentTab = 'today' | 'schedule' | 'grades' | 'requests'

const TABS: { id: StudentTab; label: string; href: string }[] = [
  { id: 'today', label: 'Сегодня', href: '/' },
  { id: 'schedule', label: 'Расписание', href: '/schedule' },
  { id: 'grades', label: 'Успеваемость', href: '/grades' },
  { id: 'requests', label: 'Заявки', href: '/requests' },
]

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export async function StudentShell({
  actor,
  active,
  children,
}: {
  actor: Actor
  /** Вкладка, на которой стоит студент. У колокольчика и аватара вкладки нет. */
  active: StudentTab | null
  children: ReactNode
}) {
  const [profile, unread] = await Promise.all([getMyProfile(actor), countMyUnreadNotifications(actor)])
  const week = weekInfo(todayIn(getConfig().timezone))
  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-300 bg-white px-4 py-2">
        <div className="min-w-0">
          <div className="text-base font-semibold">Деканат в кармане</div>
          <div className="text-xs text-neutral-700">
            {profile?.groupName ?? ''}
            {week ? ` · ${week.number}-я неделя, ${week.kind}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/notifications"
            aria-label={`Уведомления, непрочитанных: ${unread}`}
            className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8Z" />
              <path d="M10 20a2 2 0 0 0 4 0" />
            </svg>
            {unread > 0 ? (
              <span
                data-testid="bell-count"
                className="absolute right-0 top-0 min-w-5 rounded-full bg-red-700 px-1 text-center text-xs font-medium leading-5 text-white"
              >
                {unread}
              </span>
            ) : null}
          </Link>
          <Link
            href="/profile"
            aria-label="Профиль"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-blue-700 text-sm font-semibold text-white"
          >
            {initials(profile?.fullName ?? '')}
          </Link>
        </div>
      </header>
      <main className="p-4">{children}</main>
      <nav
        data-tabbar
        aria-label="Разделы"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-300 bg-white"
      >
        <ul className="mx-auto flex max-w-3xl">
          {TABS.map((tab) => (
            <li key={tab.id} className="flex-1">
              <Link
                href={tab.href}
                aria-current={tab.id === active ? 'page' : undefined}
                data-tab={tab.id}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center px-1 text-xs',
                  tab.id === active ? 'font-semibold text-blue-800' : 'text-neutral-800',
                )}
              >
                <span
                  className={cn('mb-1 h-1 w-8 rounded-full', tab.id === active ? 'bg-blue-700' : 'bg-transparent')}
                  aria-hidden="true"
                />
                <span data-tab-label className="block w-full overflow-hidden whitespace-nowrap text-center">
                  {tab.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
