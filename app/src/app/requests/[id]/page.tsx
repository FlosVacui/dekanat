import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LinkButton } from '@/components/link-button'
import { StudentShell } from '@/components/student-shell'
import { formatDate, todayIn } from '@/lib/dates'
import {
  REQUEST_KIND_INFO,
  STATUS_LABELS,
  STEP_STATE_WORDS,
  buildRequestSteps,
  isRequestKind,
  isRequestStatus,
  requestFieldLine,
  statusText,
  type StepState,
} from '@/lib/requests'
import { denyRecord, requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getMyRequest } from '@/server/dal/student'

// Э-8 «Заявка»: ссылка «Все заявки», заголовок, статус словом, блок «Что сделать вам», шаги с пояснениями, кнопки
// (D-2.2-system, 5.12). Набор шагов собирает чистая функция buildRequestSteps; страница только рисует.
// Номер в адресе — номер записи; владельца берёт сервер из сессии.
export const dynamic = 'force-dynamic'

const STATE_WORD_CLASS: Record<StepState, string> = {
  done: 'text-green-900',
  now: 'text-blue-800',
  next: 'text-neutral-700',
  next_you: 'text-neutral-700',
  rejected: 'text-red-900',
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStudentActor()
  const { id } = await params
  const request = await getMyRequest(actor, id)
  // Слой вернул «не найдено»: чужая заявка или такой нет. Событие пишется, страница отвечает 404 (R-3.1-4).
  if (!request) return denyRecord(actor)
  if (!isRequestKind(request.kind) || !isRequestStatus(request.status)) notFound()
  const { kind, status } = request
  const timezone = getConfig().timezone
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
      <Link href="/requests" className="mb-1 inline-flex min-h-11 items-center gap-1 self-start pr-3 text-sm font-bold text-blue-800">
        <span aria-hidden="true">←</span>
        Все заявки
      </Link>

      <h1 className="mb-3 text-xl font-semibold">
        {REQUEST_KIND_INFO[kind].title}
        <span className="block text-sm font-normal text-neutral-700">Подана {formatDate(todayIn(timezone, request.createdAt))}</span>
        {fieldLine ? (
          <span data-testid="request-field" className="block break-words text-sm font-normal text-neutral-700">
            {fieldLine}
          </span>
        ) : null}
      </h1>

      <p className="mb-3 text-lg font-semibold">
        <span className="sr-only">Статус: </span>
        <span data-testid="request-status">{STATUS_LABELS[status]}</span>
      </p>

      {status !== 'issued' ? (
        <section aria-labelledby="request-todo-title" className="mb-3 rounded-lg border border-blue-700 bg-blue-50 p-4">
          <h2 id="request-todo-title" className="mb-1 text-base font-bold">
            Что сделать вам
          </h2>
          <p data-testid="request-status-text" className="text-sm">
            {statusText({
              kind,
              status,
              dueDate: request.dueDate,
              pickupUntil: request.pickupUntil,
              issuedOn: request.issuedOn,
              rejectReason: request.rejectReason,
            })}
          </p>
        </section>
      ) : null}

      {request.note ? <p className="mb-3 break-words text-sm text-neutral-700">Примечание: {request.note}</p> : null}

      <ol aria-label="Шаги заявки" className="mb-4 flex flex-col gap-2">
        {steps.map((step) => (
          <li
            key={step.key}
            aria-current={step.current ? 'step' : undefined}
            className={`rounded border p-3 text-sm ${
              step.state === 'now'
                ? 'border-blue-700 bg-blue-50'
                : step.state === 'rejected'
                  ? 'border-red-700 bg-red-50'
                  : 'border-neutral-300 bg-white'
            }`}
          >
            <span className={`block text-xs font-extrabold tracking-wide ${STATE_WORD_CLASS[step.state]}`}>
              {STEP_STATE_WORDS[step.state]}
            </span>
            <b className="block text-base">{step.title}</b>
            {step.note ? <p className="mt-1 break-words text-neutral-700">{step.note}</p> : null}
            {step.where ? (
              <dl className="mt-2 grid grid-cols-[fit-content(50%)_1fr] gap-x-3 gap-y-1 rounded bg-white p-2">
                <dt className="text-neutral-700">Куда</dt>
                <dd className="break-words font-bold">{step.where.room}</dd>
                {step.where.until ? (
                  <>
                    <dt className="text-neutral-700">До какого дня</dt>
                    <dd className="break-words font-bold">{step.where.until}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        {rejected ? <LinkButton href={`/requests/new?type=${kind}&from=${request.id}`}>Подать снова</LinkButton> : null}
        <LinkButton href="/requests" variant="ghost">
          К списку заявок
        </LinkButton>
      </div>
    </StudentShell>
  )
}
