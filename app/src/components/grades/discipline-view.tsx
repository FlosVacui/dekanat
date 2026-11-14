import Link from 'next/link'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { formatDayMonth, weekdayShort } from '@/lib/dates'
import {
  describeDiscipline,
  EXAM_MAX_POINTS,
  EXAM_MIN_POINTS,
  examPointsForGrades,
  pointsScale,
  pointsWord,
  splitWorks,
  type ExamTarget,
} from '@/lib/grades'
import { controlKindLabel } from '@/lib/labels'
import type { DisciplineDetail } from '@/server/dal/student'
import { Chip, OutcomeChip } from './chip'
import { EmptyState } from './empty-state'
import { GradeIcon } from './icons'
import { PointsBar } from './points-bar'

// Э-5 «Дисциплина»: название, вид контроля, итог; баллы с полосой и допуском; что нужно на экзамене для 3, 4 и 5;
// дата контроля; работы по срокам. Экран ничего не решает сам: слова и числа дают функции из lib/grades.
// Баллов студента за отдельную работу в базе нет: показывается только максимум за работу.

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function targetLine(t: ExamTarget): string {
  if (t.status === 'needs') return `на экзамене нужно ${t.points} из ${EXAM_MAX_POINTS} баллов`
  if (t.status === 'unreachable') return `недостижимо: даже ${EXAM_MAX_POINTS} из ${EXAM_MAX_POINTS} на экзамене не хватит`
  return `сначала нужен допуск: не хватает ${t.missingToAdmission} ${pointsWord(t.missingToAdmission)} за семестр`
}

function PointsBlock({ item }: { item: DisciplineDetail }) {
  const state = describeDiscipline(item)
  const scale = pointsScale(item)
  const label =
    scale.kind === 'semester' ? 'Набрано за семестр' : item.controlKind === 'exam' ? 'Всего баллов, семестр и экзамен' : 'Набрано баллов'
  return (
    <Card className="flex flex-col gap-[var(--sp-2)]">
      <CardTitle>Баллы</CardTitle>
      <p className="text-[length:var(--fs-sm)] text-muted">{label}</p>
      {item.points === null ? (
        <p data-testid="points-line" className="text-[length:var(--fs-md)] font-bold">
          Баллов пока нет
        </p>
      ) : (
        <>
          <p data-testid="points-line" className="text-[length:var(--fs-md)] tabular-nums">
            <b className="text-[length:var(--fs-xl)] font-extrabold">{item.points}</b> из {scale.max} баллов
          </p>
          <PointsBar points={item.points} max={scale.max} threshold={scale.threshold} />
          {scale.threshold !== null ? (
            <p className="text-[length:var(--fs-sm)] text-muted">Отметка на полосе — допуск к экзамену, от {scale.threshold} баллов.</p>
          ) : null}
        </>
      )}
      {state.kind === 'ahead_admitted' ? (
        <p data-testid="admission-line" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-sm)]">
          <Chip tone="ok">Допуск есть</Chip>
        </p>
      ) : null}
      {state.kind === 'ahead_no_admission' ? (
        <p data-testid="admission-line" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-sm)] font-bold">
          <Chip tone="warn">Нет допуска</Chip>
          {state.missing !== null ? (
            <span>
              До допуска не хватает {state.missing} {pointsWord(state.missing)}
            </span>
          ) : null}
        </p>
      ) : null}
    </Card>
  )
}

function ExamTargets({ points }: { points: number | null }) {
  const targets = examPointsForGrades(points)
  return (
    <Card className="flex flex-col gap-[var(--sp-2)]">
      <CardTitle>Что нужно на экзамене</CardTitle>
      <ul data-testid="exam-targets" className="flex flex-col gap-[var(--sp-2)] text-[length:var(--fs-md)]">
        {targets.map((t) => (
          <li key={t.grade}>
            <b className="font-extrabold">Чтобы получить {t.grade}</b>, {targetLine(t)}
          </li>
        ))}
      </ul>
      <p className="text-[length:var(--fs-sm)] text-muted">Расчёт по нынешним баллам за семестр; на экзамене нужно набрать не меньше {EXAM_MIN_POINTS}.</p>
    </Card>
  )
}

function ControlBlock({ item }: { item: DisciplineDetail }) {
  const state = describeDiscipline(item)
  const title = state.kind === 'debt' ? 'Пересдача' : controlKindLabel(item.controlKind)
  // У закрытой дисциплины без даты блока нет: «дата не назначена» о сданном вводила бы в заблуждение.
  if (state.kind === 'passed' && !item.examDate) return null
  return (
    <Card className="flex flex-col gap-[var(--sp-1)]">
      <CardTitle>{title}</CardTitle>
      {item.examDate ? (
        <>
          <p data-testid="control-date" className="text-[length:var(--fs-md)] font-extrabold">
            {formatDayMonth(item.examDate)}, {weekdayShort(item.examDate)}
            {item.examTime ? `, ${item.examTime}` : ''}
          </p>
          {item.examRoom ? <p className="text-[length:var(--fs-sm)] text-muted">Аудитория: {item.examRoom}</p> : null}
        </>
      ) : (
        <p data-testid="control-date" className="text-[length:var(--fs-md)]">
          Дата не назначена
        </p>
      )}
    </Card>
  )
}

function Work({ work, past }: { work: DisciplineDetail['assignments'][number]; past: boolean }) {
  return (
    <li className="flex flex-col gap-0.5 border-t border-border pt-[var(--sp-2)] first:border-t-0 first:pt-0">
      <p className="text-[length:var(--fs-md)] font-bold [overflow-wrap:anywhere]">{work.title}</p>
      <p className="text-[length:var(--fs-sm)] text-muted">
        {past ? 'Срок был' : 'Срок'}: {formatDayMonth(work.dueDate)}, {weekdayShort(work.dueDate)} · максимум {work.maxPoints} {pointsWord(work.maxPoints)}
      </p>
    </li>
  )
}

function Works({ works, today }: { works: DisciplineDetail['assignments']; today: string }) {
  if (works.length === 0) {
    return <EmptyState title="Работ пока нет" text="Когда кафедра назначит работы со сроками, они появятся здесь." />
  }
  const { upcoming, past } = splitWorks(works, today)
  return (
    <Card className="flex flex-col gap-[var(--sp-3)]">
      <CardTitle>Работы</CardTitle>
      <section aria-labelledby="works-upcoming" className="flex flex-col gap-[var(--sp-2)]">
        <h3 id="works-upcoming" className="text-[length:var(--fs-sm)] font-extrabold">
          Предстоящие
        </h3>
        {upcoming.length === 0 ? (
          <p className="text-[length:var(--fs-sm)] text-muted">Предстоящих работ нет.</p>
        ) : (
          <ul data-testid="works-upcoming" className="flex flex-col gap-[var(--sp-2)]">
            {upcoming.map((w) => (
              <Work key={w.id} work={w} past={false} />
            ))}
          </ul>
        )}
      </section>
      {past.length > 0 ? (
        <section aria-labelledby="works-past" className="flex flex-col gap-[var(--sp-2)]">
          <h3 id="works-past" className="text-[length:var(--fs-sm)] font-extrabold">
            Прошедшие
          </h3>
          <ul data-testid="works-past" className="flex flex-col gap-[var(--sp-2)]">
            {past.map((w) => (
              <Work key={w.id} work={w} past />
            ))}
          </ul>
        </section>
      ) : null}
      <p className="text-[length:var(--fs-sm)] text-muted">Баллы за отдельную работу здесь не показываются: видно только максимум.</p>
    </Card>
  )
}

export function DisciplineView({ item, today }: { item: DisciplineDetail; today: string }) {
  const state = describeDiscipline(item)
  const showTargets = item.controlKind === 'exam' && item.outcome === 'pending'
  return (
    <div className="flex flex-col gap-[var(--gap)]">
      <Link
        href="/grades"
        className="-mb-1 inline-flex min-h-[var(--tap)] min-w-[var(--tap)] items-center gap-1 self-start pr-3 text-[length:var(--fs-sm)] font-bold text-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <GradeIcon name="back" className="size-4 flex-none" />
        Все дисциплины
      </Link>
      <div>
        <PageTitle>{item.name}</PageTitle>
        <p className="text-[length:var(--fs-sm)] text-muted">
          {controlKindLabel(item.controlKind)} · {item.semester}-й семестр
        </p>
        {item.outcome !== 'pending' ? (
          <p data-testid="discipline-outcome" className="mt-[var(--sp-1)] text-[length:var(--fs-md)] font-bold">
            Итог: <OutcomeChip outcome={item.outcome} />
          </p>
        ) : null}
        <p data-testid="discipline-state" className="mt-[var(--sp-1)] text-[length:var(--fs-sm)] font-bold">
          {capitalize(state.text)}
        </p>
      </div>
      <PointsBlock item={item} />
      {showTargets ? <ExamTargets points={item.points} /> : null}
      <ControlBlock item={item} />
      <Works works={item.assignments} today={today} />
    </div>
  )
}
