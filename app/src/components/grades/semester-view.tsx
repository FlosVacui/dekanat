import Link from 'next/link'
import { formatDayMonth } from '@/lib/dates'
import { describeDiscipline, displayPoints, pointsScale, pointsWord, sortForSemester } from '@/lib/grades'
import { controlKindLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { GradeItem } from '@/server/dal/student'
import { Chip, OutcomeChip } from './chip'
import { GradeIcon } from './icons'
import { PointsBar } from './points-bar'

// Вид «Семестр» на Э-4: карточки дисциплин. Карточка целиком — ссылка на Э-5 (зона касания не меньше --tap).
// Долги и дисциплины без допуска — вверху (sortForSemester). Все дисциплины группы, фильтра по семестру нет:
// долг и сданное лежат в прошлом семестре (решение участника А 13.11.2026). Слово «семестр» в тексте карточки не стоит:
// название вида «Семестр» — отдельная ссылка в переключателе.
// Смысл не только цветом: долг, допуск и итог названы словом и значком; полоса баллов дублируется числом.

/** Плашка и пояснение состояния; у сданного и у «впереди» без допуска-признака их нет: итог уже назван. */
function StateLine({ item }: { item: GradeItem }) {
  const state = describeDiscipline(item)
  if (state.kind === 'debt') {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-sm)]">
        <Chip tone="err">Долг</Chip>
        {item.examDate ? <span>Пересдача — {formatDayMonth(item.examDate)}</span> : <span>Дата пересдачи не назначена</span>}
      </p>
    )
  }
  if (state.kind === 'ahead_no_admission') {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-sm)]">
        <Chip tone="warn">Нет допуска</Chip>
        {state.missing !== null ? (
          <span>
            До допуска не хватает {state.missing} {pointsWord(state.missing)}
          </span>
        ) : null}
      </p>
    )
  }
  if (state.kind === 'ahead_admitted') {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-sm)]">
        <Chip tone="ok">Допуск есть</Chip>
      </p>
    )
  }
  return null
}

function DisciplineCard({ item }: { item: GradeItem }) {
  const state = describeDiscipline(item)
  const scale = pointsScale(item)
  // Показанное число ограничено шкалой: «70 из 60» не бывает (замечание R-3.3-6).
  const shown = displayPoints(item.points, scale.max)
  return (
    <li>
      <Link
        href={`/grades/${item.disciplineId}`}
        className={cn(
          'flex min-h-[var(--tap)] items-start gap-[var(--sp-2)] rounded-surface border bg-card p-[var(--card-pad)] shadow-card focus-visible:-outline-offset-3',
          state.kind === 'debt' ? 'border-2 border-error' : state.kind === 'ahead_no_admission' ? 'border-2 border-warning' : 'border-border',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
          <h3 className="text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]">{item.name}</h3>
          <p className="text-[length:var(--fs-sm)] text-muted">{controlKindLabel(item.controlKind)}</p>
          <p className="text-[length:var(--fs-sm)] font-bold">
            Итог: <OutcomeChip outcome={item.outcome} />
          </p>
          <StateLine item={item} />
          {shown === null ? (
            <p className="text-[length:var(--fs-sm)] text-muted">Баллов пока нет</p>
          ) : (
            <div className="flex flex-col gap-[var(--sp-1)]">
              <p className="text-[length:var(--fs-sm)] tabular-nums">
                <b className="font-extrabold">{shown}</b> из {scale.max} баллов
                {scale.threshold !== null ? <span className="text-muted"> · допуск от {scale.threshold}</span> : null}
              </p>
              <PointsBar points={shown} max={scale.max} threshold={scale.threshold} />
            </div>
          )}
          {item.nextDue ? (
            <p className="text-[length:var(--fs-sm)] text-muted">
              Ближайшая работа: {item.nextDue.title}, до {formatDayMonth(item.nextDue.dueDate)}
            </p>
          ) : null}
        </div>
        <GradeIcon name="chevron" className="mt-1 size-4 flex-none text-muted" />
      </Link>
    </li>
  )
}

export function SemesterView({ items }: { items: GradeItem[] }) {
  return (
    <ul aria-label="Дисциплины" className="flex flex-col gap-[var(--gap)]">
      {sortForSemester(items).map((item) => (
        <DisciplineCard key={item.disciplineId} item={item} />
      ))}
    </ul>
  )
}
