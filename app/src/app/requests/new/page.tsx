import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'
import { RequestIcon } from '@/components/requests/icons'
import { SelectField } from '@/components/requests/select-field'
import { LoadingCard } from '@/components/states/loading-card'
import { StudentFrame } from '@/components/states/shell-parts'
import { StudentShell } from '@/components/student-shell'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { todayIn } from '@/lib/dates'
import { INTENT_SOURCE_LABELS, intentExtras, type Intent, type IntentSource } from '@/lib/intent'
import {
  DEAN_PURPOSES,
  REQUEST_KINDS,
  REQUEST_KIND_INFO,
  currentYearIn,
  defaultFields,
  isRequestKind,
  paymentYears,
  requestFieldView,
  reuseFields,
  type RequestFields,
  type RequestKind,
} from '@/lib/requests'
import { denyRecord, requireStudentActor } from '@/server/auth/page-guards'
import type { Actor } from '@/server/auth/session'
import { aiEnabled, parseRequestIntent } from '@/server/ai'
import { getConfig } from '@/server/config'
import { getMyRequest } from '@/server/dal/student'
import { createReadyCertificateAction, createRequestAction } from './actions'

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
  searchParams: Promise<{ type?: string | string[]; from?: string | string[]; limit?: string | string[]; q?: string | string[] }>
}) {
  // Вход проверяется выше границы ожидания: после начала потока отказ уже не получил бы код 307 или 403 (пакет 3.7).
  const actor = await requireStudentActor()
  const { type, from, limit, q } = await searchParams
  const tz = getConfig().timezone
  const year = currentYearIn(tz)

  // Заявка одной фразой: `?q=<фраза>`, обычная форма GET, работает без скриптов. Разбор на сервере: моделью, если есть ключ
  // (19.11, ИИ-функции), иначе или при любой неудаче — по ключевым словам; подпись говорит, кто разобрал. Модели уходит
  // только фраза. Подаёт заявку студент сам, здесь форма только предзаполняется. Распознан вид — он важнее `type` из адреса.
  const phrase = typeof q === 'string' ? q.trim().slice(0, 300) : ''
  const parsed = phrase ? await parseRequestIntent(phrase, todayIn(tz), actor.userId) : null
  const intent = parsed?.intent ?? null
  const source = parsed?.source ?? null

  let kind: RequestKind
  let fields: RequestFields
  if (intent?.recognized && intent.kind) {
    kind = intent.kind
    const defaults = defaultFields(kind, year)
    fields = { purpose: intent.purpose ?? defaults.purpose, paymentYear: intent.paymentYear ?? defaults.paymentYear }
  } else {
    if (!isRequestKind(type)) redirect('/requests')
    kind = type
    fields = defaultFields(kind, year)
    if (from !== undefined) {
      if (typeof from !== 'string') redirect('/requests')
      // Заявка по номеру: слой ищет её вместе с владельцем из сессии. Чужая и несуществующая — «нет такой заявки».
      const previous = await getMyRequest(actor, from)
      if (!previous) return denyRecord(actor)
      if (previous.kind !== kind) redirect('/requests')
      fields = reuseFields(kind, previous, year)
    }
  }

  // Всё, что могло увести на другую страницу или ответить «нет такой заявки», выше границы ожидания (пакет 3.7).
  // Ниже — только разметка с каркасом: этой странице читать нечего, кроме шапки.
  return (
    <Suspense
      fallback={
        <StudentFrame data={null} active="requests">
          <LoadingCard label="Загружаем заявки…" />
        </StudentFrame>
      }
    >
      <NewRequestContent actor={actor} type={kind} fields={fields} year={year} limit={limit} phrase={phrase} intent={intent} source={source} />
    </Suspense>
  )
}

// Рисует экран. Внутри границы нет redirect(), notFound(), forbidden() и denyRecord().
async function NewRequestContent({
  actor,
  type,
  fields,
  year,
  limit,
  phrase,
  intent,
  source,
}: {
  actor: Actor
  type: RequestKind
  fields: RequestFields
  year: number
  limit: string | string[] | undefined
  phrase: string
  intent: Intent | null
  source: IntentSource | null
}) {
  const info = REQUEST_KIND_INFO[type]
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
          <form action="/requests/new" method="get" className="flex flex-col gap-[var(--sp-2)]">
            <input type="hidden" name="type" value={type} />
            <label htmlFor="request-phrase" className="text-[length:var(--fs-sm)] font-bold">
              Опишите, что нужно
            </label>
            <input
              id="request-phrase"
              name="q"
              type="text"
              defaultValue={phrase}
              maxLength={300}
              autoComplete="off"
              aria-describedby="request-phrase-hint"
              className="min-h-[var(--control-h)] w-full rounded-control border-2 border-border-strong bg-card px-[var(--sp-4)] text-[length:var(--fs-md)] text-text focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
            <p id="request-phrase-hint" className="text-[length:var(--fs-sm)] text-muted">
              {aiEnabled() ? 'Фразу разбирает ИИ; если не выйдет, подберём по ключевым словам.' : 'Подбор по ключевым словам.'} Например: справка в налоговую к пятнице, 2 экземпляра
            </p>
            <Button type="submit" variant="soft">
              Заполнить
            </Button>
          </form>
          {intent ? (
            intent.recognized ? (
              <div role="status" data-testid="intent-result" className="mt-[var(--sp-3)] flex flex-col gap-1 rounded-control bg-primary-soft p-[var(--sp-3)] text-[length:var(--fs-sm)]">
                <p className="font-bold">Форма заполнена: {REQUEST_KIND_INFO[type].title}. Проверьте и отправьте</p>
                {source ? (
                  <p data-testid="intent-source" className="text-muted">
                    {INTENT_SOURCE_LABELS[source]}
                  </p>
                ) : null}
                {intentExtras(intent).map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {intentExtras(intent).length > 0 ? (
                  <p className="text-muted">Срок и число экземпляров в заявку не записываются: сроки определяет деканат</p>
                ) : null}
              </div>
            ) : (
              <div role="status" data-testid="intent-result" className="mt-[var(--sp-3)] flex flex-col gap-[var(--sp-2)]">
                <p className="text-[length:var(--fs-sm)] font-bold">Не понял, выберите тип справки ниже</p>
                <div className="flex flex-col gap-[var(--sp-2)]">
                  {REQUEST_KINDS.map((k) => (
                    <LinkButton key={k} href={`/requests/new?type=${k}`} variant="ghost" className="justify-start">
                      {REQUEST_KIND_INFO[k].title}
                    </LinkButton>
                  ))}
                </div>
              </div>
            )
          ) : null}
        </Card>
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
        {type === 'dean_certificate' && getConfig().certificateSecret ? (
          <Card>
            <form action={createReadyCertificateAction} className="flex flex-col gap-[var(--sp-2)]">
              <p className="text-[length:var(--fs-sm)] text-muted">
                Справка об обучении по месту требования выдаётся сразу: печатная страница с QR-кодом для проверки
              </p>
              <SubmitButton variant="soft">Получить сразу</SubmitButton>
            </form>
          </Card>
        ) : null}
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
