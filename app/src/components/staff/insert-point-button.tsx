'use client'

import { useState } from 'react'
import { QUESTION_MAX_LENGTH } from '@/lib/questions'
import { Button } from '@/components/ui/button'

// «Вставить в ответ» (20.11, деканат): кладёт фразу о пункте положения в поле «Ответ студенту» и ничего не отправляет.
// Поле принадлежит форме ответа (управляемое поле React), поэтому значение ставится родным установщиком и сообщается событием `input`:
// так форма видит новый текст так же, как после набора. Свой текст сотрудника не затирается: фраза добавляется после него.
// Без скриптов кнопки скрыты (`data-needs-js` и стиль в <noscript> на странице), остаётся список со ссылками на пункты.

export function InsertPointButton({ phrase, targetId, label }: { phrase: string; targetId: string; label: string }) {
  const [note, setNote] = useState<string | null>(null)

  function insert() {
    const field = document.getElementById(targetId)
    if (!(field instanceof HTMLTextAreaElement)) return
    const current = field.value.trimEnd()
    const next = current === '' ? phrase : `${current}\n\n${phrase}`
    if (Array.from(next).length > QUESTION_MAX_LENGTH) {
      setNote(`Не помещается: в ответе до ${QUESTION_MAX_LENGTH} знаков`)
      return
    }
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (!setValue) return
    setValue.call(field, next)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.focus()
    setNote('Вставлено в ответ')
  }

  return (
    <span data-needs-js className="flex flex-col gap-1">
      <Button type="button" variant="soft" onClick={insert} aria-label={label} data-testid="insert-point">
        Вставить в ответ
      </Button>
      {note ? (
        <span role="status" className="text-[length:var(--fs-sm)] text-muted">
          {note}
        </span>
      ) : null}
    </span>
  )
}
