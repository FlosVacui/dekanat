'use client'

import { useActionState, useState } from 'react'
import { Card } from '@/components/card'
import { TextAreaField } from '@/components/questions/text-area-field'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import type { DraftState } from '@/app/staff/questions/[id]/actions'

// Форма «Ответ студенту» со строкой «Черновик ИИ» (19.11, ИИ-функции, идея №37). Черновик только вставляется в поле:
// сотрудник правит и отправляет ответ сам, автоотправки нет. Без ключа модели `draftAction` не передаётся, и кнопки нет.

const INITIAL: DraftState = { draft: null, error: null, version: 0 }
const idle = async (state: DraftState): Promise<DraftState> => state

const ERROR_TEXT: Record<NonNullable<DraftState['error']>, string> = {
  unavailable: 'Черновик сейчас недоступен. Напишите ответ сами',
  failed: 'Не удалось подготовить черновик. Напишите ответ сами или попробуйте ещё раз',
}

export function StaffAnswerForm({
  questionId,
  answerAction,
  draftAction,
}: {
  questionId: string
  answerAction: (formData: FormData) => void | Promise<void>
  draftAction?: (previous: DraftState, formData: FormData) => Promise<DraftState>
}) {
  const [text, setText] = useState('')
  const [drafted, setDrafted] = useState(false)
  const [seen, setSeen] = useState(0)
  const [state, dispatchDraft, pending] = useActionState(draftAction ?? idle, INITIAL)

  // Пришёл новый результат: черновик встаёт в поле. Состояние меняется при отрисовке, без эффекта: так советует React.
  if (state.version !== seen) {
    setSeen(state.version)
    if (state.draft !== null) {
      setText(state.draft)
      setDrafted(true)
    }
  }

  function changeText(value: string) {
    setText(value)
    if (value.trim() === '') setDrafted(false)
  }

  // Свой текст сотрудника черновик не затирает: кнопка ждёт, пока поле очистят.
  const blockedByOwnText = text.trim() !== '' && !drafted

  return (
    <form action={answerAction} className="flex flex-col gap-[var(--gap)]">
      <input type="hidden" name="questionId" value={questionId} />
      <Card>
        <TextAreaField id="answer-text" name="text" label="Ответ студенту" value={text} onValueChange={changeText} />
        {drafted ? (
          <p data-testid="draft-note" className="mt-[var(--sp-2)] text-[length:var(--fs-sm)] font-bold text-text">
            Черновик подготовлен ИИ. Проверьте перед отправкой
          </p>
        ) : null}
        {draftAction ? (
          <div className="mt-[var(--sp-3)] flex flex-col gap-[var(--sp-2)]">
            <Button type="submit" variant="soft" formAction={dispatchDraft} formNoValidate disabled={pending || blockedByOwnText} data-testid="draft-button">
              {pending ? 'Готовим черновик…' : 'Черновик ИИ'}
            </Button>
            {blockedByOwnText ? (
              <p className="text-[length:var(--fs-sm)] text-muted">Черновик встанет в пустое поле: ваш текст он не заменит</p>
            ) : null}
            {state.error ? (
              <p role="status" data-testid="draft-error" className="text-[length:var(--fs-sm)] text-error">
                {ERROR_TEXT[state.error]}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>
      <SubmitButton>Отправить ответ</SubmitButton>
    </form>
  )
}
