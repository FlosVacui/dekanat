import { notFound } from 'next/navigation'
import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'
import { StudentShell } from '@/components/student-shell'
import { formatDate, todayIn } from '@/lib/dates'
import {
  REQUEST_KIND_INFO,
  STATUS_LABELS,
  isRequestKind,
  isRequestStatus,
  statusText,
  type RequestStatus,
} from '@/lib/requests'
import { denyRecord, requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getMyRequest } from '@/server/dal/student'

// Э-8 «Заявка»: шаги, что сейчас, что сделать студенту. Номер в адресе — номер записи; владельца берёт сервер из сессии.
export const dynamic = 'force-dynamic'

const STEPS: RequestStatus[] = ['submitted', 'in_progress', 'ready', 'issued']

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStudentActor()
  const { id } = await params
  const request = await getMyRequest(actor, id)
  // Слой вернул «не найдено»: чужая заявка или такой нет. Событие пишется, страница отвечает 404 (R-3.1-4).
  if (!request) return denyRecord(actor)
  if (!isRequestKind(request.kind) || !isRequestStatus(request.status)) notFound()
  const { kind, status } = request
  const rejected = status === 'rejected'
  const reached = new Set(request.events.map((e) => e.status))
  const currentIndex = STEPS.indexOf(status)

  return (
    <StudentShell actor={actor} active="requests">
      <PageTitle>
        {REQUEST_KIND_INFO[kind].title}
        <span className="block text-sm font-normal text-neutral-700">
          Подана {formatDate(todayIn(getConfig().timezone, request.createdAt))}
        </span>
      </PageTitle>
      <Card className="mb-3">
        <p className="text-sm text-neutral-700">Сейчас</p>
        <p data-testid="request-status" className="text-lg font-semibold">
          {STATUS_LABELS[status]}
        </p>
        <p data-testid="request-status-text" className="mt-1 text-sm">
          {statusText({
            kind,
            status,
            dueDate: request.dueDate,
            pickupUntil: request.pickupUntil,
            issuedOn: request.issuedOn,
            rejectReason: request.rejectReason,
          })}
        </p>
        {request.note ? <p className="mt-2 text-sm text-neutral-700">Примечание: {request.note}</p> : null}
      </Card>

      <h2 className="mb-2 text-base font-semibold">Шаги</h2>
      <ol className="mb-3 flex flex-col gap-2">
        {STEPS.map((step, index) => {
          const done = reached.has(step) && (rejected || index < currentIndex)
          const current = !rejected && index === currentIndex
          return (
            <li
              key={step}
              aria-current={current ? 'step' : undefined}
              className={`rounded border p-3 text-sm ${current ? 'border-blue-700 bg-blue-50 font-medium' : 'border-neutral-300 bg-white'}`}
            >
              {STATUS_LABELS[step]}
              {done ? ' — сделано' : current ? ' — сейчас' : ''}
            </li>
          )
        })}
        {rejected ? (
          <li className="rounded border border-red-700 bg-red-50 p-3 text-sm font-medium text-red-950">
            {STATUS_LABELS.rejected}
          </li>
        ) : null}
      </ol>

      {rejected ? (
        <LinkButton href={`/requests/new?type=${kind}`}>Подать снова</LinkButton>
      ) : null}
    </StudentShell>
  )
}
