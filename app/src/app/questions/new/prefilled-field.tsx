'use client'

import { useState } from 'react'
import { TextAreaField } from '@/components/questions/text-area-field'

// Поле «Ваш вопрос» с начальным текстом (20.11): помощник по положениям подставляет сюда вопрос студента, если ответ не помог.
// Поле управляемое, но без скриптов оно тоже уходит с формой: сервер рисует начальный текст внутри поля.
export function PrefilledQuestionField({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return (
    <TextAreaField
      id="question-text"
      name="text"
      label="Ваш вопрос"
      hint="До 1000 знаков. Ответ появится здесь и в уведомлениях"
      value={value}
      onValueChange={setValue}
    />
  )
}
