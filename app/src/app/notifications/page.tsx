import Link from 'next/link'
import { Card, PageTitle } from '@/components/card'
import { EmptyState } from '@/components/grades/empty-state'
import { RequestIcon } from '@/components/requests/icons'
import { StudentShell } from '@/components/student-shell'
import { formatDate, todayIn } from '@/lib/dates'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listMyNotifications } from '@/server/dal/student'

// Э-9 «Уведомления»: заготовка — одна лента по времени, без фильтра. Фильтр, отметка «прочитано» — пакет 3.5.
// Только вид по дизайн-системе: карточка 5.2, плашка «Новое» 5.4 (золотая, без значка), пустое состояние 5.5.
export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const actor = await requireStudentActor()
  const items = await listMyNotifications(actor)
  const tz = getConfig().timezone
  return (
    <StudentShell actor={actor} active={null}>
      <PageTitle>Уведомления</PageTitle>
      {items.length === 0 ? (
        <EmptyState title="Уведомлений пока нет" text="Сообщения деканата о ваших заявках появятся здесь" />
      ) : (
        <ul className="flex flex-col gap-[var(--gap)]">
          {items.map((n) => {
            const body = (
              <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                <span className="flex flex-wrap items-center gap-x-[var(--sp-2)] gap-y-1 text-[length:var(--fs-sm)] text-muted">
                  {formatDate(todayIn(tz, n.createdAt))}
                  {n.read ? null : (
                    <span className="rounded-pill bg-accent-2-bg px-2 py-1 text-[length:var(--fs-xs)] font-bold leading-[1.2] text-accent-2-text">Новое</span>
                  )}
                </span>
                <span className="text-[length:var(--fs-md)] font-bold leading-[1.3]">{n.title}</span>
                <span className="text-[length:var(--fs-sm)]">{n.body}</span>
              </span>
            )
            return (
              <li key={n.id}>
                {n.link ? (
                  // Карточка-ссылка: рамка фокуса внутри карточки, отступ −3 px (раздел 5, «Общие правила»).
                  <Link
                    href={n.link}
                    className="flex min-h-[var(--tap)] items-start gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card active:bg-primary-soft focus-visible:-outline-offset-3"
                  >
                    {body}
                    <RequestIcon name="chevron" className="mt-1 size-4 flex-none text-primary" />
                  </Link>
                ) : (
                  <Card className="flex">{body}</Card>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </StudentShell>
  )
}
