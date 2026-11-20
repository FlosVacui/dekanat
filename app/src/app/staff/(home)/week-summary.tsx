'use client'

import { useActionState } from 'react'
import { Card, CardTitle } from '@/components/card'
import { Button } from '@/components/ui/button'
import type { WeekSummaryState } from './actions'

// «Сводка недели от ИИ» на сводке сотрудника (20.11). Форма — серверное действие: работает и без скриптов (страница
// перерисовывается с ответом). Кнопка есть только при включённом ИИ: `action` без ключа не передаётся. Автоотправки нет.

const INITIAL: WeekSummaryState = { lines: null, message: null, version: 0 }

export function WeekSummary({ action }: { action: (previous: WeekSummaryState) => Promise<WeekSummaryState> }) {
  const [state, dispatch, pending] = useActionState(action, INITIAL)
  return (
    <Card>
      <CardTitle>Сводка недели от ИИ</CardTitle>
      <p className="mb-[var(--sp-3)] text-[length:var(--fs-sm)] text-muted">
        Модель получает только числа: заявки и вопросы по видам, статусам и темам. Имён и текстов обращений ей не передают.
      </p>
      <form action={dispatch}>
        <Button type="submit" variant="soft" disabled={pending} data-testid="week-summary-button" className="w-full lg:w-auto">
          {pending ? 'Готовим сводку…' : 'Сводка недели от ИИ'}
        </Button>
      </form>
      <div aria-live="polite" className="mt-[var(--sp-3)]">
        {state.lines ? (
          <div data-testid="week-summary-result">
            <ul className="flex flex-col gap-[var(--sp-2)] text-[length:var(--fs-md)] [overflow-wrap:anywhere]">
              {state.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="mt-[var(--sp-2)] text-[length:var(--fs-sm)] text-muted">Подготовлено ИИ по данным за 7 дней</p>
          </div>
        ) : null}
        {state.message === 'empty' ? (
          <p data-testid="week-summary-empty" className="text-[length:var(--fs-sm)] text-muted">
            За 7 дней заявок и вопросов не было: сводить нечего.
          </p>
        ) : null}
        {state.message === 'failed' ? (
          <p role="status" data-testid="week-summary-error" className="text-[length:var(--fs-sm)] text-error">
            Не удалось подготовить сводку
          </p>
        ) : null}
      </div>
    </Card>
  )
}
