'use client'

import { useActionState, useState } from 'react'
import { RequestIcon } from '@/components/requests/icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { changeStatusAction, type ChangeStatusState } from './actions'

export interface StatusOption {
  status: string
  label: string
}

const initial: ChangeStatusState = { message: null, ok: false }

/**
 * Статус выбирается кнопкой, а не выпадающим списком (S-2.1, С-13). При отклонении добавляется выбор причины из списка.
 * Дальше — «Сохранить». Допустимые переходы приходят с сервера; проверку ещё раз делает слой доступа.
 */
export function StatusForm({
  requestId,
  options,
  reasons,
}: {
  requestId: string
  options: StatusOption[]
  reasons: StatusOption[]
}) {
  const [state, action, pending] = useActionState(changeStatusAction, initial)
  const [picked, setPicked] = useState<string | null>(null)
  const [reason, setReason] = useState<string>('')
  // Выбранный статус, которого уже нет среди допустимых (заявку только что сменили), не считается выбранным.
  const target = options.some((o) => o.status === picked) ? picked : null

  if (options.length === 0) {
    return <p className="text-[length:var(--fs-sm)]">Для этой заявки дальнейших переходов нет.</p>
  }
  const canSave = target !== null && (target !== 'rejected' || reason !== '')

  return (
    <form action={action} className="flex flex-col gap-[var(--sp-3)]">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="target" value={target ?? ''} />
      <fieldset className="flex flex-col gap-[var(--sp-2)]">
        <legend className="mb-[var(--sp-1)] text-[length:var(--fs-sm)] font-bold text-muted">Новый статус</legend>
        {options.map((o) => (
          <Button
            key={o.status}
            type="button"
            variant={target === o.status ? 'primary' : 'ghost'}
            aria-pressed={target === o.status}
            onClick={() => setPicked(o.status)}
          >
            {o.label}
          </Button>
        ))}
      </fieldset>
      {target === 'rejected' ? (
        <fieldset className="flex flex-col gap-[var(--sp-1)]">
          <legend className="mb-[var(--sp-1)] text-[length:var(--fs-sm)] font-bold text-muted">Причина отклонения</legend>
          {reasons.map((r) => (
            <label
              key={r.status}
              className={cn(
                'flex min-h-[var(--tap)] items-center gap-[var(--sp-2)] rounded-control border-2 px-[var(--sp-3)] text-[length:var(--fs-sm)]',
                reason === r.status ? 'border-primary bg-primary-soft' : 'border-border-strong bg-card',
              )}
            >
              <input
                type="radio"
                name="reason"
                value={r.status}
                checked={reason === r.status}
                onChange={() => setReason(r.status)}
                className="size-5 flex-none accent-primary"
              />
              {r.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <Button type="submit" disabled={!canSave || pending}>
        Сохранить
      </Button>
      {state.message ? (
        // Итог — значок и слово, а не только цвет (раздел 8). Текст сообщения — как пришёл с сервера.
        <p
          role="status"
          className={cn('flex items-start gap-1.5 text-[length:var(--fs-sm)] font-bold', state.ok ? 'text-success' : 'text-error')}
        >
          <RequestIcon name={state.ok ? 'check' : 'alert'} className="mt-px size-[18px] flex-none" />
          <span>{state.message}</span>
        </p>
      ) : null}
    </form>
  )
}
