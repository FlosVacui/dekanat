import { notFound } from 'next/navigation'
import { Card } from '@/components/card'
import { LinkButton } from '@/components/link-button'
import { BackLink } from '@/components/requests/back-link'
import { RATING_DOWN, RATING_UP } from '@/components/requests/rating'
import { RequestStatusChip } from '@/components/requests/status-chip'
import { RequestSteps } from '@/components/requests/steps'
import { TodoBlock } from '@/components/requests/todo-block'
import { WITHDRAWN_LABEL, isWithdrawn, requestStatusText, requestSteps } from '@/components/requests/withdrawn'
import { StudentShell } from '@/components/student-shell'
import { Button } from '@/components/ui/button'
import { formatDate, todayIn } from '@/lib/dates'
import { REQUEST_KIND_INFO, isRequestKind, isRequestStatus, requestFieldLine } from '@/lib/requests'
import { denyRecord, requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getMyRequest } from '@/server/dal/student'
import { rateRequestAction, withdrawRequestAction } from './actions'

// Э-8 «Заявка»: ссылка «Все заявки», заголовок, плашка статуса, блок «Что сделать вам», шаги с пояснениями, кнопки
// (D-2.2-system, 5.8–5.12). Набор шагов собирает чистая функция buildRequestSteps; страница только рисует.
// Номер в адресе — номер записи; владельца берёт сервер из сессии.
// Строки «Подана …» и «Куда: …» стоят под заголовком, а не внутри <h1>: имя заголовка — только название заявки (IMP-024, пункт 3).
// 20.11: у заявки «Подана» — «Отозвать» с подтверждением второй кнопкой (`?withdraw=1`, без скриптов); у «Готова» и «Выдана» —
// «Заказать ещё раз» (форма новой заявки с теми же видом и назначением); у «Выдана» — оценка «Как прошло?».
export const dynamic = 'force-dynamic'

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  /** Следующий приводит параметры сам; необязательный — чтобы страницу можно было вызвать в тесте только с номером. */
  searchParams?: Promise<{ withdraw?: string | string[]; notice?: string | string[] }>
}) {
  const actor = await requireStudentActor()
  const { id } = await params
  const { withdraw, notice } = (await searchParams) ?? {}
  const request = await getMyRequest(actor, id)
  // Слой вернул «не найдено»: чужая заявка или такой нет. Событие пишется, страница отвечает 404 (R-3.1-4).
  if (!request) return denyRecord(actor)
  if (!isRequestKind(request.kind) || !isRequestStatus(request.status)) notFound()
  const { kind, status } = request
  const { timezone, certificateSecret } = getConfig()
  // Печатная справка с QR есть у справки об обучении в статусе «Готова» или «Выдана», если на сервере задан секрет подписи.
  const hasCertificate = Boolean(certificateSecret) && kind === 'dean_certificate' && (status === 'ready' || status === 'issued')
  const rejected = status === 'rejected'
  const withdrawn = isWithdrawn(request)
  const confirmWithdraw = status === 'submitted' && withdraw === '1'
  const notWithdrawn = notice === 'not-withdrawn' && status !== 'submitted'
  const fieldLine = requestFieldLine(kind, request)
  const steps = requestSteps({
    kind,
    status,
    rejectReason: request.rejectReason,
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

        <RequestStatusChip
          status={status}
          srPrefix
          statusTestId="request-status"
          label={withdrawn ? WITHDRAWN_LABEL : undefined}
          className={withdrawn ? 'bg-primary-soft text-primary' : undefined}
        />

        {notWithdrawn ? (
          <p role="alert" data-testid="request-notice" className="rounded-surface bg-accent-2-bg p-[var(--card-pad)] text-[length:var(--fs-sm)] font-bold text-accent-2-text">
            Заявку уже взяли в работу, отозвать её нельзя. Если она не нужна, напишите в деканат
          </p>
        ) : null}

        {status !== 'issued' ? (
          <TodoBlock
            testId="request-status-text"
            text={requestStatusText({
              kind,
              status,
              dueDate: request.dueDate,
              pickupUntil: request.pickupUntil,
              issuedOn: request.issuedOn,
              rejectReason: request.rejectReason,
            })}
          />
        ) : null}

        {confirmWithdraw ? (
          // Подтверждение без скриптов: страница с `?withdraw=1` показывает вторую кнопку. Отозвать можно только пока заявка «Подана».
          <section aria-labelledby="request-withdraw-title" data-testid="request-withdraw-confirm" className="flex flex-col gap-[var(--sp-2)] rounded-surface border-2 border-primary bg-card p-[var(--card-pad)]">
            <h2 id="request-withdraw-title" className="text-[length:var(--fs-md)] font-bold">
              Отозвать заявку?
            </h2>
            <p className="text-[length:var(--fs-sm)] text-muted">Деканат её не увидит в работе. Подать новую можно в любой момент.</p>
            <form action={withdrawRequestAction} className="flex flex-col gap-[var(--sp-2)]">
              <input type="hidden" name="requestId" value={request.id} />
              <Button type="submit" data-testid="request-withdraw-yes">
                Да, отозвать
              </Button>
              <LinkButton href={`/requests/${request.id}`} variant="ghost">
                Нет, оставить
              </LinkButton>
            </form>
          </section>
        ) : null}

        {request.note ? <p className="break-words text-[length:var(--fs-sm)] text-muted">Примечание: {request.note}</p> : null}

        <RequestSteps steps={steps} />

        {status === 'issued' ? (
          <Card>
            <section aria-labelledby="request-rating-title" data-testid="request-rating" className="flex flex-col gap-[var(--sp-2)]">
              <h2 id="request-rating-title" className="text-[length:var(--fs-md)] font-bold">
                Как прошло?
              </h2>
              <p data-testid="request-rating-state" className="text-[length:var(--fs-sm)] text-muted">
                {request.rating === null ? 'Оцените, как деканат выдал документ. Оценку можно сменить' : `Ваша оценка: ${request.rating === RATING_UP ? 'хорошо' : 'плохо'}. Её можно сменить`}
              </p>
              <form action={rateRequestAction} className="flex gap-[var(--sp-2)]">
                <input type="hidden" name="requestId" value={request.id} />
                <Button type="submit" name="value" value="up" variant={request.rating === RATING_UP ? 'primary' : 'ghost'} aria-pressed={request.rating === RATING_UP} className="flex-1 px-3">
                  <span aria-hidden="true">👍</span>&nbsp;Хорошо
                </Button>
                <Button type="submit" name="value" value="down" variant={request.rating === RATING_DOWN ? 'primary' : 'ghost'} aria-pressed={request.rating === RATING_DOWN} className="flex-1 px-3">
                  <span aria-hidden="true">👎</span>&nbsp;Плохо
                </Button>
              </form>
            </section>
          </Card>
        ) : null}

        <div className="flex flex-col gap-[var(--sp-2)]">
          {hasCertificate ? <LinkButton href={`/requests/${request.id}/certificate`}>Открыть справку с QR</LinkButton> : null}
          {rejected ? <LinkButton href={`/requests/new?type=${kind}&from=${request.id}`}>Подать снова</LinkButton> : null}
          {status === 'ready' || status === 'issued' ? (
            <LinkButton href={`/requests/new?type=${kind}&from=${request.id}`} variant="ghost" data-testid="request-again">
              Заказать ещё раз
            </LinkButton>
          ) : null}
          {status === 'submitted' && !confirmWithdraw ? (
            <LinkButton href={`/requests/${request.id}?withdraw=1`} variant="ghost" data-testid="request-withdraw">
              Отозвать
            </LinkButton>
          ) : null}
          <LinkButton href="/requests" variant="ghost">
            К списку заявок
          </LinkButton>
        </div>
      </div>
    </StudentShell>
  )
}
