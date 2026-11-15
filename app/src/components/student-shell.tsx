import type { ReactNode } from 'react'
import { todayIn, weekInfo } from '@/lib/dates'
import { getConfig } from '@/server/config'
import { countMyUnreadNotifications, getMyProfile } from '@/server/dal/student'
import type { Actor } from '@/server/auth/session'
import { StudentFrame, type StudentTab } from '@/components/states/shell-parts'

// Каркас экранов студента Э-2…Э-10 (S-2.1, раздел 2): шапка со знаком, группой и неделей, колокольчик и аватар вверху,
// четыре вкладки внизу. Вид — раздел 6 дизайн-системы (D-2.2-system); знак — раздел 7.
// Пометка «Концепт…» стоит в подвале страницы — layout.tsx.
// Разметка шапки и нижней панели лежит в states/shell-parts.tsx: те же части, без данных, стоят в состояниях «загрузка» и «ошибка».

export type { StudentTab }

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
    <StudentFrame
      active={active}
      data={{
        groupName: profile?.groupName ?? '',
        weekLine: week ? ` · ${week.number}-я неделя, ${week.kind}` : '',
        unread,
        initials: initials(profile?.fullName ?? ''),
      }}
    >
      {children}
    </StudentFrame>
  )
}
