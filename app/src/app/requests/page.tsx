import Link from 'next/link'
import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'
import { StudentShell } from '@/components/student-shell'
import { formatDate, todayIn } from '@/lib/dates'
import {
  REQUEST_KINDS,
  REQUEST_KIND_INFO,
  STATUS_LABELS,
  isRequestKind,
  isRequestStatus,
  requestFieldLine,
  statusText,
} from '@/lib/requests'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listMyRequests } from '@/server/dal/student'

// Э-6 «Заявки»: сверху по кнопке на каждый вид (видов три, кнопки «Все виды» нет), ниже — мои заявки (S-2.1, раздел 3).
export const dynamic = 'force-dynamic'

export default async function RequestsPage() {
  const actor = await requireStudentActor()
  const items = await listMyRequests(actor)
  return (
    <StudentShell actor={actor} active="requests">
      <PageTitle>Заявки</PageTitle>
      <section aria-label="Заказать" className="mb-4 flex flex-col gap-2">
        {REQUEST_KINDS.map((kind) => (
          <LinkButton key={kind} href={`/requests/new?type=${kind}`} variant="secondary" className="justify-start">
            {REQUEST_KIND_INFO[kind].title}
          </LinkButton>
        ))}
      </section>
      <h2 className="mb-2 text-base font-semibold">Мои заявки</h2>
      {items.length === 0 ? (
        <Card>
          <p className="text-sm">Заявок пока нет. Выберите вид выше, чтобы подать первую</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => {
            const kind = isRequestKind(r.kind) ? r.kind : null
            const status = isRequestStatus(r.status) ? r.status : null
            const fieldLine = kind ? requestFieldLine(kind, r) : null
            return (
              <li key={r.id}>
                <Link href={`/requests/${r.id}`} className="block rounded-lg border border-neutral-300 bg-white p-4">
                  <span className="block text-base font-semibold">{kind ? REQUEST_KIND_INFO[kind].title : 'Заявка'}</span>
                  {fieldLine ? <span className="block break-words text-sm text-neutral-700">{fieldLine}</span> : null}
                  <span className="block text-sm text-neutral-700">
                    Подана {formatDate(todayIn(getConfig().timezone, r.createdAt))}
                  </span>
                  <span className="mt-1 block text-sm font-medium">Статус: {status ? STATUS_LABELS[status] : r.status}</span>
                  {kind && status ? (
                    <span className="block text-sm text-neutral-800">
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
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </StudentShell>
  )
}
