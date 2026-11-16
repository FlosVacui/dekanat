import Link from 'next/link'
import { Suspense } from 'react'
import { PageTitle } from '@/components/card'
import { EmptyState } from '@/components/grades/empty-state'
import { LinkButton } from '@/components/link-button'
import { RequestIcon } from '@/components/requests/icons'
import { RequestStatusChip } from '@/components/requests/status-chip'
import { LoadingCard } from '@/components/states/loading-card'
import { StudentFrame } from '@/components/states/shell-parts'
import { StudentShell } from '@/components/student-shell'
import { formatDate, todayIn } from '@/lib/dates'
import {
  REQUEST_KINDS,
  REQUEST_KIND_INFO,
  isRequestKind,
  isRequestStatus,
  requestFieldLine,
  statusText,
} from '@/lib/requests'
import { requireStudentActor } from '@/server/auth/page-guards'
import type { Actor } from '@/server/auth/session'
import { getConfig } from '@/server/config'
import { listMyRequests } from '@/server/dal/student'

// Э-6 «Заявки»: сверху по кнопке на каждый вид (видов три, кнопки «Все виды» нет), ниже — мои заявки (S-2.1, раздел 3).
export const dynamic = 'force-dynamic'

export default async function RequestsPage() {
  // Вход проверяется выше границы ожидания: после начала потока отказ уже не получил бы код 307 или 403 (пакет 3.7).
  const actor = await requireStudentActor()

  return (
    <Suspense
      fallback={
        <StudentFrame data={null} active="requests">
          <LoadingCard label="Загружаем заявки…" />
        </StudentFrame>
      }
    >
      <RequestsContent actor={actor} />
    </Suspense>
  )
}

// Читает данные экрана и рисует его. Внутри границы нет redirect(), notFound(), forbidden() и denyRecord().
async function RequestsContent({ actor }: { actor: Actor }) {
  const items = await listMyRequests(actor)
  return (
    <StudentShell actor={actor} active="requests">
      <PageTitle>Заявки</PageTitle>
      <div className="flex flex-col gap-[var(--gap)]">
        <section aria-label="Заказать" className="flex flex-col gap-[var(--sp-2)]">
          {REQUEST_KINDS.map((kind) => (
            <LinkButton key={kind} href={`/requests/new?type=${kind}`} variant="ghost" className="justify-start">
              {REQUEST_KIND_INFO[kind].title}
            </LinkButton>
          ))}
        </section>
        <h2 className="text-[length:var(--h2-size)] font-bold leading-tight text-[color:var(--h2-color)]">Мои заявки</h2>
        {items.length === 0 ? (
          <EmptyState level={3} title="Заявок пока нет" text="Выберите вид выше, чтобы подать первую" />
        ) : (
          <ul className="flex flex-col gap-[var(--gap)]">
            {items.map((r) => {
              const kind = isRequestKind(r.kind) ? r.kind : null
              const status = isRequestStatus(r.status) ? r.status : null
              const fieldLine = kind ? requestFieldLine(kind, r) : null
              return (
                <li key={r.id}>
                  {/* Карточка целиком — ссылка на Э-8 (зона касания не меньше --tap); рамка фокуса внутри карточки, отступ −3 px (раздел 5, «Общие правила»). */}
                  <Link
                    href={`/requests/${r.id}`}
                    className="flex min-h-[var(--tap)] items-start gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card active:bg-primary-soft focus-visible:-outline-offset-3"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                      {status ? <RequestStatusChip status={status} /> : <span className="text-[length:var(--fs-sm)] font-bold">{r.status}</span>}
                      <span className="text-[length:var(--fs-md)] font-bold leading-[1.3]">{kind ? REQUEST_KIND_INFO[kind].title : 'Заявка'}</span>
                      {fieldLine ? <span className="break-words text-[length:var(--fs-sm)] text-muted">{fieldLine}</span> : null}
                      <span className="text-[length:var(--fs-sm)] text-muted">Подана {formatDate(todayIn(getConfig().timezone, r.createdAt))}</span>
                      {kind && status ? (
                        <span className="text-[length:var(--fs-sm)]">
                          {statusText({
                            kind,
                            status,
                            dueDate: r.dueDate,
                            pickupUntil: r.pickupUntil,
                            issuedOn: r.issuedOn,
                            rejectReason: r.rejectReason,
                          })}
                        </span>
                      ) : null}
                    </span>
                    <RequestIcon name="chevron" className="mt-1 size-4 flex-none text-primary" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </StudentShell>
  )
}
