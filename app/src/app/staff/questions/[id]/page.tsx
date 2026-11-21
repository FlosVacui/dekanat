import Link from 'next/link'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { QuestionStatusChip } from '@/components/questions/status-chip'
import { StaffAnswerForm } from '@/components/questions/staff-answer-form'
import { BackLink } from '@/components/requests/back-link'
import { StaffShell } from '@/components/staff-shell'
import { InsertPointButton } from '@/components/staff/insert-point-button'
import { hintsForQuestion } from '@/components/staff/regulation-hints'
import { formatDate, todayIn } from '@/lib/dates'
import { topicLabel } from '@/lib/questions'
import { denyRecord, requireStaffActor } from '@/server/auth/page-guards'
import { aiEnabled } from '@/server/ai'
import { getConfig } from '@/server/config'
import { getCohortQuestion } from '@/server/dal/staff'
import { answerQuestionAction, draftAnswerAction } from './actions'

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
  // 20.11, деканат: три пункта положения по тексту вопроса; пока вопрос без ответа.
  const hints = question.answer === null ? hintsForQuestion(question.body) : []
  return (
    <StaffShell juryMode={getConfig().juryMode}>
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
          <>
            <Card>
              <CardTitle>Пункты положения по теме</CardTitle>
              {hints.length === 0 ? (
                <p data-testid="hints-empty" className="mb-[var(--sp-2)] text-[length:var(--fs-sm)] text-muted">
                  По тексту вопроса пунктов не нашлось. Попробуйте помощника по правилам
                </p>
              ) : (
                <ul data-testid="hints" className="m-0 flex list-none flex-col gap-[var(--sp-3)] p-0">
                  {hints.map((h) => (
                    <li key={h.num} data-point={h.num} className="flex flex-col gap-1 border-b border-border pb-[var(--sp-3)] last:border-b-0 last:pb-0">
                      <Link href={h.href} className="inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-md)] font-bold text-primary">
                        п. {h.num}. {h.title}
                      </Link>
                      <InsertPointButton phrase={h.phrase} targetId="answer-text" label={`Вставить в ответ: п. ${h.num}`} />
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/assistant" className="mt-[var(--sp-2)] inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-sm)] font-bold text-primary">
                Спросить помощника по правилам
              </Link>
              <noscript>
                <style>{'[data-needs-js]{display:none}'}</style>
              </noscript>
            </Card>
            <StaffAnswerForm questionId={question.id} answerAction={answerQuestionAction} draftAction={aiEnabled() ? draftAnswerAction : undefined} />
          </>
        )}
      </div>
    </StaffShell>
  )
}
