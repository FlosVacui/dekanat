import { Card, CardTitle, PageTitle } from '@/components/card'
import { QuestionStatusChip } from '@/components/questions/status-chip'
import { TextAreaField } from '@/components/questions/text-area-field'
import { BackLink } from '@/components/requests/back-link'
import { StaffShell } from '@/components/staff-shell'
import { SubmitButton } from '@/components/submit-button'
import { formatDate, todayIn } from '@/lib/dates'
import { topicLabel } from '@/lib/questions'
import { denyRecord, requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getCohortQuestion } from '@/server/dal/staff'
import { answerQuestionAction } from './actions'

// Вопрос студента — сотрудник (пакет 4.1): тема, студент и группа, дата, текст вопроса. Пока вопрос «Отправлен» — поле
// «Ответ студенту» и кнопка «Отправить ответ»; когда ответ дан — блок «Ответ деканата» с датой. Ответ один.
// Чужой набор и несуществующий номер — как у заявки сотрудника: событие и 404. Текст вопроса — только текст.
export const dynamic = 'force-dynamic'

export default async function StaffQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor()
  const { id } = await params
  const question = await getCohortQuestion(actor, id)
  // Слой вернул «не найдено»: вопрос другого набора или такого нет. Событие пишется, страница отвечает 404 (R-3.1-4).
  if (!question) return denyRecord(actor)
  const tz = getConfig().timezone
  return (
    <StaffShell>
      <div className="flex flex-col gap-[var(--gap)]">
        <BackLink href="/staff/requests?view=questions">К списку заявок</BackLink>
        <PageTitle>{topicLabel(question.topic)}</PageTitle>
        <Card>
          <dl className="flex flex-col gap-[var(--sp-3)]">
            <div>
              <dt className="text-[length:var(--fs-sm)] text-muted">Студент</dt>
              <dd className="text-[length:var(--fs-md)] font-bold">{question.studentName}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--fs-sm)] text-muted">Группа</dt>
              <dd className="text-[length:var(--fs-md)]">{question.groupName}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--fs-sm)] text-muted">Тема</dt>
              <dd className="text-[length:var(--fs-md)]">{topicLabel(question.topic)}</dd>
            </div>
            <div>
              <dt className="text-[length:var(--fs-sm)] text-muted">Отправлен</dt>
              <dd className="text-[length:var(--fs-md)]">{formatDate(todayIn(tz, question.createdAt))}</dd>
            </div>
          </dl>
          <div className="mt-[var(--sp-3)] flex">
            <QuestionStatusChip status={question.status} statusTestId="staff-question-status" />
          </div>
        </Card>

        <Card>
          <p data-testid="staff-question-body" className="whitespace-pre-wrap text-[length:var(--fs-md)] leading-[1.4] [overflow-wrap:anywhere]">
            {question.body}
          </p>
        </Card>

        {question.answer !== null && question.answeredAt !== null ? (
          <Card>
            <CardTitle>Ответ деканата</CardTitle>
            <p className="mb-[var(--sp-2)] text-[length:var(--fs-sm)] text-muted">{formatDate(todayIn(tz, question.answeredAt))}</p>
            <p data-testid="staff-question-answer" className="whitespace-pre-wrap text-[length:var(--fs-md)] leading-[1.4] [overflow-wrap:anywhere]">
              {question.answer}
            </p>
          </Card>
        ) : (
          <form action={answerQuestionAction} className="flex flex-col gap-[var(--gap)]">
            <input type="hidden" name="questionId" value={question.id} />
            <Card>
              <TextAreaField id="answer-text" name="text" label="Ответ студенту" />
            </Card>
            <SubmitButton>Отправить ответ</SubmitButton>
          </form>
        )}
      </div>
    </StaffShell>
  )
}
