import Link from 'next/link'
import { formatDayMonth } from '@/lib/dates'
import { allWorksLabel, describeDiscipline, displayPoints, pointsScale, pointsWord, sortForSemester } from '@/lib/grades'
import { controlKindLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { GradeItem } from '@/server/dal/student'
import { Chip, OutcomeChip } from './chip'
import { GradeIcon } from './icons'
import { PointsBar } from './points-bar'
import { WorksView } from './works-list'

// Вид «Семестр» на Э-4: строки дисциплин. Строка — ссылка на Э-5: название, итог-плашка, полоса баллов с отметкой допуска.
// Под ней «Все работы (N)» раскрывает список работ (`<details name="works">`, без скриптов, открыт один), зона касания не меньше --tap.
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

function DisciplineCard({ item, today }: { item: GradeItem; today: string }) {
  const state = describeDiscipline(item)
  const scale = pointsScale(item)
  // Показанное число ограничено шкалой: «70 из 60» не бывает (замечание R-3.3-6).
  const shown = displayPoints(item.points, scale.max)
  return (
    <li
      className={cn(
        'flex flex-col rounded-surface border bg-card',
        state.kind === 'debt' ? 'border-2 border-error' : state.kind === 'ahead_no_admission' ? 'border-2 border-warning' : 'border-border',
      )}
    >
      {/* Вся строка — ссылка на страницу предмета (дизайн-проход 19.11): отдельной кнопки «Страница предмета» нет. */}
      <Link
        href={`/grades/${item.disciplineId}`}
        className="flex min-h-[var(--tap)] flex-col gap-[var(--sp-2)] rounded-surface p-[var(--card-pad)] text-text active:bg-primary-soft focus-visible:-outline-offset-3"
      >
        <div className="flex items-start justify-between gap-[var(--sp-2)]">
          <div className="min-w-0">
            <h3 className="text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]">{item.name}</h3>
            <span className="block text-[length:var(--fs-sm)] text-muted">{controlKindLabel(item.controlKind)}</span>
          </div>
          <span className="flex flex-none items-center gap-1 text-[length:var(--fs-sm)] font-bold">
            <span>Итог: </span>
            <OutcomeChip outcome={item.outcome} />
            <GradeIcon name="chevron" className="size-5 flex-none text-primary" />
          </span>
        </div>
        <StateLine item={item} />
        {shown === null ? (
          <span className="text-[length:var(--fs-sm)] text-muted">Баллов пока нет</span>
        ) : (
          <div className="flex flex-col gap-[var(--sp-1)]">
            <span className="text-[length:var(--fs-sm)] tabular-nums">
              <b className="font-extrabold">{shown}</b> из {scale.max} баллов
              {scale.threshold !== null ? <span className="text-muted"> · допуск от {scale.threshold}</span> : null}
            </span>
            <PointsBar points={shown} max={scale.max} threshold={scale.threshold} />
          </div>
        )}
        {item.nextDue ? (
          <span className="text-[length:var(--fs-sm)] text-muted">
            Ближайшая работа: {item.nextDue.title}, до {formatDayMonth(item.nextDue.dueDate)}
          </span>
        ) : null}
      </Link>
      {item.works.length > 0 ? (
        // name="works": открыт один список работ за раз. Без рамки-капсулы: строка-раскрытие с линией сверху.
        <details name="works" data-testid="works-details" className="group border-t border-border px-[var(--card-pad)] pb-[var(--sp-2)]">
          <summary className="flex min-h-[var(--tap)] cursor-pointer list-none items-center justify-between gap-[var(--sp-2)] text-[length:var(--fs-sm)] font-semibold text-primary [&::-webkit-details-marker]:hidden">
            <span>{allWorksLabel(item.works.length)}</span>
            <GradeIcon name="chevron" className="size-5 flex-none transition-transform group-open:rotate-90" />
          </summary>
          <WorksView works={item.works} today={today} disciplineName={item.name} headingLevel={4} />
        </details>
      ) : null}
    </li>
  )
}

export function SemesterView({ items, today }: { items: GradeItem[]; today: string }) {
  return (
    <ul aria-label="Дисциплины" className="flex flex-col gap-[var(--sp-2)]">
      {sortForSemester(items).map((item) => (
        <DisciplineCard key={item.disciplineId} item={item} today={today} />
      ))}
    </ul>
  )
}
