import { PageTitle } from '@/components/card'
import { EmptyState } from '@/components/grades/empty-state'
import { FeedList, UnreadBar } from '@/components/notifications/feed-list'
import { FilterSwitch } from '@/components/notifications/filter-switch'
import { StudentShell } from '@/components/student-shell'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { countMyUnreadNotifications, listMyFeed } from '@/server/dal/student'
import { parseFilter } from './filter'

// Э-9 «Уведомления»: личные уведомления и объявления деканата одной лентой с фильтром (пакет 3.5, ЯД-5).
// Фильтр — параметр адреса ?filter=news или ?filter=reminders; мусор в нём даёт «Все».
// Число в строке «Непрочитанных: N» — тот же счёт, что у колокольчика: по всей ленте, а не по фильтру.
export const dynamic = 'force-dynamic'

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  const actor = await requireStudentActor()
  const filter = parseFilter((await searchParams).filter)
  const [feed, unread] = await Promise.all([listMyFeed(actor), countMyUnreadNotifications(actor)])
  const shown = filter === null ? feed : feed.filter((item) => item.feed === (filter === 'news' ? 'news' : 'reminder'))
  const tz = getConfig().timezone
  return (
    <StudentShell actor={actor} active={null}>
      <PageTitle>Уведомления</PageTitle>
      <FilterSwitch filter={filter} />
      <UnreadBar count={unread} filter={filter} />
      {feed.length === 0 ? (
        <div className="mt-[var(--gap)]">
          <EmptyState title="Уведомлений пока нет" text="Здесь появятся сообщения о заявках, сроках и изменениях в расписании" />
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-[var(--gap)]">
          <EmptyState title="Здесь пока ничего нет" />
        </div>
      ) : (
        <FeedList items={shown} filter={filter} tz={tz} />
      )}
    </StudentShell>
  )
}
