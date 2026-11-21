// Отозванная заявка (20.11): студент сам снимает заявку «Подана», пока деканат не взял её в работу.
// Нового статуса нет: заявка получает существующий «Отклонена» с причиной `withdrawn`. Причины нет в списке сотрудника
// (`REJECT_REASONS`): отозвать заявку может только студент. Здесь — слова экрана для такой заявки; чистый модуль, без базы.
import { buildRequestSteps, statusText, type BuildStepsInput, type RequestStep, type StatusTextInput } from '@/lib/requests'

/** Причина отклонения у отозванной студентом заявки. Хранится в `requests.reject_reason` и в `request_events.note`. */
export const WITHDRAWN_REASON = 'withdrawn'

/** Слово плашки вместо «Отклонена». */
export const WITHDRAWN_LABEL = 'Отозвана'

/** Заявка отозвана студентом: «Отклонена» с причиной `withdrawn`. */
export function isWithdrawn(request: { status: string; rejectReason: string | null }): boolean {
  return request.status === 'rejected' && request.rejectReason === WITHDRAWN_REASON
}

/** Что дальше: у отозванной заявки свой текст, у остальных — прежний `statusText`. */
export function requestStatusText(input: StatusTextInput): string {
  if (isWithdrawn(input)) return 'Вы отозвали заявку, деканат её не рассматривает. Можно подать снова'
  return statusText(input)
}

/** Шаги заявки: у отозванной последний шаг — «Отозвана вами» без красного «ОТКЛОНЕНО» (отклонил её не деканат). */
export function requestSteps(input: BuildStepsInput & { rejectReason: string | null }): RequestStep[] {
  const steps = buildRequestSteps(input)
  if (!isWithdrawn({ status: input.status, rejectReason: input.rejectReason })) return steps
  return steps.map((step) => (step.key === 'rejected' ? { ...step, title: 'Отозвана вами', state: 'done' as const } : step))
}
