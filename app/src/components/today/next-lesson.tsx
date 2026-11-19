import Link from 'next/link'
import { GradeIcon } from '@/components/grades/icons'
import { lessonKindLabel } from '@/lib/labels'
import type { NextLesson } from '@/lib/today'

// Ближайшая пара по макету docs/design/mockups/design-pass/today.html: без синей шапки. Слева время 30 px и «до 11:45»,
// справа дисциплина, вид занятия, преподаватель и аудитория; при смене аудитории новая стоит на жёлтой плашке, прежняя зачёркнута.
// Плашка статуса дня («На сегодня всё») стоит отдельно над блоком. Под блоком — ссылка «Расписание на неделю».
// Название секции для экранного чтеца — «Следующая пара». Для пары другого дня над названием стоит заголовок даты («Завтра, ср 18 ноября»).
const CARD = 'rounded-surface border border-border bg-hero-bg text-on-hero'

export const WEEK_LINK_HREF = '/schedule?view=week'

export function NextLessonBlock({ next, finished }: { next: NextLesson | null; finished: boolean }) {
  return (
    <div className="flex flex-col gap-[var(--gap)]">
      {finished ? (
        <p
          data-testid="day-status"
          className="flex items-center gap-[var(--sp-3)] rounded-surface border-2 border-success bg-card px-[var(--sp-4)] py-[var(--sp-3)] text-[length:var(--fs-md)] font-bold leading-[1.3]"
        >
          <span className="grid size-8 flex-none place-items-center rounded-full bg-success text-card">
            <GradeIcon name="check" className="size-5 flex-none" />
          </span>
          На сегодня всё: пары закончились
        </p>
      ) : null}
      {next ? <Ticket next={next} /> : <EmptyTicket />}
    </div>
  )
}

function EmptyTicket() {
  return (
    <section aria-label="Следующая пара" className={CARD}>
      <div className="flex items-center gap-[var(--sp-3)] p-[var(--card-pad)]">
        <GradeIcon name="clock" className="size-7 flex-none" />
        <p className="text-[length:var(--fs-lg)] font-bold leading-[1.25]">В ближайшие 7 дней пар нет</p>
      </div>
    </section>
  )
}

function Ticket({ next }: { next: NextLesson }) {
  const { entry } = next
  return (
    <div className="flex flex-col gap-[var(--sp-2)]">
      <section aria-label="Следующая пара" className={`${CARD} grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--sp-4)] gap-y-1 p-[var(--card-pad)]`}>
        <div className="col-span-2 flex flex-wrap items-center gap-x-[var(--sp-2)] gap-y-1">
          <p data-testid="next-caption" className="text-[length:var(--fs-sm)] font-semibold text-on-hero-muted">
            {next.kind === 'now' ? (
              <span className="inline-flex items-center gap-[var(--sp-1)] rounded-tag bg-primary-soft px-[var(--sp-2)] py-[3px] font-bold text-primary">
                <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
                {next.caption}
              </span>
            ) : (
              next.caption
            )}
          </p>
          {next.kind === 'other_day' ? (
            <h2 data-testid="next-date" className="text-[length:var(--fs-md)] font-bold leading-[1.2]">
              {next.dateTitle}
            </h2>
          ) : null}
        </div>
        <p className="hero-time flex flex-col text-[30px] font-bold leading-[1.1] tracking-[-.02em]">
          {entry.startsAt}{' '}
          <span className="mt-0.5 text-[length:var(--fs-sm)] font-medium tracking-normal text-on-hero-muted">до {entry.endsAt}</span>
        </p>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p data-testid="next-discipline" className="text-[length:var(--fs-lg)] font-semibold leading-[1.25] [overflow-wrap:anywhere]">
            {entry.discipline}
          </p>
          <p className="text-[length:var(--fs-sm)] text-on-hero-muted [overflow-wrap:anywhere]">
            {lessonKindLabel(entry.lessonKind)}, {entry.teacher}
          </p>
          <p data-testid="next-room" className="mt-[var(--sp-1)] flex flex-wrap items-center gap-1.5 text-[length:var(--fs-sm)]">
            Аудитория{' '}
            {entry.roomChange ? (
              <>
                <b className="rounded-tag bg-warning-bg px-2 py-px text-[length:var(--fs-md)] font-bold text-warning">{entry.roomChange.to}</b>
                <s className="text-muted">
                  <span className="sr-only">было </span>
                  {entry.roomChange.from}
                </s>
              </>
            ) : (
              <b className="font-bold">{entry.room}</b>
            )}
          </p>
        </div>
      </section>
      <Link
        href={WEEK_LINK_HREF}
        className="inline-flex min-h-[var(--tap)] items-center gap-1 self-start text-[length:var(--fs-sm)] font-semibold text-primary"
      >
        Расписание на неделю
        <GradeIcon name="chevron" className="size-4 flex-none" />
      </Link>
    </div>
  )
}
