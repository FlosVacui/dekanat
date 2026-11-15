import { redirect } from 'next/navigation'
import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'
import { RequestIcon } from '@/components/requests/icons'
import { SelectField } from '@/components/requests/select-field'
import { StudentShell } from '@/components/student-shell'
import { SubmitButton } from '@/components/submit-button'
import {
  DEAN_PURPOSES,
  REQUEST_KIND_INFO,
  currentYearIn,
  defaultFields,
  isRequestKind,
  paymentYears,
  requestFieldView,
  reuseFields,
} from '@/lib/requests'
import { denyRecord, requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getMyRequest } from '@/server/dal/student'
import { createRequestAction } from './actions'

// Э-7 «Новая заявка»: вид, срок изготовления, где и как получить, поле своего вида со значением по умолчанию.
// «Подать снова»: адрес `?type=<вид>&from=<номер прежней заявки>` — прежние значения читаются из базы через слой доступа,
// владельца берёт сервер из сессии; значения полей в адрес не кладутся.
export const dynamic = 'force-dynamic'

// Отказ по лимиту записи (ADR-0003): страница выбирает один из двух готовых текстов по коду из адреса.
const LIMIT_TEXT: Record<string, string> = {
  pair: 'С вашего адреса сегодня подано слишком много заявок. Попробуйте завтра',
  account: 'Сегодня с этого аккаунта подано слишком много заявок. Попробуйте завтра',
}

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[]; from?: string | string[]; limit?: string | string[] }>
}) {
  const actor = await requireStudentActor()
  const { type, from, limit } = await searchParams
  if (!isRequestKind(type)) redirect('/requests')
  const info = REQUEST_KIND_INFO[type]
  const year = currentYearIn(getConfig().timezone)

  let fields = defaultFields(type, year)
  if (from !== undefined) {
    if (typeof from !== 'string') redirect('/requests')
    // Заявка по номеру: слой ищет её вместе с владельцем из сессии. Чужая и несуществующая — «нет такой заявки».
    const previous = await getMyRequest(actor, from)
    if (!previous) return denyRecord(actor)
    if (previous.kind !== type) redirect('/requests')
    fields = reuseFields(type, previous, year)
  }

  const limitText = typeof limit === 'string' && Object.hasOwn(LIMIT_TEXT, limit) ? LIMIT_TEXT[limit] : undefined
  const fieldTitle = requestFieldView(type, fields)?.title

  return (
    <StudentShell actor={actor} active="requests">
      <PageTitle>Новая заявка</PageTitle>
      <div className="flex flex-col gap-[var(--gap)]">
        {limitText ? (
          // Отказ по лимиту по 5.6: значок «внимание» в круге --error-bg и текст --fs-md, вес 800, цвет --error. Объявляется сам (role="alert").
          <div role="alert" data-testid="request-limit" className="flex items-center gap-[var(--sp-3)] rounded-surface border border-error bg-card p-[var(--card-pad)] shadow-card">
            <span className="grid size-11 flex-none place-items-center rounded-full bg-error-bg text-error">
              <RequestIcon name="alert" className="size-6" strokeWidth={2} />
            </span>
            <p className="min-w-0 text-[length:var(--fs-md)] font-extrabold leading-[1.3] text-error">{limitText}</p>
          </div>
        ) : null}
        <Card>
          <dl className="flex flex-col gap-[var(--sp-3)]">
            <div>
              <dt className="text-[length:var(--fs-sm)] text-muted">Вид</dt>
              <dd className="text-[length:var(--fs-md)] font-bold">{info.title}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--fs-sm)] text-muted">Срок изготовления</dt>
              <dd className="text-[length:var(--fs-md)]">{info.productionTime}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--fs-sm)] text-muted">Где и как получить</dt>
              <dd className="text-[length:var(--fs-md)]">{info.pickup}</dd>
            </div>
          </dl>
        </Card>
        <form action={createRequestAction} className="flex flex-col gap-[var(--gap)]">
          <input type="hidden" name="kind" value={type} />
          {type === 'dean_certificate' && fieldTitle ? (
            <Card>
              <SelectField id="request-purpose" name="purpose" label={fieldTitle} defaultValue={fields.purpose ?? undefined}>
                {DEAN_PURPOSES.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </SelectField>
            </Card>
          ) : null}
          {type === 'tuition_certificate' && fieldTitle ? (
            <Card>
              <SelectField
                id="request-payment-year"
                name="paymentYear"
                label={fieldTitle}
                defaultValue={fields.paymentYear === null ? undefined : String(fields.paymentYear)}
              >
                {paymentYears(year).map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </SelectField>
            </Card>
          ) : null}
          <div className="flex flex-col gap-[var(--sp-2)]">
            <SubmitButton>Отправить</SubmitButton>
            <LinkButton href="/requests" variant="ghost">
              Назад к заявкам
            </LinkButton>
          </div>
        </form>
      </div>
    </StudentShell>
  )
}
