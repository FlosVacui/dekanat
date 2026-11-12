import Link from 'next/link'
import { Card, PageTitle } from '@/components/card'
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
        <Card>
          <p className="text-sm">Заявок пока нет</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.id}>
              <Link href={`/staff/requests/${r.id}`} className="block rounded-lg border border-neutral-300 bg-white p-4">
                <span className="block text-base font-semibold">{r.studentName}</span>
                <span className="block text-sm text-neutral-700">Группа {r.groupName}</span>
                <span className="block text-sm">{isRequestKind(r.kind) ? REQUEST_KIND_INFO[r.kind].title : 'Заявка'}</span>
                <span className="block text-sm text-neutral-700">Подана {formatDate(todayIn(tz, r.createdAt))}</span>
                <span className="mt-1 block text-sm font-medium">
                  Статус: {isRequestStatus(r.status) ? STATUS_LABELS[r.status] : r.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </StaffShell>
  )
}
