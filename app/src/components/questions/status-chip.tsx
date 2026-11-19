import { CHIP_CLASS } from '@/components/grades/chip'
import { RequestIcon, type RequestIconName } from '@/components/requests/icons'
import { QUESTION_STATUS_LABELS, isQuestionStatus, type QuestionStatus } from '@/lib/questions'
import { cn } from '@/lib/utils'

// Плашка статуса вопроса (D-2.2-system, 5.11): значок и слово, цвет сам статус не несёт. «Отправлен» и «Есть ответ»
// различаются значком и словом. Плашка не нажимается. Слова — QUESTION_STATUS_LABELS из lib/questions.
const STATUS_TONE: Record<QuestionStatus, string> = {
  sent: 'bg-primary-soft text-primary',
  answered: 'bg-success-bg text-success',
}

const STATUS_ICON: Record<QuestionStatus, RequestIconName> = {
  sent: 'inbox',
  answered: 'check',
}

/** Плашка статуса вопроса. `statusTestId` ставит `data-testid` на элемент, текст которого — ровно слово статуса. */
export function QuestionStatusChip({ status, statusTestId, className }: { status: string; statusTestId?: string; className?: string }) {
  // Неизвестный статус из базы (по проверке базы его быть не может) рисуется как есть, без цвета статуса.
  const known = isQuestionStatus(status) ? status : null
  const word = known ? QUESTION_STATUS_LABELS[known] : status
  return (
    <span className={cn(CHIP_CLASS, known ? STATUS_TONE[known] : 'bg-primary-soft text-primary', className)}>
      <RequestIcon name={known ? STATUS_ICON[known] : 'inbox'} />
      {statusTestId ? <span data-testid={statusTestId}>{word}</span> : word}
    </span>
  )
}
