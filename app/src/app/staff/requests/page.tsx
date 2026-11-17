import Link from 'next/link'
import { Suspense } from 'react'
import { PageTitle } from '@/components/card'
import { EmptyState } from '@/components/grades/empty-state'
import { RequestIcon } from '@/components/requests/icons'
import { RequestStatusChip } from '@/components/requests/status-chip'
import { StaffShell } from '@/components/staff-shell'
import { LoadingCard } from '@/components/states/loading-card'
import { formatDate, todayIn } from '@/lib/dates'
import { REQUEST_KIND_INFO, REQUEST_STATUSES, STATUS_LABELS, isRequestKind, isRequestStatus, type RequestStatus } from '@/lib/requests'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { requireStaffActor } from '@/server/auth/page-guards'
import type { Actor } from '@/server/auth/session'
import { getConfig } from '@/server/config'
import { listCohortRequests } from '@/server/dal/staff'

// Э-11 «Заявки — сотрудник»: заявки студентов своего набора. Фильтр по статусу со счётчиками и поиск по ФИО студента —
// параметрами адреса `?status=` и `?q=`, обычные ссылки и форма GET: работают и без скриптов (шаг 2 JURY-3.10).
// Набор и так ограничен слоем доступа; фильтр отбирает из уже разрешённого списка.
export const dynamic = 'force-dynamic'

type Params = { status?: string | string[]; q?: string | string[] }

export default async function StaffRequestsPage({ searchParams }: { searchParams: Promise<Params> }) {
  // Вход проверяется выше границы ожидания: после начала потока отказ уже не получил бы код 307 или 403 (пакет 3.7).
  const actor = await requireStaffActor()

  return (
    <Suspense
      fallback={
        <StaffShell>
          <LoadingCard label="Загружаем заявки…" />
        </StaffShell>
      }
    >
      <StaffRequestsContent actor={actor} params={await searchParams} />
    </Suspense>
  )
}

// Читает данные экрана и рисует его. Внутри границы нет redirect(), notFound(), forbidden() и denyRecord().
/** Одно значение параметра адреса: массив и пустое — как «нет». */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

function hrefFor(status: RequestStatus | null, q: string): string {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (q) params.set('q', q)
  const query = params.toString()
  return query ? `/staff/requests?${query}` : '/staff/requests'
}

async function StaffRequestsContent({ actor, params }: { actor: Actor; params: Params }) {
  const all = await listCohortRequests(actor)
  const tz = getConfig().timezone
  const rawStatus = one(params.status)
  const status = isRequestStatus(rawStatus) ? rawStatus : null
  const q = one(params.q).slice(0, 100)
  const needle = q.toLocaleLowerCase('ru')
  const found = needle ? all.filter((r) => r.studentName.toLocaleLowerCase('ru').includes(needle)) : all
  const counts = new Map<RequestStatus, number>(REQUEST_STATUSES.map((s) => [s, found.filter((r) => r.status === s).length]))
  const items = status ? found.filter((r) => r.status === status) : found
  const chips: { status: RequestStatus | null; label: string; count: number }[] = [
    { status: null, label: 'Все', count: found.length },
    ...REQUEST_STATUSES.map((s) => ({ status: s, label: STATUS_LABELS[s], count: counts.get(s) ?? 0 })),
  ]
  return (
    <StaffShell>
      <PageTitle>Заявки студентов</PageTitle>
      {all.length === 0 ? (
        <EmptyState title="Заявок пока нет" text="Когда студенты подадут заявки, они появятся здесь" />
      ) : (
        <div className="flex flex-col gap-[var(--gap)]">
          <form action="/staff/requests" method="get" role="search" className="flex flex-col gap-[var(--sp-2)] sm:flex-row sm:items-end">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <label className="flex flex-1 flex-col gap-1.5 text-[length:var(--fs-sm)] font-bold">
              Поиск по ФИО студента
              <input
                name="q"
                type="search"
                defaultValue={q}
                maxLength={100}
                autoComplete="off"
                className="min-h-[var(--control-h)] w-full rounded-control border-2 border-border-strong bg-card px-[var(--sp-4)] text-[length:var(--fs-md)] font-normal text-text focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
              />
            </label>
            <Button type="submit">Найти</Button>
          </form>
          <nav aria-label="Фильтр по статусу">
            <ul className="flex flex-wrap gap-[var(--sp-2)]">
              {chips.map((c) => {
                const active = c.status === status
                return (
                  <li key={c.status ?? 'all'}>
                    <Link
                      href={hrefFor(c.status, q)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'inline-flex min-h-[var(--tap)] items-center gap-1.5 rounded-pill border-2 px-[var(--sp-3)] text-[length:var(--fs-sm)] font-bold',
                        active ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-card text-text',
                      )}
                    >
                      {c.label}
                      <span className={cn('rounded-pill px-1.5 text-[length:var(--fs-xs)]', active ? 'bg-card text-primary' : 'bg-primary-soft text-primary')}>
                        {c.count}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
          {items.length === 0 ? (
            <EmptyState
              title="Ничего не найдено"
              text={q ? `Нет заявок студентов, в ФИО которых есть «${q}»${status ? `, со статусом «${STATUS_LABELS[status]}»` : ''}` : 'Заявок с таким статусом нет'}
            />
          ) : (
        <ul className="flex flex-col gap-[var(--gap)] lg:grid lg:grid-cols-2">
          {items.map((r) => (
            <li key={r.id}>
              {/* Карточка-ссылка: рамка фокуса внутри карточки, отступ −3 px. Текст «Статус: Подана» — одним узлом: по нему скрипт снимков находит заявку. */}
              <Link
                href={`/staff/requests/${r.id}`}
                className="flex min-h-[var(--tap)] items-start gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card active:bg-primary-soft focus-visible:-outline-offset-3"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                  <span className="text-[length:var(--fs-md)] font-bold leading-[1.3]">{r.studentName}</span>
                  <span className="text-[length:var(--fs-sm)] text-muted">Группа {r.groupName}</span>
                  <span className="text-[length:var(--fs-sm)]">{isRequestKind(r.kind) ? REQUEST_KIND_INFO[r.kind].title : 'Заявка'}</span>
                  <span className="text-[length:var(--fs-sm)] text-muted">Подана {formatDate(todayIn(tz, r.createdAt))}</span>
                  {isRequestStatus(r.status) ? (
                    <RequestStatusChip status={r.status} label={`Статус: ${STATUS_LABELS[r.status]}`} />
                  ) : (
                    <span className="text-[length:var(--fs-sm)] font-bold">Статус: {r.status}</span>
                  )}
                </span>
                <RequestIcon name="chevron" className="mt-1 size-4 flex-none text-primary" />
              </Link>
            </li>
          ))}
        </ul>
          )}
        </div>
      )}
    </StaffShell>
  )
}
