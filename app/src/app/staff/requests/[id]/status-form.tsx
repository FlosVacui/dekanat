'use client'

import { useActionState, useState } from 'react'
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
    return <p className="text-sm">Для этой заявки дальнейших переходов нет.</p>
  }
  const canSave = target !== null && (target !== 'rejected' || reason !== '')

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="target" value={target ?? ''} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-neutral-700">Новый статус</legend>
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
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm text-neutral-700">Причина отклонения</legend>
          {reasons.map((r) => (
            <label
              key={r.status}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded border px-3 text-sm',
                reason === r.status ? 'border-blue-700 bg-blue-50' : 'border-neutral-400 bg-white',
              )}
            >
              <input type="radio" name="reason" value={r.status} checked={reason === r.status} onChange={() => setReason(r.status)} />
              {r.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <Button type="submit" disabled={!canSave || pending}>
        Сохранить
      </Button>
      {state.message ? (
        <p role="status" className={cn('text-sm', state.ok ? 'text-green-800' : 'text-red-700')}>
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
