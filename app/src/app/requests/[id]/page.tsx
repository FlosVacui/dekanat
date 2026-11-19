import { notFound } from 'next/navigation'
import { LinkButton } from '@/components/link-button'
import { BackLink } from '@/components/requests/back-link'
import { RequestStatusChip } from '@/components/requests/status-chip'
import { RequestSteps } from '@/components/requests/steps'
import { TodoBlock } from '@/components/requests/todo-block'
import { StudentShell } from '@/components/student-shell'
import { formatDate, todayIn } from '@/lib/dates'
import { REQUEST_KIND_INFO, buildRequestSteps, isRequestKind, isRequestStatus, requestFieldLine, statusText } from '@/lib/requests'
import { denyRecord, requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getMyRequest } from '@/server/dal/student'

// Э-8 «Заявка»: ссылка «Все заявки», заголовок, плашка статуса, блок «Что сделать вам», шаги с пояснениями, кнопки
// (D-2.2-system, 5.8–5.12). Набор шагов собирает чистая функция buildRequestSteps; страница только рисует.
// Номер в адресе — номер записи; владельца берёт сервер из сессии.
// Строки «Подана …» и «Куда: …» стоят под заголовком, а не внутри <h1>: имя заголовка — только название заявки (IMP-024, пункт 3).
export const dynamic = 'force-dynamic'

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStudentActor()
  const { id } = await params
  const request = await getMyRequest(actor, id)
  // Слой вернул «не найдено»: чужая заявка или такой нет. Событие пишется, страница отвечает 404 (R-3.1-4).
  if (!request) return denyRecord(actor)
  if (!isRequestKind(request.kind) || !isRequestStatus(request.status)) notFound()
  const { kind, status } = request
  const { timezone, certificateSecret } = getConfig()
  // Печатная справка с QR есть у справки об обучении в статусе «Готова» или «Выдана», если на сервере задан секрет подписи.
  const hasCertificate = Boolean(certificateSecret) && kind === 'dean_certificate' && (status === 'ready' || status === 'issued')
  const rejected = status === 'rejected'
  const fieldLine = requestFieldLine(kind, request)
  const steps = buildRequestSteps({
    kind,
    status,
    events: request.events,
    createdAt: request.createdAt,
    dueDate: request.dueDate,
    pickupUntil: request.pickupUntil,
    issuedOn: request.issuedOn,
    timezone,
  })

  return (
    <StudentShell actor={actor} active="requests">
      <div className="flex flex-col gap-[var(--gap)]">
        <BackLink href="/requests">Все заявки</BackLink>

        <div className="flex flex-col gap-[var(--sp-1)]">
          <h1 className="text-[length:var(--h1-size)] font-bold leading-[1.15]">{REQUEST_KIND_INFO[kind].title}</h1>
          <p className="text-[length:var(--fs-sm)] leading-[1.4] text-muted">Подана {formatDate(todayIn(timezone, request.createdAt))}</p>
          {fieldLine ? (
            <p data-testid="request-field" className="break-words text-[length:var(--fs-sm)] leading-[1.4] text-muted">
              {fieldLine}
            </p>
          ) : null}
        </div>

        <RequestStatusChip status={status} srPrefix statusTestId="request-status" />

        {status !== 'issued' ? (
          <TodoBlock
            testId="request-status-text"
            text={statusText({
              kind,
              status,
              dueDate: request.dueDate,
              pickupUntil: request.pickupUntil,
              issuedOn: request.issuedOn,
              rejectReason: request.rejectReason,
            })}
          />
        ) : null}

        {request.note ? <p className="break-words text-[length:var(--fs-sm)] text-muted">Примечание: {request.note}</p> : null}

        <RequestSteps steps={steps} />

        <div className="flex flex-col gap-[var(--sp-2)]">
          {hasCertificate ? <LinkButton href={`/requests/${request.id}/certificate`}>Открыть справку с QR</LinkButton> : null}
          {rejected ? <LinkButton href={`/requests/new?type=${kind}&from=${request.id}`}>Подать снова</LinkButton> : null}
          <LinkButton href="/requests" variant="ghost">
            К списку заявок
          </LinkButton>
        </div>
      </div>
    </StudentShell>
  )
}
