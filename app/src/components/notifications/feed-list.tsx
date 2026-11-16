import Link from 'next/link'
import { markAllFeedReadAction, openFeedItemAction } from '@/app/notifications/actions'
import { safeInternalPath, type NotificationsFilter } from '@/app/notifications/filter'
import { Card } from '@/components/card'
import { RequestIcon } from '@/components/requests/icons'
import { Button } from '@/components/ui/button'
import { formatDate, todayIn } from '@/lib/dates'
import type { FeedItem } from '@/server/dal/student'

// Строка непрочитанного и лента Э-9 (пакет 3.5). Карточка по дизайн-системе 5.2, плашка «Новое» 5.4 (золотая, без значка),
// кнопки 5.1. Отметка «прочитано» ставится только отправкой формы: у ссылки её нет, предзагрузка ссылок ничего не отмечает.
// «Новое» — слово, а не цвет. Пометка живёт, пока запись не открыли.

/** Адрес записи, по которому ведёт карточка. Ссылка на сам экран уведомлений и негодная ссылка — это «ссылки нет». */
function targetOf(item: FeedItem): string | null {
  const link = safeInternalPath(item.link)
  return link === null || link === '/notifications' ? null : link
}

// Карточка-ссылка и карточка-кнопка: рамка фокуса внутри карточки, отступ −3 px (раздел 5, «Общие правила»).
const LINK_CARD =
  'flex min-h-[var(--tap)] w-full items-start gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] text-left shadow-card active:bg-primary-soft focus-visible:-outline-offset-3'

function HiddenFields({ item, filter }: { item: FeedItem; filter: NotificationsFilter | null }) {
  return (
    <>
      <input type="hidden" name="source" value={item.source} />
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="filter" value={filter ?? ''} />
    </>
  )
}

export function UnreadBar({ count, filter }: { count: number; filter: NotificationsFilter | null }) {
  return (
    <div className="mt-[var(--gap)] flex flex-wrap items-center justify-between gap-[var(--sp-2)]">
      <p className="text-[length:var(--fs-md)] font-bold" data-testid="unread-line">
        Непрочитанных: {count}
      </p>
      {count > 0 ? (
        <form action={markAllFeedReadAction}>
          <input type="hidden" name="filter" value={filter ?? ''} />
          <Button type="submit" variant="ghost">
            Отметить все прочитанными
          </Button>
        </form>
      ) : null}
    </div>
  )
}

export function FeedList({ items, filter, tz }: { items: FeedItem[]; filter: NotificationsFilter | null; tz: string }) {
  return (
    <ul className="mt-[var(--gap)] flex flex-col gap-[var(--gap)]">
      {items.map((item) => {
        const target = targetOf(item)
        const body = (
          <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
            <span className="flex flex-wrap items-center gap-x-[var(--sp-2)] gap-y-1 text-[length:var(--fs-sm)] text-muted">
              {formatDate(todayIn(tz, item.at))}
              {item.read ? null : (
                <span className="rounded-pill bg-accent-2-bg px-2 py-1 text-[length:var(--fs-xs)] font-bold leading-[1.2] text-accent-2-text">Новое</span>
              )}
            </span>
            <span className="text-[length:var(--fs-md)] font-bold leading-[1.3]">{item.title}</span>
            <span className="text-[length:var(--fs-sm)]">{item.body}</span>
          </span>
        )
        const chevron = <RequestIcon name="chevron" className="mt-1 size-4 flex-none text-primary" />
        let card
        if (target && !item.read) {
          card = (
            <form action={openFeedItemAction}>
              <HiddenFields item={item} filter={filter} />
              <button type="submit" className={LINK_CARD}>
                {body}
                {chevron}
              </button>
            </form>
          )
        } else if (target) {
          card = (
            <Link href={target} className={LINK_CARD}>
              {body}
              {chevron}
            </Link>
          )
        } else if (!item.read) {
          card = (
            <Card className="flex flex-col gap-[var(--sp-2)]">
              {body}
              <form action={openFeedItemAction}>
                <HiddenFields item={item} filter={filter} />
                <Button type="submit" variant="soft" className="w-full">
                  Отметить прочитанным
                </Button>
              </form>
            </Card>
          )
        } else {
          card = <Card className="flex">{body}</Card>
        }
        return <li key={`${item.source}:${item.id}`}>{card}</li>
      })}
    </ul>
  )
}
