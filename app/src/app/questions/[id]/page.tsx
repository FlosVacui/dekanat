import { Card, CardTitle } from '@/components/card'
import { QuestionStatusChip } from '@/components/questions/status-chip'
import { BackLink } from '@/components/requests/back-link'
import { StudentShell } from '@/components/student-shell'
import { formatDate, todayIn } from '@/lib/dates'
import { topicLabel } from '@/lib/questions'
import { denyRecord, requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getMyQuestion } from '@/server/dal/student'

// Экран вопроса (пакет 4.1): ссылка «Все заявки», заголовок — тема, «Отправлен <дата>», плашка статуса, текст вопроса и,
// когда деканат ответил, блок «Ответ деканата» с датой. Номер в адресе — номер записи; владельца берёт сервер из сессии.
// Текст вопроса и ответа — только текст: переносы строк сохраняются, длинное слово переносится, разметки из текста нет.
export const dynamic = 'force-dynamic'

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStudentActor()
  const { id } = await params
  const question = await getMyQuestion(actor, id)
  // Слой вернул «не найдено»: чужой вопрос или такого нет. Событие пишется, страница отвечает 404 (R-3.1-4).
  if (!question) return denyRecord(actor)
  const timezone = getConfig().timezone

  return (
    <StudentShell actor={actor} active="requests">
      <div className="flex flex-col gap-[var(--gap)]">
        <BackLink href="/requests">Все заявки</BackLink>

        <div className="flex flex-col gap-[var(--sp-1)]">
          <h1 className="text-[length:var(--h1-size)] font-bold leading-[1.15]">{topicLabel(question.topic)}</h1>
          <p className="text-[length:var(--fs-sm)] leading-[1.4] text-muted">Отправлен {formatDate(todayIn(timezone, question.createdAt))}</p>
        </div>

        <QuestionStatusChip status={question.status} statusTestId="question-status" />

        <Card>
          <p data-testid="question-body" className="whitespace-pre-wrap text-[length:var(--fs-md)] leading-[1.4] [overflow-wrap:anywhere]">
            {question.body}
          </p>
        </Card>

        {question.answer !== null && question.answeredAt !== null ? (
          <Card>
            <CardTitle>Ответ деканата</CardTitle>
            <p className="mb-[var(--sp-2)] text-[length:var(--fs-sm)] text-muted">{formatDate(todayIn(timezone, question.answeredAt))}</p>
            <p data-testid="question-answer" className="whitespace-pre-wrap text-[length:var(--fs-md)] leading-[1.4] [overflow-wrap:anywhere]">
              {question.answer}
            </p>
          </Card>
        ) : null}
      </div>
    </StudentShell>
  )
}
