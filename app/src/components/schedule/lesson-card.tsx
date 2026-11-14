import { Card } from '@/components/card'
import { lessonKindLabel } from '@/lib/labels'
import type { ScheduleEntry } from '@/lib/schedule'
import { cn } from '@/lib/utils'
import { ChangeChip } from './change-chip'

// Карточка пары в виде «День» (D-2.2-system, раздел 8, пример «отменённая пара»). Экран ничего не считает: порядок, «Было»,
// «Перенесена на» и текст плашки приходят готовыми из buildSchedule.
// Не только цвет: плашка со значком и словом стоит перед названием; зачёркнутое продублировано словами для экранного чтеца.

/** «Было: 10:15–11:45» -> «10:15–11:45»: слово «Было:» на экране набрано отдельно, а зачёркнута только суть. */
function wasValue(was: string): string {
  return was.replace(/^Было:\s*/, '')
}

export function LessonCard({ entry }: { entry: ScheduleEntry }) {
  const { cancelled } = entry
  const isNewPlace = entry.placement === 'moved_to'
  const isOldPlace = entry.placement === 'moved_from'
  return (
    <Card className="grid grid-cols-[64px_1fr] gap-[var(--sp-3)]">
      <div className="flex flex-col gap-0.5 tabular-nums">
        <b
          className={cn(
            'leading-[1.2]',
            isNewPlace ? 'text-[length:var(--fs-lg)] font-extrabold' : 'text-[length:var(--fs-md)]',
            cancelled && 'font-bold text-muted line-through decoration-2',
            isOldPlace && 'font-bold text-muted',
          )}
        >
          {entry.startsAt}
        </b>
        <span className={cn('text-[length:var(--fs-sm)] text-muted', cancelled && 'line-through decoration-2')}>{entry.endsAt}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-[3px]">
        {entry.badge && entry.changeKind ? <ChangeChip kind={entry.changeKind} label={entry.badge} className="mb-0.5" /> : null}
        {/* В виде «День» после заголовка страницы (h1) идут карточки: уровень h2, без пропуска. Вид тот же: классы заданы здесь. */}
        <h2
          className={cn(
            'text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]',
            cancelled && 'text-muted line-through decoration-2',
            isOldPlace && 'text-muted',
          )}
        >
          {entry.discipline}
          {cancelled ? <span className="sr-only">, отменено</span> : null}
        </h2>
        <p className={cn('text-[length:var(--fs-sm)] text-muted', cancelled && 'line-through decoration-2')}>
          {lessonKindLabel(entry.lessonKind)}
          <br />
          Аудитория: {entry.room}
          <br />
          Преподаватель: {entry.teacher}
        </p>
        {cancelled ? <p className="text-[length:var(--fs-sm)] font-bold text-error">Занятие не состоится</p> : null}
        {entry.movedTo ? <p className="text-[length:var(--fs-sm)] font-bold text-warning">{entry.movedTo}</p> : null}
        {entry.was ? (
          <p className="text-[length:var(--fs-sm)] text-muted">
            <span className="font-bold">Было:</span> <s className="decoration-2">{wasValue(entry.was)}</s>
          </p>
        ) : null}
        {/* Заметка нужна, когда сказать больше нечем: при отмене (причина) и когда «Было» и «Перенесена на» не собрались. */}
        {entry.note && (cancelled || (!entry.was && !entry.movedTo)) ? <p className="text-[length:var(--fs-sm)] text-muted">Заметка деканата: {entry.note}</p> : null}
      </div>
    </Card>
  )
}
