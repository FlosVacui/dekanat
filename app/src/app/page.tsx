import { redirect } from 'next/navigation'
import { Chip } from '@/components/grades/chip'
import { PageTitle } from '@/components/card'
import { RequestStatusChip } from '@/components/requests/status-chip'
import { dayHref } from '@/components/schedule/hrefs'
import { StudentShell } from '@/components/student-shell'
import { NextLessonBlock } from '@/components/today/next-lesson'
import { ChangesBlock, ChangeTile, EmptyRow, RowLink, RowList, RowMeta, TodayBlock } from '@/components/today/row-list'
import { endOfWeek, formatDayMonth, nowTimeIn, todayIn, weekdayShort } from '@/lib/dates'
import { isRequestKind, isRequestStatus, REQUEST_KIND_INFO, statusText } from '@/lib/requests'
import { scheduleRange } from '@/lib/schedule'
import { buildToday } from '@/lib/today'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getCurrentActor } from '@/server/auth/cookie'
import { getConfig } from '@/server/config'
import {
  listMyAssignmentsDue,
  listMyLessons,
  listMyRequests,
  listMyUnreadAnnouncements,
} from '@/server/dal/student'

// Э-2 «Сегодня»: следующая пара; изменения на сегодня и завтра; что сдать на этой неделе; заявки с новостью; непрочитанные объявления.
// Раскладку считает чистая функция buildToday (lib/today.ts), экран только рисует. Пары просятся с запасом назад (scheduleRange):
// пара, перенесённая на сегодня с прошедшего дня, стоит в базе на старой дате. Состояния «загрузка» и «ошибка» — пакет 3.7.
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  // Сотрудника с корня ведём на его список; студента и гостя решает охрана страницы.
  const current = await getCurrentActor()
  if (current?.role === 'staff') redirect('/staff/requests')
  const actor = await requireStudentActor()

  const tz = getConfig().timezone
  const today = todayIn(tz)
  const now = nowTimeIn(tz)
  const range = scheduleRange(today)
  const [lessons, due, requests, announcements] = await Promise.all([
    listMyLessons(actor, range.from, range.to),
    listMyAssignmentsDue(actor, today, endOfWeek(today)),
    listMyRequests(actor),
    listMyUnreadAnnouncements(actor),
  ])

  const view = buildToday(lessons, due, today, now)
  const news = requests.filter((r) => ['in_progress', 'ready', 'rejected'].includes(r.status))

  return (
    <StudentShell actor={actor} active="today">
      <div className="mb-[var(--gap)] [&>h1]:mb-0">
        <PageTitle>Сегодня</PageTitle>
        <p className="mt-[var(--sp-1)] text-[length:var(--fs-sm)] text-muted">{view.subtitle}</p>
      </div>
      {/* На компьютере от 1024 px — две колонки блоков; на телефоне — одна лента, порядок тот же. */}
      <div className="flex flex-col gap-[var(--gap)] lg:grid lg:grid-cols-2 lg:items-start">
        <NextLessonBlock next={view.next} finished={view.todayFinished} />

        {view.changes.length === 0 ? (
          <TodayBlock id="today-changes" title="Изменения в расписании">
            <EmptyRow>На сегодня и завтра изменений нет</EmptyRow>
          </TodayBlock>
        ) : (
          <ChangesBlock id="today-changes" title="Изменения в расписании">
            {view.changes.map(({ dayWord, date, entry }) => (
              <ChangeTile key={entry.key} href={dayHref(date === today ? undefined : date)} dayWord={dayWord} entry={entry} />
            ))}
          </ChangesBlock>
        )}

        <TodayBlock id="today-due" title="Что сдать на этой неделе">
          {view.due.length === 0 ? (
            <EmptyRow>На этой неделе сдавать нечего</EmptyRow>
          ) : (
            <RowList>
              {view.due.map((w) => (
                <RowLink
                  key={w.id}
                  href={`/grades/${w.disciplineId}`}
                  chip={<Chip tone={w.tone}>{w.chip}</Chip>}
                  title={w.title}
                  meta={<RowMeta>{`${w.discipline} · до ${weekdayShort(w.dueDate)}, ${formatDayMonth(w.dueDate)}`}</RowMeta>}
                />
              ))}
            </RowList>
          )}
        </TodayBlock>

        <TodayBlock id="today-requests" title="Мои заявки">
          {news.length === 0 ? (
            <EmptyRow>Новостей по заявкам нет</EmptyRow>
          ) : (
            <RowList>
              {news.map((r) => (
                <RowLink
                  key={r.id}
                  href={`/requests/${r.id}`}
                  chip={isRequestStatus(r.status) ? <RequestStatusChip status={r.status} /> : null}
                  title={isRequestKind(r.kind) ? REQUEST_KIND_INFO[r.kind].title : 'Заявка'}
                  meta={
                    isRequestKind(r.kind) && isRequestStatus(r.status) ? (
                      <RowMeta>
                        {statusText({
                          kind: r.kind,
                          status: r.status,
                          dueDate: r.dueDate,
                          pickupUntil: r.pickupUntil,
                          issuedOn: r.issuedOn,
                          rejectReason: r.rejectReason,
                        })}
                      </RowMeta>
                    ) : null
                  }
                />
              ))}
            </RowList>
          )}
        </TodayBlock>

        <TodayBlock
          id="today-announcements"
          title="Объявления"
          aside={
            announcements.length > 0 ? (
              <span className="inline-flex items-center whitespace-nowrap rounded-pill bg-accent-2-bg px-2 py-1 text-[length:var(--fs-xs)] font-bold leading-[1.2] text-accent-2-text">
                {`Новых: ${announcements.length}`}
              </span>
            ) : null
          }
        >
          {announcements.length === 0 ? (
            <EmptyRow>Новых объявлений нет</EmptyRow>
          ) : (
            <RowList>
              {announcements.map((a) => (
                <RowLink key={a.id} href="/notifications?filter=news" title={a.title} meta={<RowMeta clamp>{a.body}</RowMeta>} />
              ))}
            </RowList>
          )}
        </TodayBlock>
      </div>
    </StudentShell>
  )
}
