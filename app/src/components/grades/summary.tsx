import Link from 'next/link'
import { Card } from '@/components/card'
import { firstActionText, formatAverage, pickFirstAction, stipendLine, summarizeGrades, summaryPhrase } from '@/lib/grades'
import type { GradeItem } from '@/server/dal/student'
import { GradeIcon } from './icons'

// Блок «как у меня дела» на Э-4: фраза-итог, четыре числа, строка о стипендии (только при долге) и «что сделать первым».
// Числа и фраза считаются из того же списка, что и карточки: одна цифра — один источник. Экран ничего не решает сам.
export function Summary({ items, today }: { items: GradeItem[]; today: string }) {
  const s = summarizeGrades(items)
  const stipend = stipendLine(s.debt)
  const action = pickFirstAction(items, today)
  const actionItem = action ? items.find((i) => i.disciplineId === action.disciplineId) : undefined
  const text = action ? firstActionText(action, actionItem?.controlKind) : null
  return (
    <Card className="flex flex-col gap-[var(--sp-3)]">
      <h2 className="text-[length:var(--h2-size)] font-bold leading-tight text-[color:var(--h2-color)]">Как у меня дела</h2>
      <p data-testid="grades-phrase" className="text-[length:var(--fs-md)] font-bold leading-[1.35]">
        {summaryPhrase(items, today)}
      </p>
      <dl className="grid grid-cols-2 gap-[var(--sp-3)] text-[length:var(--fs-sm)]">
        <div className="flex flex-col">
          <dt className="text-muted">Сдано</dt>
          <dd className="text-[length:var(--fs-lg)] font-extrabold tabular-nums">{s.passed}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-muted">Долг</dt>
          <dd className="text-[length:var(--fs-lg)] font-extrabold tabular-nums">{s.debt}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-muted">Впереди</dt>
          <dd className="text-[length:var(--fs-lg)] font-extrabold tabular-nums">{s.ahead}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-muted">Средний балл</dt>
          <dd className="text-[length:var(--fs-lg)] font-extrabold tabular-nums">{formatAverage(s.average)}</dd>
        </div>
      </dl>
      {stipend ? (
        <p
          data-testid="stipend-line"
          className="flex items-start gap-1.5 rounded-control bg-warning-bg px-3 py-2 text-[length:var(--fs-sm)] font-bold text-warning"
        >
          <GradeIcon name="alert" className="mt-0.5 size-4 flex-none" />
          {stipend}
        </p>
      ) : null}
      <div className="border-t border-border pt-[var(--sp-3)]">
        <p className="mb-1 text-[length:var(--fs-xs)] font-bold uppercase tracking-wide text-muted">Что сделать первым</p>
        {action && text ? (
          <Link
            href={`/grades/${action.disciplineId}`}
            data-testid="first-action"
            className="flex min-h-[var(--tap)] items-center justify-between gap-[var(--sp-2)] rounded-control text-[length:var(--fs-md)] focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <b className="font-extrabold">{text.lead}:</b> <span className="font-semibold text-primary underline">{text.detail}</span>
            </span>
            <GradeIcon name="chevron" className="size-4 flex-none text-primary" />
          </Link>
        ) : (
          <p data-testid="first-action" className="text-[length:var(--fs-md)]">
            Срочного нет: долгов и недопусков нет.
          </p>
        )}
      </div>
    </Card>
  )
}
