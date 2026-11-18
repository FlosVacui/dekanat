import { lessonKindLabel } from '@/lib/labels'
import type { ScheduleEntry } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import { EntryChangePanel } from './change-chip'

// Карточка пары в виде «День» (макет М2-Б; D-2.2-system, раздел 8, пример «отменённая пара»). Экран ничего не считает: порядок, строка
// изменения, «Перенесена на» и слово плашки приходят готовыми из buildSchedule. Карточка делится на две части: сверху время, название,
// вид и то, что не менялось; снизу панель изменения на всю ширину, если пара менялась.
// Не только цвет: в панели плашка со значком и словом; у отмены название и время зачёркнуты, а панель говорит «Занятие не состоится».
// Прежний номер аудитории и прежний преподаватель названы в панели один раз, поэтому из верхней части эти строки убраны.

export function LessonCard({ entry }: { entry: ScheduleEntry }) {
  const { cancelled } = entry
  const isOldPlace = entry.placement === 'moved_from'
  const dim = cn('text-[length:var(--fs-sm)] text-muted', cancelled && 'line-through decoration-2')
  // Строки, которые изменение уже назвало в панели, сверху не повторяются.
  const roomInPanel = entry.roomChange !== null
  const teacherInPanel = entry.changeKind === 'teacher_changed' && entry.was !== null
  return (
    <article className="flex flex-col overflow-hidden rounded-surface border border-border bg-card shadow-card">
      <div className="flex flex-1 flex-col gap-1 p-[var(--card-pad)]">
        <p
          className={cn(
            'text-[length:var(--fs-lg)] font-extrabold leading-[1.2] tabular-nums',
            (cancelled || isOldPlace) && 'text-muted',
            cancelled && 'line-through decoration-2',
          )}
        >
          <b className="font-extrabold">{entry.startsAt}</b>–<span>{entry.endsAt}</span>
        </p>
        {/* В виде «День» после заголовка страницы (h1) идут карточки: уровень h2, без пропуска. */}
        <h2
          className={cn(
            'text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]',
            (cancelled || isOldPlace) && 'text-muted',
            cancelled && 'line-through decoration-2',
          )}
        >
          {entry.discipline}
          {cancelled ? <span className="sr-only">, отменено</span> : null}
        </h2>
        <p className={dim}>{lessonKindLabel(entry.lessonKind)}</p>
        {roomInPanel ? null : <p className={cn(dim, '[overflow-wrap:anywhere]')}>Аудитория: {entry.room}</p>}
        {teacherInPanel ? null : <p className={cn(dim, '[overflow-wrap:anywhere]')}>Преподаватель: {entry.teacher}</p>}
      </div>
      <EntryChangePanel entry={entry} />
    </article>
  )
}
