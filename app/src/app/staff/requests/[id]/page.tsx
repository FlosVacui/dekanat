import { notFound } from 'next/navigation'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { BackLink } from '@/components/requests/back-link'
import { RequestStatusChip } from '@/components/requests/status-chip'
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
  requestFieldView,
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
  const fieldView = requestFieldView(request.kind, request)
  const options = nextStatuses(request.status).map((status) => ({ status, label: STATUS_LABELS[status] }))
  const reasons = REJECT_REASONS.map((reason) => ({ status: reason, label: REJECT_REASON_LABELS[reason] }))
  return (
    <StaffShell>
      <div className="flex flex-col gap-[var(--gap)]">
        <BackLink href="/staff/requests">К списку заявок</BackLink>
        <PageTitle>{REQUEST_KIND_INFO[request.kind].title}</PageTitle>
        <Card>
          <dl className="flex flex-col gap-[var(--sp-3)]">
            <div>
              <dt className="text-[length:var(--fs-sm)] text-muted">Студент</dt>
              <dd className="text-[length:var(--fs-md)] font-bold">{request.studentName}</dd>
            </div>
            {fieldView ? (
              <div>
                <dt className="text-[length:var(--fs-sm)] text-muted">{fieldView.title}</dt>
                <dd className="break-words text-[length:var(--fs-md)]">{fieldView.value}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[length:var(--fs-sm)] text-muted">Группа</dt>
              <dd className="text-[length:var(--fs-md)]">{request.groupName}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--fs-sm)] text-muted">Подана</dt>
              <dd className="text-[length:var(--fs-md)]">{formatDate(todayIn(tz, request.createdAt))}</dd>
            </div>
            <div className="flex flex-col items-start gap-1">
              <dt className="text-[length:var(--fs-sm)] text-muted">Статус</dt>
              <dd>
                <RequestStatusChip status={request.status} statusTestId="staff-request-status" />
              </dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardTitle>История статусов</CardTitle>
          <ol className="flex flex-col gap-[var(--sp-1)] text-[length:var(--fs-sm)]">
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
      </div>
    </StaffShell>
  )
}
