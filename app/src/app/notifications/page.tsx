import Link from 'next/link'
import { Card, PageTitle } from '@/components/card'
import { StudentShell } from '@/components/student-shell'
import { formatDate, todayIn } from '@/lib/dates'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listMyNotifications } from '@/server/dal/student'

// Э-9 «Уведомления»: заготовка — одна лента по времени, без фильтра. Фильтр, отметка «прочитано» — пакет 3.5.
export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const actor = await requireStudentActor()
  const items = await listMyNotifications(actor)
  const tz = getConfig().timezone
  return (
    <StudentShell actor={actor} active={null}>
      <PageTitle>Уведомления</PageTitle>
      {items.length === 0 ? (
        <Card>
          <p className="text-sm">Уведомлений пока нет</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((n) => {
            const body = (
              <>
                <span className="block text-sm text-neutral-700">
                  {formatDate(todayIn(tz, n.createdAt))}
                  {n.read ? '' : ' · Новое'}
                </span>
                <span className="block text-base font-semibold">{n.title}</span>
                <span className="block text-sm">{n.body}</span>
              </>
            )
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className="block rounded-lg border border-neutral-300 bg-white p-4">
                    {body}
                  </Link>
                ) : (
                  <Card>{body}</Card>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </StudentShell>
  )
}
