import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { StudentShell } from '@/components/student-shell'
import { addDays, endOfWeek, formatDate, formatDayMonth, nowTimeIn, todayIn } from '@/lib/dates'
import { changeKindLabel, lessonKindLabel } from '@/lib/labels'
import { isRequestKind, isRequestStatus, REQUEST_KIND_INFO, STATUS_LABELS, statusText } from '@/lib/requests'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getCurrentActor } from '@/server/auth/cookie'
import { getConfig } from '@/server/config'
import {
  listMyAssignmentsDue,
  listMyLessons,
  listMyRequests,
  listMyUnreadAnnouncements,
} from '@/server/dal/student'

// Э-2 «Сегодня»: заготовка с пятью блоками сверху вниз (S-2.1, раздел 3). Полный экран — пакет 3.6.
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  // Сотрудника с корня ведём на его список; студента и гостя решает охрана страницы.
  const current = await getCurrentActor()
  if (current?.role === 'staff') redirect('/staff/requests')
  const actor = await requireStudentActor()

  const tz = getConfig().timezone
  const today = todayIn(tz)
  const now = nowTimeIn(tz)
  const tomorrow = addDays(today, 1)
  const [lessons, due, requests, announcements] = await Promise.all([
    listMyLessons(actor, today, addDays(today, 6)),
    listMyAssignmentsDue(actor, today, endOfWeek(today)),
    listMyRequests(actor),
    listMyUnreadAnnouncements(actor),
  ])

  const todays = lessons.filter((l) => l.date === today)
  const upcoming = lessons.find(
    (l) => (l.date > today || l.endsAt > now) && l.change?.kind !== 'cancelled',
  )
  const changes = lessons.filter((l) => l.change && (l.date === today || l.date === tomorrow))
  const news = requests.filter((r) => ['in_progress', 'ready', 'rejected'].includes(r.status))

  return (
    <StudentShell actor={actor} active="today">
      <PageTitle>Сегодня</PageTitle>
      <div className="flex flex-col gap-3">
        <Card>
          <CardTitle>Следующая пара</CardTitle>
          {todays.length === 0 ? <p className="mb-2 text-sm">Сегодня пар нет</p> : null}
          {todays.length > 0 && upcoming?.date !== today ? <p className="mb-2 text-sm">Сегодня пар больше нет</p> : null}
          {upcoming ? (
            <Link href="/schedule" className="block min-h-11 text-sm">
              <span className="font-medium">
                {upcoming.date === today ? 'Сегодня' : formatDayMonth(upcoming.date)}, {upcoming.startsAt}–{upcoming.endsAt}
              </span>
              <br />
              {upcoming.discipline}, {lessonKindLabel(upcoming.kind).toLowerCase()}
              <br />
              Аудитория {upcoming.room}, {upcoming.teacher}
            </Link>
          ) : (
            <p className="text-sm">Ближайших пар в расписании нет</p>
          )}
        </Card>

        <Card>
          <CardTitle>Изменения в расписании</CardTitle>
          {changes.length === 0 ? (
            <p className="text-sm">На сегодня и завтра изменений нет</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {changes.map((l) => (
                <li key={l.id}>
                  <Link href="/schedule" className="block min-h-11">
                    <span className="font-medium">{l.date === today ? 'Сегодня' : 'Завтра'}, {l.startsAt}</span>: {l.discipline}
                    <br />
                    {l.change ? `${changeKindLabel(l.change.kind)}: ${l.change.note}` : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Что сдать на этой неделе</CardTitle>
          {due.length === 0 ? (
            <p className="text-sm">На этой неделе сдавать нечего</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {due.map((w) => (
                <li key={w.id}>
                  <Link href="/grades" className="block min-h-11">
                    <span className="font-medium">{w.title}</span>
                    <br />
                    {w.discipline}, до {formatDate(w.dueDate)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Заявки: новости и что сделать</CardTitle>
          {news.length === 0 ? (
            <p className="text-sm">Новостей по заявкам нет</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {news.map((r) => (
                <li key={r.id}>
                  <Link href={`/requests/${r.id}`} className="block min-h-11">
                    <span className="font-medium">
                      {isRequestKind(r.kind) ? REQUEST_KIND_INFO[r.kind].title : 'Заявка'}: {isRequestStatus(r.status) ? STATUS_LABELS[r.status] : r.status}
                    </span>
                    <br />
                    {isRequestKind(r.kind) && isRequestStatus(r.status)
                      ? statusText({
                          kind: r.kind,
                          status: r.status,
                          dueDate: r.dueDate,
                          pickupUntil: r.pickupUntil,
                          issuedOn: r.issuedOn,
                          rejectReason: r.rejectReason,
                        })
                      : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Непрочитанные объявления</CardTitle>
          {announcements.length === 0 ? (
            <p className="text-sm">Новых объявлений нет</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {announcements.map((a) => (
                <li key={a.id}>
                  <Link href="/notifications?filter=news" className="block min-h-11">
                    <span className="font-medium">{a.title}</span>
                    <br />
                    {a.body}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </StudentShell>
  )
}
