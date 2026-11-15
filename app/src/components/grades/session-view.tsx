import Link from 'next/link'
import { Card } from '@/components/card'
import { groupSession, pointsWord, sessionStatus, sessionWhenLine } from '@/lib/grades'
import { controlKindLabel } from '@/lib/labels'
import type { GradeItem } from '@/server/dal/student'
import { Chip, OutcomeChip, type ChipTone } from './chip'
import { GradeIcon } from './icons'

// Вид «Сессия» на Э-4: экзамены и зачёты по датам, ближайший сверху; прошедшие — ниже, с итогом. Каждая строка — ссылка на Э-5.
// Допуск назван плашкой со значком и словом («Допущен», «Не допущен»); у недопущенного — сколько баллов не хватает.
// Порога для зачёта нет (решение участника А 14.11.2026): у зачёта без допуска число не пишется.

const STATUS_TONE: Record<'admitted' | 'not_admitted' | 'retake' | 'passed', ChipTone> = {
  admitted: 'ok',
  not_admitted: 'warn',
  retake: 'err',
  passed: 'ok',
}

function Row({ item, past }: { item: GradeItem; past: boolean }) {
  const status = sessionStatus(item)
  // У закрытой дисциплины без даты строки с датой нет, место в «Прошедших» остаётся (замечание R-3.3-4).
  const when = sessionWhenLine(item)
  return (
    <li>
      <Link
        href={`/grades/${item.disciplineId}`}
        className="flex min-h-[var(--tap)] items-start gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card focus-visible:-outline-offset-3"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
          {past ? null : <Chip tone={STATUS_TONE[status.kind]}>{status.word}</Chip>}
          <h3 className="text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]">{item.name}</h3>
          {when === null ? null : (
            <p className="text-[length:var(--fs-sm)]">
              <b className="font-extrabold">{when}</b>
            </p>
          )}
          <p className="text-[length:var(--fs-sm)] text-muted">
            {controlKindLabel(item.controlKind)}
            {item.examRoom ? `, ауд. ${item.examRoom}` : ''}
          </p>
          {past ? (
            item.outcome === 'pending' ? (
              <p className="text-[length:var(--fs-sm)] font-bold">Итога пока нет</p>
            ) : (
              <p className="text-[length:var(--fs-sm)] font-bold">
                Итог: <OutcomeChip outcome={item.outcome} />
              </p>
            )
          ) : status.kind === 'not_admitted' && status.missing !== null ? (
            <p className="text-[length:var(--fs-sm)] font-bold">
              До допуска не хватает {status.missing} {pointsWord(status.missing)}
            </p>
          ) : null}
        </div>
        <GradeIcon name="chevron" className="mt-1 size-4 flex-none text-muted" />
      </Link>
    </li>
  )
}

function Section({ title, items, past, empty }: { title: string; items: GradeItem[]; past: boolean; empty: string | null }) {
  if (items.length === 0 && empty === null) return null
  return (
    <section>
      <h2 className="mb-[var(--sp-2)] text-[length:var(--h2-size)] font-bold leading-tight text-[color:var(--h2-color)]">{title}</h2>
      {items.length === 0 ? (
        <Card>
          <p className="text-[length:var(--fs-sm)]">{empty}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-[var(--gap)]">
          {items.map((item) => (
            <Row key={item.disciplineId} item={item} past={past} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function SessionView({ items, today }: { items: GradeItem[]; today: string }) {
  const { upcoming, past, undated } = groupSession(items, today)
  return (
    <div className="flex flex-col gap-[var(--sp-4)]">
      <Section title="Предстоящие экзамены и зачёты" items={upcoming} past={false} empty="Экзаменов и зачётов впереди нет." />
      <Section title="Дата не назначена" items={undated} past={false} empty={null} />
      <Section title="Прошедшие" items={past} past empty="Прошедших пока нет." />
    </div>
  )
}
