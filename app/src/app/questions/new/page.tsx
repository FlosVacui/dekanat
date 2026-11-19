import { Card, PageTitle } from '@/components/card'
import { TextAreaField } from '@/components/questions/text-area-field'
import { BackLink } from '@/components/requests/back-link'
import { RequestIcon } from '@/components/requests/icons'
import { SelectField } from '@/components/requests/select-field'
import { StudentShell } from '@/components/student-shell'
import { SubmitButton } from '@/components/submit-button'
import { QUESTION_TOPICS, QUESTION_TOPIC_LABELS } from '@/lib/questions'
import { requireStudentActor } from '@/server/auth/page-guards'
import type { Actor } from '@/server/auth/session'
import { createQuestionAction } from './actions'

// «Вопрос в деканат» (пакет 4.1): тема из пяти и свободный текст до 1000 знаков. Форма работает без скриптов.
// Владельца вопроса берёт сервер из сессии; номера студента в форме нет.
export const dynamic = 'force-dynamic'

// Отказ по лимиту записи (ADR-0003): страница выбирает один из двух готовых текстов по коду из адреса.
const LIMIT_TEXT: Record<string, string> = {
  pair: 'С вашего адреса сегодня отправлено слишком много вопросов. Попробуйте завтра',
  account: 'Сегодня с этого аккаунта отправлено слишком много вопросов. Попробуйте завтра',
}

export default async function NewQuestionPage({ searchParams }: { searchParams: Promise<{ limit?: string | string[] }> }) {
  // Вход проверяется первым: не вошёл — 307 на вход, сотрудник — 403 (пакет 3.7).
  // Границы ожидания (`<Suspense>`) у этой страницы нет, в отличие от «Новой заявки»: читать ей нечего, кроме шапки, а форма
  // должна работать без скриптов. Без скриптов браузер не заменяет подпись «Загружаем заявки…» готовым экраном, и форма
  // оставалась бы скрытой (проба 4.1; та же причина, по которой границу сняли с «Уведомлений» в пакете 3.7).
  const actor = await requireStudentActor()
  const { limit } = await searchParams
  return <NewQuestionContent actor={actor} limit={limit} />
}

// Рисует экран. Внутри нет redirect(), notFound(), forbidden() и denyRecord().
async function NewQuestionContent({ actor, limit }: { actor: Actor; limit: string | string[] | undefined }) {
  const limitText = typeof limit === 'string' && Object.hasOwn(LIMIT_TEXT, limit) ? LIMIT_TEXT[limit] : undefined
  return (
    <StudentShell actor={actor} active="requests">
      <div className="flex flex-col gap-[var(--gap)]">
        <BackLink href="/requests">Все заявки</BackLink>
        <PageTitle>Вопрос в деканат</PageTitle>
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
              <TextAreaField
                id="question-text"
                name="text"
                label="Ваш вопрос"
                hint="До 1000 знаков. Ответ появится здесь и в уведомлениях"
              />
            </div>
          </Card>
          <SubmitButton>Отправить</SubmitButton>
        </form>
      </div>
    </StudentShell>
  )
}
