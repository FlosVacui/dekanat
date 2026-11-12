import { Card, PageTitle } from '@/components/card'
import { StudentShell } from '@/components/student-shell'
import { formatDayMonth, todayIn, weekdayShort } from '@/lib/dates'
import { changeKindLabel, lessonKindLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listMyLessons } from '@/server/dal/student'

// Э-3 «Расписание»: в М0 только вид «день» на сегодня. Неделя, полоса дней и заметные изменения — пакет 3.2.
export const dynamic = 'force-dynamic'

export default async function SchedulePage() {
  const actor = await requireStudentActor()
  const today = todayIn(getConfig().timezone)
  const lessons = await listMyLessons(actor, today, today)
  return (
    <StudentShell actor={actor} active="schedule">
      <PageTitle>
        Расписание на сегодня
        <span className="block text-sm font-normal text-neutral-700">
          {weekdayShort(today)}, {formatDayMonth(today)}
        </span>
      </PageTitle>
      {lessons.length === 0 ? (
        <Card>
          <p className="text-sm">Сегодня пар нет</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {lessons.map((l) => {
            const cancelled = l.change?.kind === 'cancelled'
            return (
              <li key={l.id}>
                <Card>
                  <div className="text-sm font-medium">
                    {l.startsAt}–{l.endsAt}
                  </div>
                  <div className={cn('text-base font-semibold', cancelled && 'text-neutral-600 line-through')}>
                    {l.discipline}
                  </div>
                  <div className="text-sm text-neutral-800">
                    {lessonKindLabel(l.kind)}
                    <br />
                    Аудитория: {l.room}
                    <br />
                    Преподаватель: {l.teacher}
                  </div>
                  {l.change ? (
                    <p className="mt-2 rounded border border-amber-700 bg-amber-50 p-2 text-sm text-amber-950">
                      <span className="font-medium">{changeKindLabel(l.change.kind)}:</span> {l.change.note}
                    </p>
                  ) : null}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </StudentShell>
  )
}
