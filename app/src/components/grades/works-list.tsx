import { formatDayMonth, weekdayShort } from '@/lib/dates'
import {
  displayPoints,
  pointsWord,
  summarizeWorks,
  WORK_STATUS_WORD,
  workBarPercent,
  workStatus,
  workStatusPhrase,
  worksSummaryParts,
  type WorkStatus,
} from '@/lib/grades'
import { cn } from '@/lib/utils'
import type { WorkItem } from '@/server/dal/student'
import { Chip, type ChipTone } from './chip'
import { GradeIcon, type GradeIconName } from './icons'

// Работы дисциплины по М3-А: сводка одной строкой, на телефоне — список (название, срок, плашка-фраза, полоса баллов),
// от 1024 px (lg) — таблица «Работа, Срок, Статус, Баллы». Оба вида лежат в разметке рядом, лишний скрыт стилем: скриптов нет.
// Статус — значок и слово, цвет только дополняет. Полоса скрыта от экранного чтеца: число баллов написано рядом.
// Один компонент на карточку предмета в «Успеваемости» и на страницу предмета (М4).

const STATUS_TONE: Record<WorkStatus, ChipTone> = { done: 'ok', debt: 'err', upcoming: 'info' }
const STATUS_ICON: Record<WorkStatus, GradeIconName> = { done: 'check', debt: 'x', upcoming: 'clock' }
const STATUS_TEXT: Record<WorkStatus, string> = { done: 'text-success', debt: 'text-error', upcoming: 'text-primary' }

function dueLine(dueDate: string): string {
  return `${formatDayMonth(dueDate)}, ${weekdayShort(dueDate)}`
}

/** «Сдано 3 · Долг 1 · Впереди 2»: значок и слово у каждой части; частей с нулём нет. */
export function WorksSummaryLine({ works, today }: { works: WorkItem[]; today: string }) {
  const parts = worksSummaryParts(summarizeWorks(works, today))
  return (
    <p
      data-testid="works-summary"
      className="flex flex-wrap items-center gap-x-[var(--sp-2)] gap-y-[var(--sp-1)] text-[length:var(--fs-md)] font-bold"
    >
      {/* R-4.6-9: разделитель «·» стоит в одной неразрывной группе со следующей частью — при переносе строки он уходит
          вместе с ней и не остаётся в конце строки. Текст для теста и для экранного чтеца прежний. */}
      {parts.map((part, index) => (
        <span key={part.status} className="inline-flex items-center gap-x-[var(--sp-2)] whitespace-nowrap">
          {index > 0 ? (
            <span aria-hidden="true" className="font-normal text-muted">
              {' · '}
            </span>
          ) : null}
          <span className={cn('inline-flex items-center gap-1', STATUS_TEXT[part.status])}>
            <GradeIcon name={STATUS_ICON[part.status]} />
            {part.text}
          </span>
        </span>
      ))}
    </p>
  )
}

function WorkBar({ work, className }: { work: WorkItem; className?: string }) {
  const percent = workBarPercent(work)
  return (
    <div aria-hidden="true" className={cn('relative h-3 w-full overflow-hidden rounded-pill border border-border-strong bg-bg', className)}>
      {percent > 0 ? <div className="h-full bg-primary" style={{ width: `${percent}%` }} /> : null}
    </div>
  )
}

function maxLine(work: WorkItem): string {
  return `максимум ${work.maxPoints} ${pointsWord(work.maxPoints)}`
}

function PhoneList({ works, today, headingLevel }: { works: WorkItem[]; today: string; headingLevel: 3 | 4 }) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4'
  return (
    <ul data-testid="works-list" className="flex flex-col lg:hidden">
      {works.map((work) => {
        const status = workStatus(work, today)
        return (
          <li
            key={work.id}
            data-status={status}
            className="flex flex-col items-start gap-[var(--sp-1)] border-t border-border py-[var(--sp-3)] first:border-t-0"
          >
            <Heading className="text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]">{work.title}</Heading>
            {status === 'done' ? <p className="text-[length:var(--fs-sm)] text-muted">Срок: {dueLine(work.dueDate)}</p> : null}
            <Chip tone={STATUS_TONE[status]} className="px-2.5 py-1.5 text-[length:var(--fs-sm)]">
              {workStatusPhrase(work, today)}
            </Chip>
            <WorkBar work={work} />
            {status === 'done' ? null : <p className="text-[length:var(--fs-sm)] tabular-nums text-muted">{maxLine(work)}</p>}
          </li>
        )
      })}
    </ul>
  )
}

function DesktopTable({ works, today, caption }: { works: WorkItem[]; today: string; caption: string }) {
  const th = 'border-b-2 border-border-strong px-[var(--sp-3)] py-[var(--sp-2)] text-left text-[length:var(--fs-sm)] font-extrabold text-muted'
  const td = 'border-b border-border p-[var(--sp-3)] align-middle'
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table data-testid="works-table" className="w-full border-collapse text-[length:var(--fs-sm)]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>
              Работа
            </th>
            <th scope="col" className={th}>
              Срок
            </th>
            <th scope="col" className={th}>
              Статус
            </th>
            <th scope="col" className={th}>
              Баллы
            </th>
          </tr>
        </thead>
        <tbody>
          {works.map((work) => {
            const status = workStatus(work, today)
            return (
              <tr key={work.id} data-status={status}>
                <td className={cn(td, 'text-[length:var(--fs-md)] font-bold [overflow-wrap:anywhere]')}>{work.title}</td>
                <td className={cn(td, 'whitespace-nowrap')}>{dueLine(work.dueDate)}</td>
                <td className={td}>
                  <Chip tone={STATUS_TONE[status]}>{WORK_STATUS_WORD[status]}</Chip>
                </td>
                <td className={td}>
                  <span className="flex items-center gap-[var(--sp-3)] tabular-nums">
                    <span className="whitespace-nowrap">
                      {status === 'done' ? `${displayPoints(work.points, work.maxPoints)} из ${work.maxPoints}` : maxLine(work)}
                    </span>
                    <WorkBar work={work} className="inline-block w-[140px] flex-none" />
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Сводка, список для телефона и таблица для компьютера. Заголовки работ — h3 на странице предмета и h4 в карточке. */
export function WorksView({
  works,
  today,
  disciplineName,
  headingLevel,
}: {
  works: WorkItem[]
  today: string
  disciplineName: string
  headingLevel: 3 | 4
}) {
  return (
    <div className="flex flex-col gap-[var(--sp-2)]">
      <WorksSummaryLine works={works} today={today} />
      <PhoneList works={works} today={today} headingLevel={headingLevel} />
      <DesktopTable works={works} today={today} caption={`Работы по дисциплине «${disciplineName}»`} />
    </div>
  )
}
