import Link from 'next/link'
import { PageTitle } from '@/components/card'
import { EmptyState } from '@/components/grades/empty-state'
import { RequestIcon } from '@/components/requests/icons'
import { RequestStatusChip } from '@/components/requests/status-chip'
import { StaffShell } from '@/components/staff-shell'
import { formatDate, todayIn } from '@/lib/dates'
import { REQUEST_KIND_INFO, STATUS_LABELS, isRequestKind, isRequestStatus } from '@/lib/requests'
import { requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listCohortRequests } from '@/server/dal/staff'

// Э-11 «Заявки — сотрудник»: простой список заявок студентов своего набора, без поиска (S-2.1, раздел 3).
export const dynamic = 'force-dynamic'

export default async function StaffRequestsPage() {
  const actor = await requireStaffActor()
  const items = await listCohortRequests(actor)
  const tz = getConfig().timezone
  return (
    <StaffShell>
      <PageTitle>Заявки студентов</PageTitle>
      {items.length === 0 ? (
        <EmptyState title="Заявок пока нет" text="Когда студенты подадут заявки, они появятся здесь" />
      ) : (
        <ul className="flex flex-col gap-[var(--gap)]">
          {items.map((r) => (
            <li key={r.id}>
              {/* Карточка-ссылка: рамка фокуса внутри карточки, отступ −3 px. Текст «Статус: Подана» — одним узлом: по нему скрипт снимков находит заявку. */}
              <Link
                href={`/staff/requests/${r.id}`}
                className="flex min-h-[var(--tap)] items-start gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card active:bg-primary-soft focus-visible:-outline-offset-3"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                  <span className="text-[length:var(--fs-md)] font-bold leading-[1.3]">{r.studentName}</span>
                  <span className="text-[length:var(--fs-sm)] text-muted">Группа {r.groupName}</span>
                  <span className="text-[length:var(--fs-sm)]">{isRequestKind(r.kind) ? REQUEST_KIND_INFO[r.kind].title : 'Заявка'}</span>
                  <span className="text-[length:var(--fs-sm)] text-muted">Подана {formatDate(todayIn(tz, r.createdAt))}</span>
                  {isRequestStatus(r.status) ? (
                    <RequestStatusChip status={r.status} label={`Статус: ${STATUS_LABELS[r.status]}`} />
                  ) : (
                    <span className="text-[length:var(--fs-sm)] font-bold">Статус: {r.status}</span>
                  )}
                </span>
                <RequestIcon name="chevron" className="mt-1 size-4 flex-none text-primary" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </StaffShell>
  )
}
