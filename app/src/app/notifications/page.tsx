import { PageTitle } from '@/components/card'
import { EmptyState } from '@/components/grades/empty-state'
import { FeedList, UnreadBar } from '@/components/notifications/feed-list'
import { FilterSwitch } from '@/components/notifications/filter-switch'
import { TimeReminders } from '@/components/notifications/time-reminders'
import { StudentShell } from '@/components/student-shell'
import { timeReminders } from '@/lib/reminders/due'
import { todayIn } from '@/lib/dates'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { countMyUnreadNotifications, listMyFeed, listMyGrades } from '@/server/dal/student'
import { parseFilter } from './filter'

// Э-9 «Уведомления»: личные уведомления и объявления деканата одной лентой с фильтром (пакет 3.5, ЯД-5).
// Фильтр — параметр адреса ?filter=news или ?filter=reminders; мусор в нём даёт «Все».
// Число в строке «Непрочитанных: N» — тот же счёт, что у колокольчика: по всей ленте, а не по фильтру.
// 20.11: над лентой — строки, которые рождает время («Завтра срок: …», «Сегодня экзамен: …»): считаются на лету, не хранятся, не читаются
// и в счёт непрочитанного не входят. Видны под «Все» и «Напоминания»; под «Новости и объявления» их нет.
export const dynamic = 'force-dynamic'

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  const actor = await requireStudentActor()
  const filter = parseFilter((await searchParams).filter)
  const tz = getConfig().timezone
  const [feed, unread, grades] = await Promise.all([listMyFeed(actor), countMyUnreadNotifications(actor), listMyGrades(actor, todayIn(tz))])
  const shown = filter === null ? feed : feed.filter((item) => item.feed === (filter === 'news' ? 'news' : 'reminder'))
  const timed = filter === 'news' ? [] : timeReminders(grades, todayIn(tz))
  return (
    <StudentShell actor={actor} active="notifications">
      <PageTitle>Уведомления</PageTitle>
      <FilterSwitch filter={filter} />
      <UnreadBar count={unread} filter={filter} />
      <TimeReminders items={timed} />
      {feed.length === 0 && timed.length === 0 ? (
        <div className="mt-[var(--gap)]">
          <EmptyState title="Уведомлений пока нет" text="Здесь появятся сообщения о заявках, сроках и изменениях в расписании" />
        </div>
      ) : shown.length === 0 && timed.length === 0 ? (
        <div className="mt-[var(--gap)]">
          <EmptyState title="Здесь пока ничего нет" />
        </div>
      ) : shown.length === 0 ? null : (
        <FeedList items={shown} filter={filter} tz={tz} />
      )}
    </StudentShell>
  )
}
