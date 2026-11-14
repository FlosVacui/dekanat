import { redirect } from 'next/navigation'
import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'
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

const FIELD_CLASS = 'min-h-11 w-full rounded border border-neutral-400 bg-white px-3 text-base text-neutral-900'

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
      {limitText ? (
        <p role="alert" data-testid="request-limit" className="mb-3 rounded border border-red-700 bg-red-50 p-2 text-sm text-red-900">
          {limitText}
        </p>
      ) : null}
      <Card>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-neutral-700">Вид</dt>
            <dd className="text-base font-semibold">{info.title}</dd>
          </div>
          <div>
            <dt className="text-neutral-700">Срок изготовления</dt>
            <dd>{info.productionTime}</dd>
          </div>
          <div>
            <dt className="text-neutral-700">Где и как получить</dt>
            <dd>{info.pickup}</dd>
          </div>
        </dl>
      </Card>
      <form action={createRequestAction} className="mt-4 flex flex-col gap-2">
        <input type="hidden" name="kind" value={type} />
        {type === 'dean_certificate' && fieldTitle ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="request-purpose" className="text-sm font-medium">
              {fieldTitle}
            </label>
            <select id="request-purpose" name="purpose" defaultValue={fields.purpose ?? undefined} className={FIELD_CLASS}>
              {DEAN_PURPOSES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {type === 'tuition_certificate' && fieldTitle ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="request-payment-year" className="text-sm font-medium">
              {fieldTitle}
            </label>
            <select
              id="request-payment-year"
              name="paymentYear"
              defaultValue={fields.paymentYear === null ? undefined : String(fields.paymentYear)}
              className={FIELD_CLASS}
            >
              {paymentYears(year).map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <SubmitButton>Отправить</SubmitButton>
        <LinkButton href="/requests" variant="ghost">
          Назад к заявкам
        </LinkButton>
      </form>
    </StudentShell>
  )
}
