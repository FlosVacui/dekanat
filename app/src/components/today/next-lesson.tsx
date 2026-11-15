import { GradeIcon } from '@/components/grades/icons'
import { LinkButton } from '@/components/link-button'
import { lessonKindLabel } from '@/lib/labels'
import type { NextLesson } from '@/lib/today'

// Блок «следующая пара» (D-2.2-system, 5.2; макет V-AC, «Сегодня»): строка над временем, время `.hero-time`, название, вид · аудитория · преподаватель,
// главная кнопка. Подпись «Следующая пара» для экранного чтеца — у самой секции. Цвет рамки фокуса в блоке — --on-header.
const BLOCK =
  'flex flex-col gap-[var(--sp-2)] rounded-surface border border-border bg-hero-bg p-[var(--card-pad)] text-on-hero shadow-card'

export function NextLessonBlock({ next, finished }: { next: NextLesson | null; finished: boolean }) {
  if (!next) {
    return (
      <section aria-label="Следующая пара" className={BLOCK}>
        {finished ? <p className="text-[length:var(--fs-sm)]">Сегодня пар больше нет</p> : null}
        <p className="text-[length:var(--fs-sm)]">Ближайших пар в расписании нет</p>
      </section>
    )
  }
  const { entry } = next
  return (
    <section aria-label="Следующая пара" className={BLOCK}>
      {finished ? <p className="text-[length:var(--fs-sm)]">Сегодня пар больше нет</p> : null}
      <p className="text-[length:var(--fs-sm)] font-semibold text-on-hero-muted">{next.eyebrow}</p>
      <p className="hero-time text-[length:var(--fs-num)] font-extrabold leading-[1.05] tracking-[-.01em]">
        {entry.startsAt}
        <span className="text-[length:var(--fs-lg)] font-semibold tracking-normal text-on-hero-muted"> – {entry.endsAt}</span>
      </p>
      <h2 className="text-[length:var(--fs-lg)] font-bold leading-tight [overflow-wrap:anywhere]">{entry.discipline}</h2>
      <p className="text-[length:var(--fs-sm)] text-on-hero-muted">
        {lessonKindLabel(entry.lessonKind)} · ауд. {entry.room} · {entry.teacher}
      </p>
      <LinkButton href={next.href} className="mt-[var(--sp-2)] gap-1 focus-visible:outline-on-header">
        {next.buttonLabel}
        <GradeIcon name="chevron" className="size-4 flex-none" />
      </LinkButton>
    </section>
  )
}
