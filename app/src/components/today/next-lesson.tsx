import { GradeIcon } from '@/components/grades/icons'
import { LinkButton } from '@/components/link-button'
import { lessonKindLabel } from '@/lib/labels'
import type { NextLesson } from '@/lib/today'

// Блок «следующая пара» по макету М1-Б, «билет» (D-2.2-system, 5.2): плашка статуса дня стоит отдельно над блоком; в блоке синяя шапка
// с подписью и заголовком даты, под ней слева время (`.hero-time`), справа через пунктир — дисциплина и подробности, ниже кнопка.
// Иерархия — размером и жирностью: подпись 14, заголовок даты 19, время 36, не одним шрифтом. Подпись «Следующая пара» для экранного чтеца —
// у самой секции. Цвет рамки фокуса внутри блока — --on-header. От 1024 px «билет» вытянут в строку: кнопка справа от подробностей.
const TICKET = 'overflow-hidden rounded-surface border border-border bg-hero-bg text-on-hero shadow-card'

export function NextLessonBlock({ next, finished }: { next: NextLesson | null; finished: boolean }) {
  return (
    // Одна обёртка: на компьютере блок занимает обе колонки ленты, плашка и «билет» остаются вместе.
    <div className="flex flex-col gap-[var(--gap)] lg:col-span-2">
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
    <section aria-label="Следующая пара" className={TICKET}>
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
    <section aria-label="Следующая пара" className={TICKET}>
      <div className="flex flex-col bg-primary px-[var(--card-pad)] py-[var(--sp-2)] text-on-primary lg:flex-row lg:items-baseline lg:gap-[var(--sp-3)]">
        <p data-testid="next-caption" className="text-[length:var(--fs-sm)] font-semibold">
          {next.kind === 'now' ? (
            <span className="inline-flex items-center gap-[var(--sp-1)] rounded-pill bg-on-primary px-[var(--sp-2)] py-[3px] font-bold text-primary">
              <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              {next.caption}
            </span>
          ) : (
            next.caption
          )}
        </p>
        <h2 data-testid="next-date" className="text-[length:var(--fs-lg)] font-extrabold leading-[1.2]">
          {next.dateTitle}
        </h2>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-[var(--sp-3)] p-[var(--card-pad)] lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <p className="hero-time flex flex-col text-[length:var(--fs-num)] font-extrabold leading-[1.05] tracking-[-.01em]">
          {entry.startsAt}
          <span className="text-[length:var(--fs-md)] font-semibold tracking-normal text-on-hero-muted"> – {entry.endsAt}</span>
        </p>
        <div className="flex min-w-0 flex-col gap-0.5 border-l-2 border-dashed border-border-strong pl-[var(--sp-3)]">
          <p data-testid="next-discipline" className="text-[length:var(--fs-lg)] font-bold leading-[1.25] [overflow-wrap:anywhere]">
            {entry.discipline}
          </p>
          {/* На телефоне подробности в столбик, от 1024 px — одной строкой через « · ». */}
          <p className="text-[length:var(--fs-sm)] text-on-hero-muted">
            <span className="block lg:inline">{lessonKindLabel(entry.lessonKind)}</span>
            <span className="hidden lg:inline"> · </span>
            <span className="block lg:inline">ауд. {entry.room}</span>
            <span className="hidden lg:inline"> · </span>
            <span className="block lg:inline">{entry.teacher}</span>
          </p>
        </div>
        <LinkButton href={next.href} className="col-span-2 gap-1 focus-visible:outline-on-header lg:col-span-1 lg:whitespace-nowrap">
          {next.buttonLabel}
          <GradeIcon name="chevron" className="size-4 flex-none" />
        </LinkButton>
      </div>
    </section>
  )
}
