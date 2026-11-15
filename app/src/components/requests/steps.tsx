import { STEP_STATE_WORDS, type RequestStep, type StepState } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { RequestIcon, type RequestIconName } from './icons'

// Шаги заявки (D-2.2-system, 5.8): список-карточка; в каждом шаге слово состояния, название, пояснение. Слово прописными
// стоит в разметке (STEP_STATE_WORDS), а не через text-transform: так его читает экранный чтец. Значок в круге скрыт.
// Линия между кругами — ::before шага, в дерево доступности не попадает. Текст шага переносится, обрезки нет.
const MARK_CLASS: Record<StepState, string> = {
  done: 'border-success bg-success text-card',
  now: 'border-primary bg-primary text-on-primary',
  next: 'border-dashed border-border-strong bg-card',
  next_you: 'border-dashed border-border-strong bg-card text-muted',
  rejected: 'border-error bg-error-bg text-error',
}

const WORD_CLASS: Record<StepState, string> = {
  done: 'text-success',
  now: 'text-primary',
  next: 'text-muted',
  next_you: 'text-muted',
  rejected: 'text-error',
}

// «Дальше» без действия — пустой круг без значка.
const MARK_ICON: Record<StepState, RequestIconName | null> = {
  done: 'check',
  now: 'clock',
  next: null,
  next_you: 'pin',
  rejected: 'x',
}

export function RequestSteps({ steps }: { steps: RequestStep[] }) {
  return (
    <ol aria-label="Шаги заявки" className="flex flex-col rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card">
      {steps.map((step) => {
        const icon = MARK_ICON[step.state]
        return (
          <li
            key={step.key}
            aria-current={step.current ? 'step' : undefined}
            className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-[var(--sp-3)] pb-[var(--sp-4)] before:absolute before:bottom-0 before:left-[15px] before:top-8 before:w-0.5 before:bg-border-strong before:content-[''] last:pb-0 last:before:hidden"
          >
            <span className={cn('grid size-8 place-items-center rounded-full border-2', MARK_CLASS[step.state])} aria-hidden="true">
              {icon ? <RequestIcon name={icon} className="size-[18px]" strokeWidth={2.6} /> : null}
            </span>
            <div className="flex min-w-0 flex-col gap-[3px] pt-[3px]">
              <span className={cn('text-[length:var(--fs-xs)] font-extrabold tracking-[.02em]', WORD_CLASS[step.state])}>
                {STEP_STATE_WORDS[step.state]}
              </span>
              <b className="text-[length:var(--fs-md)] leading-[1.3]">{step.title}</b>
              {step.note ? <p className="break-words text-[length:var(--fs-sm)] text-muted">{step.note}</p> : null}
              {step.where ? (
                <dl className="mt-[var(--sp-1)] grid grid-cols-[fit-content(50%)_1fr] gap-x-[var(--sp-3)] gap-y-1 rounded-control bg-primary-soft p-[var(--sp-3)] text-[length:var(--fs-sm)]">
                  <dt className="text-muted">Куда</dt>
                  <dd className="break-words font-extrabold">{step.where.room}</dd>
                  {step.where.until ? (
                    <>
                      <dt className="text-muted">До какого дня</dt>
                      <dd className="break-words font-extrabold">{step.where.until}</dd>
                    </>
                  ) : null}
                </dl>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
