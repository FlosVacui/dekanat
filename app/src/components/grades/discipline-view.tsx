import Link from 'next/link'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { formatDayMonth, weekdayShort } from '@/lib/dates'
import {
  describeDiscipline,
  displayPoints,
  EXAM_MIN_POINTS,
  examTargetLine,
  examTargetsForDiscipline,
  pointsScale,
  pointsWord,
} from '@/lib/grades'
import { controlKindLabel } from '@/lib/labels'
import type { DisciplineDetail } from '@/server/dal/student'
import { Chip, OutcomeChip } from './chip'
import { EmptyState } from './empty-state'
import { GradeIcon } from './icons'
import { PointsBar } from './points-bar'
import { ratingRuleLines, RULES_NOTE } from './rating-rules'
import { SubjectIcon } from './subject-icons'
import { WorksView } from './works-list'

// Э-5 «Страница предмета» (М4): название, преподаватели пар, форма контроля, правила рейтинга раскрытием, работы с баллами студента,
// материалы курса. Кнопок сдачи и загрузки нет, материалы — названия без ссылок. Слова и числа дают функции из lib/grades
// и components/grades/rating-rules. Блоки «Баллы» и «Что нужно на экзамене» остались с прежних экранов: в макете М4 их нет,
// но без них со страницы пропали бы допуск и расчёт оценки (вопрос участнику А в отчёте захода Б).

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function PointsBlock({ item }: { item: DisciplineDetail }) {
  const state = describeDiscipline(item)
  const scale = pointsScale(item)
  // Показанное число ограничено шкалой: «70 из 60» не бывает (замечание R-3.3-6).
  const shown = displayPoints(item.points, scale.max)
  const label =
    scale.kind === 'semester' ? 'Набрано за семестр' : item.controlKind === 'exam' ? 'Всего баллов, семестр и экзамен' : 'Набрано баллов'
  return (
    <Card className="flex flex-col gap-[var(--sp-2)]">
      <CardTitle>Баллы</CardTitle>
      <p className="text-[length:var(--fs-sm)] text-muted">{label}</p>
      {shown === null ? (
        <p data-testid="points-line" className="text-[length:var(--fs-md)] font-bold">
          Баллов пока нет
        </p>
      ) : (
        <>
          <p data-testid="points-line" className="text-[length:var(--fs-md)] tabular-nums">
            <b className="text-[length:var(--fs-xl)] font-extrabold">{shown}</b> из {scale.max} баллов
          </p>
          <PointsBar points={shown} max={scale.max} threshold={scale.threshold} />
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

// Блок получает тот же ответ о допуске, что и строка состояния: examTargetsForDiscipline берёт его из describeDiscipline (замечание R-3.3-1).
function ExamTargets({ item }: { item: DisciplineDetail }) {
  const targets = examTargetsForDiscipline(item)
  return (
    <Card className="flex flex-col gap-[var(--sp-2)]">
      <CardTitle>Что нужно на экзамене</CardTitle>
      <ul data-testid="exam-targets" className="flex flex-col gap-[var(--sp-2)] text-[length:var(--fs-md)]">
        {targets.map((t) => (
          <li key={t.grade}>
            <b className="font-extrabold">Чтобы получить {t.grade}</b>, {examTargetLine(t)}
          </li>
        ))}
      </ul>
      <p className="text-[length:var(--fs-sm)] text-muted">Расчёт по нынешним баллам за семестр; на экзамене нужно набрать не меньше {EXAM_MIN_POINTS}.</p>
    </Card>
  )
}

function Teachers({ teachers }: { teachers: string[] }) {
  return (
    <Card>
      <CardTitle>Преподаватели</CardTitle>
      <ul data-testid="teachers" className="flex flex-col gap-[var(--sp-1)]">
        {teachers.map((name) => (
          <li key={name} className="flex min-h-[var(--tap)] items-center gap-[var(--sp-3)] text-[length:var(--fs-md)] font-bold">
            <span className="grid size-9 flex-none place-items-center rounded-full bg-avatar-bg text-avatar-fg">
              <SubjectIcon name="teacher" />
            </span>
            {name}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** «экзамен — чт 24 декабря, 10:00, ауд. 314»; у долга — «пересдача», даты нет — «дата не назначена», у сданного без даты — только вид. */
function controlFormText(item: DisciplineDetail): string {
  const state = describeDiscipline(item)
  const word = (state.kind === 'debt' ? 'Пересдача' : controlKindLabel(item.controlKind)).toLowerCase()
  if (!item.examDate) return state.kind === 'passed' ? word : `${word} — дата не назначена`
  const parts = [`${weekdayShort(item.examDate)} ${formatDayMonth(item.examDate)}`]
  if (item.examTime) parts.push(item.examTime)
  if (item.examRoom) parts.push(`ауд. ${item.examRoom}`)
  return `${word} — ${parts.join(', ')}`
}

function ControlBlock({ item }: { item: DisciplineDetail }) {
  return (
    <section aria-label="Форма контроля" className="rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card">
      <p className="text-[length:var(--fs-md)] leading-[1.4]">
        <span className="text-muted">Форма контроля:</span>{' '}
        <b data-testid="control-form" className="font-extrabold">
          {controlFormText(item)}
        </b>
      </p>
    </section>
  )
}

function RatingRules({ controlKind }: { controlKind: string }) {
  return (
    <Card>
      <details open data-testid="rating-rules" className="group">
        <summary className="flex min-h-[var(--control-h)] cursor-pointer list-none items-center justify-between gap-[var(--sp-2)] rounded-pill border-2 border-primary bg-card px-[var(--sp-4)] font-bold text-primary group-open:bg-primary-soft [&::-webkit-details-marker]:hidden">
          <span>Правила рейтинга</span>
          <GradeIcon name="chevron" className="size-5 flex-none transition-transform group-open:rotate-90" />
        </summary>
        <ul className="mt-[var(--sp-2)] flex flex-col">
          {ratingRuleLines(controlKind).map((line) => (
            <li
              key={line}
              className="flex items-start gap-[var(--sp-2)] border-t border-border py-[var(--sp-3)] text-[length:var(--fs-md)] leading-[1.4] before:mt-[7px] before:size-2 before:flex-none before:rounded-full before:bg-primary before:content-[''] first:border-t-0"
            >
              {line}
            </li>
          ))}
          <li className="flex items-start gap-[var(--sp-2)] border-t border-border py-[var(--sp-3)] text-[length:var(--fs-sm)] leading-[1.4] text-muted">
            <SubjectIcon name="info" className="mt-[3px] size-4 flex-none" />
            {RULES_NOTE}
          </li>
        </ul>
      </details>
    </Card>
  )
}

function Works({ item, today }: { item: DisciplineDetail; today: string }) {
  if (item.assignments.length === 0) {
    return <EmptyState title="Работ пока нет" text="Когда кафедра назначит работы со сроками, они появятся здесь." />
  }
  return (
    <Card className="flex flex-col gap-[var(--sp-2)]">
      <CardTitle>Работы</CardTitle>
      <WorksView works={item.assignments} today={today} disciplineName={item.name} headingLevel={3} />
    </Card>
  )
}

function Materials({ titles }: { titles: string[] }) {
  return (
    <Card className="flex flex-col gap-[var(--sp-1)]">
      <CardTitle>Материалы курса</CardTitle>
      <p className="text-[length:var(--fs-sm)] text-muted">В концепте — только названия, файлы не загружаются</p>
      <ul data-testid="materials">
        {titles.map((title) => (
          <li
            key={title}
            className="flex min-h-[var(--tap)] items-center gap-[var(--sp-3)] border-t border-border py-[var(--sp-2)] text-[length:var(--fs-md)] font-semibold first:border-t-0"
          >
            <SubjectIcon name="doc" className="size-6 flex-none text-muted" />
            {title}
          </li>
        ))}
      </ul>
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
        className="-mb-1 inline-flex min-h-[var(--tap)] min-w-[var(--tap)] items-center gap-1 self-start pr-3 text-[length:var(--fs-md)] font-bold text-primary focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <GradeIcon name="back" className="size-5 flex-none" />
        Успеваемость
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
      {showTargets ? <ExamTargets item={item} /> : null}
      <div className="flex flex-col gap-[var(--gap)] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start">
        <div className="flex flex-col gap-[var(--gap)]">
          {item.teachers.length > 0 ? <Teachers teachers={item.teachers} /> : null}
          <ControlBlock item={item} />
        </div>
        <RatingRules controlKind={item.controlKind} />
      </div>
      <Works item={item} today={today} />
      {item.materials.length > 0 ? <Materials titles={item.materials} /> : null}
    </div>
  )
}
