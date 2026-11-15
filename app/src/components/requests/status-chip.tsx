import { STATUS_LABELS, type RequestStatus } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { RequestIcon, type RequestIconName } from './icons'

// Плашки статусов заявки (D-2.2-system, 5.11): значок и слово, цвет сам статус не несёт. Подана и В работе различаются
// значком и словом, а не цветом; так же Готова и Выдана. Плашка не нажимается. Слова — STATUS_LABELS из lib/requests.
const STATUS_TONE: Record<RequestStatus, string> = {
  submitted: 'bg-primary-soft text-primary',
  in_progress: 'bg-primary-soft text-primary',
  ready: 'bg-success-bg text-success',
  issued: 'bg-success-bg text-success',
  rejected: 'bg-error-bg text-error',
}

const STATUS_ICON: Record<RequestStatus, RequestIconName> = {
  submitted: 'inbox',
  in_progress: 'requests',
  ready: 'pin',
  issued: 'check',
  rejected: 'x',
}

const CHIP_CLASS =
  'inline-flex items-center gap-1 self-start whitespace-nowrap rounded-pill px-2 py-1 align-middle text-[length:var(--fs-xs)] font-bold leading-[1.2]'

/**
 * Плашка статуса заявки.
 * - `statusTestId` ставит `data-testid` на элемент, текст которого — ровно слово статуса (тесты сверяют его через toHaveText).
 * - `srPrefix` добавляет скрытое слово «Статус: » перед словом: так плашка, стоящая одна под заголовком, читается «Статус: В работе».
 * - `label` — полный текст вместо слова, когда слово нужно показать с пояснением (список сотрудника: «Статус: Подана»).
 */
export function RequestStatusChip({
  status,
  srPrefix = false,
  statusTestId,
  label,
  className,
}: {
  status: RequestStatus
  srPrefix?: boolean
  statusTestId?: string
  label?: string
  className?: string
}) {
  const word = label ?? STATUS_LABELS[status]
  return (
    <span className={cn(CHIP_CLASS, STATUS_TONE[status], className)}>
      <RequestIcon name={STATUS_ICON[status]} />
      {srPrefix ? <span className="sr-only">Статус: </span> : null}
      {statusTestId ? <span data-testid={statusTestId}>{word}</span> : word}
    </span>
  )
}
