import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { StaffShell } from '@/components/staff-shell'
import { formatDate, todayIn } from '@/lib/dates'
import {
  REJECT_REASONS,
  REJECT_REASON_LABELS,
  REQUEST_KIND_INFO,
  STATUS_LABELS,
  isRequestKind,
  isRequestStatus,
  nextStatuses,
} from '@/lib/requests'
import { denyRecord, requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getCohortRequest } from '@/server/dal/staff'
import { StatusForm } from './status-form'

// Э-12 «Заявка — сотрудник»: данные заявки, история статусов, кнопки допустимых переходов. Заготовка (полный экран — пакет 3.9).
export const dynamic = 'force-dynamic'

export default async function StaffRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor()
  const { id } = await params
  const request = await getCohortRequest(actor, id)
  // Слой вернул «не найдено»: заявка другого набора или такой нет. Событие пишется, страница отвечает 404 (R-3.1-4).
  if (!request) return denyRecord(actor)
  if (!isRequestKind(request.kind) || !isRequestStatus(request.status)) notFound()
  const tz = getConfig().timezone
  const options = nextStatuses(request.status).map((status) => ({ status, label: STATUS_LABELS[status] }))
  const reasons = REJECT_REASONS.map((reason) => ({ status: reason, label: REJECT_REASON_LABELS[reason] }))
  return (
    <StaffShell>
      <Link href="/staff/requests" className="mb-2 inline-flex min-h-11 items-center text-sm text-blue-800 underline">
        К списку заявок
      </Link>
      <PageTitle>{REQUEST_KIND_INFO[request.kind].title}</PageTitle>
      <Card className="mb-3">
        <dl className="flex flex-col gap-2 text-sm">
          <div>
            <dt className="text-neutral-700">Студент</dt>
            <dd className="text-base font-medium">{request.studentName}</dd>
          </div>
          <div>
            <dt className="text-neutral-700">Группа</dt>
            <dd>{request.groupName}</dd>
          </div>
          <div>
            <dt className="text-neutral-700">Подана</dt>
            <dd>{formatDate(todayIn(tz, request.createdAt))}</dd>
          </div>
          <div>
            <dt className="text-neutral-700">Статус</dt>
            <dd data-testid="staff-request-status" className="text-base font-semibold">
              {STATUS_LABELS[request.status]}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="mb-3">
        <CardTitle>История статусов</CardTitle>
        <ol className="flex flex-col gap-1 text-sm">
          {request.events.map((e, index) => (
            <li key={`${e.status}-${index}`}>
              {formatDate(todayIn(tz, e.createdAt))} — {isRequestStatus(e.status) ? STATUS_LABELS[e.status] : e.status}
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardTitle>Сменить статус</CardTitle>
        <StatusForm requestId={request.id} options={options} reasons={reasons} />
      </Card>
    </StaffShell>
  )
}
