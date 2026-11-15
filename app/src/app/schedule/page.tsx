import { PageTitle } from '@/components/card'
import { DayStrip } from '@/components/schedule/day-strip'
import { EmptyDay } from '@/components/schedule/empty-day'
import { LessonCard } from '@/components/schedule/lesson-card'
import { ViewSwitch } from '@/components/schedule/view-switch'
import { WeekList } from '@/components/schedule/week-list'
import { StudentShell } from '@/components/student-shell'
import { todayIn, weekInfo } from '@/lib/dates'
import { buildSchedule, pickDay, pickView, scheduleRange } from '@/lib/schedule'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listMyLessons } from '@/server/dal/student'

// Э-3 «Расписание»: виды «День» и «Неделя», изменения и переносы (пакет 3.2).
// День и вид — параметры адреса: ?day=ГГГГ-ММ-ДД, ?view=week. Мусор в параметре не ломает экран: показывается сегодня.
// Группа берётся из сессии; в адресе её нет. Раскладку по дням делает чистая функция buildSchedule, экран только рисует.
// Состояния «загрузка» и «ошибка» — пакет 3.7.
export const dynamic = 'force-dynamic'

type Param = string | string[] | undefined

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ day?: Param; view?: Param }> }) {
  const actor = await requireStudentActor()
  const params = await searchParams
  const today = todayIn(getConfig().timezone)
  const view = pickView(params.view)
  const selected = pickDay(params.day, today)
  // Пары просятся и за прошедшие дни: запрос выбирает по дате СТАРОГО места, а перенесённая вчера пара стоит сегодня на новом.
  // buildSchedule оставляет из прошлых пар только новое место переноса, попавшее в ленту.
  const range = scheduleRange(today)
  const lessons = await listMyLessons(actor, range.from, range.to)
  const days = buildSchedule(lessons, today)
  const day = days.find((d) => d.date === selected) ?? days[0]
  const week = weekInfo(view === 'week' ? today : selected)

  return (
    <StudentShell actor={actor} active="schedule">
      <PageTitle>
        {view === 'week' ? 'Расписание на неделю' : day?.isToday ? 'Расписание на сегодня' : `Расписание на ${day?.dayMonth ?? ''}`}
        <span className="block text-[length:var(--fs-sm)] font-normal text-muted">
          {view === 'week' && days[0] && days[days.length - 1]
            ? `${days[0].dayMonth} — ${days[days.length - 1]!.dayMonth}`
            : day
              ? `${day.weekday}, ${day.dayMonth}`
              : ''}
        </span>
      </PageTitle>
      <div className="flex flex-col gap-[var(--gap)]">
        {week ? (
          <p
            data-testid="week-label"
            className="self-start rounded-pill bg-primary-soft px-2 py-1 text-[length:var(--fs-xs)] font-bold leading-[1.2] text-primary"
          >
            {view === 'week'
              ? `${week.kind === 'верхняя' ? 'Верхняя' : 'Нижняя'} неделя · ${week.number}-я`
              : `Неделя этого дня: ${week.kind === 'верхняя' ? 'верхняя' : 'нижняя'} · ${week.number}-я`}
          </p>
        ) : null}
        <ViewSwitch view={view} />
        {view === 'week' ? (
          <WeekList days={days} />
        ) : (
          <>
            <DayStrip days={days} selected={selected} />
            {day && day.entries.length > 0 ? (
              <ul className="flex flex-col gap-[var(--gap)]">
                {day.entries.map((e) => (
                  <li key={e.key}>
                    <LessonCard entry={e} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyDay isToday={day?.isToday ?? true} />
            )}
          </>
        )}
      </div>
    </StudentShell>
  )
}
