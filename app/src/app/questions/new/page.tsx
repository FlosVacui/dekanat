import Link from 'next/link'
import { Card, PageTitle } from '@/components/card'
import { BackLink } from '@/components/requests/back-link'
import { RequestIcon } from '@/components/requests/icons'
import { SelectField } from '@/components/requests/select-field'
import { StudentShell } from '@/components/student-shell'
import { SubmitButton } from '@/components/submit-button'
import { QUESTION_MAX_LENGTH, QUESTION_TOPICS, QUESTION_TOPIC_LABELS } from '@/lib/questions'
import { requireStudentActor } from '@/server/auth/page-guards'
import { aiEnabled } from '@/server/ai'
import type { Actor } from '@/server/auth/session'
import { createQuestionAction } from './actions'
import { PrefilledQuestionField } from './prefilled-field'

// «Вопрос в деканат» (пакет 4.1): тема из пяти и свободный текст до 1000 знаков. Форма работает без скриптов.
// Владельца вопроса берёт сервер из сессии; номера студента в форме нет.
export const dynamic = 'force-dynamic'

// Отказ по лимиту записи (ADR-0003): страница выбирает один из двух готовых текстов по коду из адреса.
const LIMIT_TEXT: Record<string, string> = {
  pair: 'С вашего адреса сегодня отправлено слишком много вопросов. Попробуйте завтра',
  account: 'Сегодня с этого аккаунта отправлено слишком много вопросов. Попробуйте завтра',
}

/** Начальный текст поля из адреса (`?text=`, его ставит помощник по положениям): только строка, не длиннее предела вопроса. Это ввод посетителя, как любой другой: его проверяет слой доступа при отправке. */
function prefillFrom(raw: string | string[] | undefined): string {
  const text = Array.isArray(raw) ? raw[0] : raw
  return typeof text === 'string' ? Array.from(text).slice(0, QUESTION_MAX_LENGTH).join('') : ''
}

export default async function NewQuestionPage({ searchParams }: { searchParams: Promise<{ limit?: string | string[]; text?: string | string[] }> }) {
  // Вход проверяется первым: не вошёл — 307 на вход, сотрудник — 403 (пакет 3.7).
  // Границы ожидания (`<Suspense>`) у этой страницы нет, в отличие от «Новой заявки»: читать ей нечего, кроме шапки, а форма
  // должна работать без скриптов. Без скриптов браузер не заменяет подпись «Загружаем заявки…» готовым экраном, и форма
  // оставалась бы скрытой (проба 4.1; та же причина, по которой границу сняли с «Уведомлений» в пакете 3.7).
  const actor = await requireStudentActor()
  const { limit, text } = await searchParams
  return <NewQuestionContent actor={actor} limit={limit} prefill={prefillFrom(text)} />
}

// Рисует экран. Внутри нет redirect(), notFound(), forbidden() и denyRecord().
async function NewQuestionContent({ actor, limit, prefill }: { actor: Actor; limit: string | string[] | undefined; prefill: string }) {
  const limitText = typeof limit === 'string' && Object.hasOwn(LIMIT_TEXT, limit) ? LIMIT_TEXT[limit] : undefined
  return (
    <StudentShell actor={actor} active="requests">
      <div className="flex flex-col gap-[var(--gap)]">
        <BackLink href="/requests">Все заявки</BackLink>
        <PageTitle>Вопрос в деканат</PageTitle>
        <p className="m-0 text-[length:var(--fs-sm)] leading-[1.4]">
          Сначала можно{' '}
          <Link href="/assistant" data-testid="question-assistant-link" className="font-bold text-primary">
            спросить помощника по правилам
          </Link>
          : он покажет пункт положения.
        </p>
        {limitText ? (
          // Отказ по лимиту по 5.6: значок «внимание» в круге --error-bg и текст --fs-md, вес 800, цвет --error. Объявляется сам (role="alert").
          <div role="alert" data-testid="question-limit" className="flex items-center gap-[var(--sp-3)] rounded-surface border border-error bg-card p-[var(--card-pad)] shadow-card">
            <span className="grid size-11 flex-none place-items-center rounded-full bg-error-bg text-error">
              <RequestIcon name="alert" className="size-6" strokeWidth={2} />
            </span>
            <p className="min-w-0 text-[length:var(--fs-md)] font-extrabold leading-[1.3] text-error">{limitText}</p>
          </div>
        ) : null}
        <form action={createQuestionAction} className="flex flex-col gap-[var(--gap)]">
          <Card>
            <div className="flex flex-col gap-[var(--gap)]">
              <SelectField id="question-topic" name="topic" label="Тема" defaultValue={QUESTION_TOPICS[0]}>
                {QUESTION_TOPICS.map((key) => (
                  <option key={key} value={key}>
                    {QUESTION_TOPIC_LABELS[key]}
                  </option>
                ))}
              </SelectField>
              <PrefilledQuestionField initial={prefill} />
            </div>
          </Card>
          {aiEnabled() ? (
            <p data-testid="question-ai-note" className="m-0 text-[length:var(--fs-xs)] leading-[1.35] text-muted">
              Если в деканате включён ИИ-помощник, текст вопроса может уйти в облачную модель для черновика ответа
            </p>
          ) : null}
          <SubmitButton>Отправить</SubmitButton>
        </form>
      </div>
    </StudentShell>
  )
}
