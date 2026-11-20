'use client'

import { useSyncExternalStore } from 'react'
import { BULK_MAX, BULK_TARGETS, BULK_TARGET_LABELS } from '@/components/staff/bulk-result'
import { Button } from '@/components/ui/button'

// Панель «Заявки пачкой» (20.11, деканат): «Отмечено: N» и три кнопки. Стоит внутри формы со списком; флажки — обычные поля формы
// (`name="id"`), поэтому без скриптов форма отправляется так же, а число отмеченных и блокировка кнопок при нуле — надстройка.
// До загрузки скриптов (и без них) кнопки доступны, а вместо числа — подсказка.

function countChecked(form: HTMLElement | null): number {
  return form ? form.querySelectorAll('input[name="id"]:checked').length : 0
}

export function BulkBar({ formId }: { formId: string }) {
  const checked = useSyncExternalStore(
    (notify) => {
      const form = document.getElementById(formId)
      form?.addEventListener('change', notify)
      return () => form?.removeEventListener('change', notify)
    },
    () => countChecked(document.getElementById(formId)),
    () => -1,
  )
  const known = checked >= 0
  return (
    <div className="flex flex-col gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card" data-testid="bulk-bar">
      <p className="m-0 text-[length:var(--fs-md)] font-bold" aria-live="polite" data-testid="bulk-count">
        {known ? `Отмечено: ${checked}` : `Отметьте заявки флажками (до ${BULK_MAX} за раз)`}
      </p>
      <div className="flex flex-wrap gap-[var(--sp-2)]">
        {BULK_TARGETS.map((target) => (
          <Button key={target} type="submit" name="target" value={target} variant={target === 'in_progress' ? 'primary' : 'soft'} disabled={known && checked === 0} data-testid={`bulk-${target}`}>
            {BULK_TARGET_LABELS[target]}
          </Button>
        ))}
      </div>
    </div>
  )
}
