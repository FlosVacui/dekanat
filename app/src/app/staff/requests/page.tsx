import Link from 'next/link'
import { Suspense } from 'react'
import { PageTitle } from '@/components/card'
import { EmptyState } from '@/components/grades/empty-state'
import { QuestionStatusChip } from '@/components/questions/status-chip'
import { RequestIcon } from '@/components/requests/icons'
import { RequestStatusChip } from '@/components/requests/status-chip'
import { StaffShell } from '@/components/staff-shell'
import { BulkBar } from '@/components/staff/bulk-bar'
import { describeBulkResult } from '@/components/staff/bulk-result'
import { LoadingCard } from '@/components/states/loading-card'
import { formatDate, todayIn } from '@/lib/dates'
import { topicLabel } from '@/lib/questions'
import {
  REQUEST_KIND_INFO,
  REQUEST_STATUSES,
  STATUS_LABELS,
  isRequestKind,
  isRequestStatus,
  nextStatuses,
  overdueDays,
  overdueLabel,
  sortOverdueFirst,
  type RequestStatus,
} from '@/lib/requests'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { requireStaffActor } from '@/server/auth/page-guards'
import type { Actor } from '@/server/auth/session'
import { getConfig } from '@/server/config'
import { listCohortQuestions, listCohortRequests } from '@/server/dal/staff'
import { bulkStatusAction } from './actions'

// Э-11 «Заявки — сотрудник»: заявки студентов своего набора. Фильтр по статусу со счётчиками и поиск по ФИО студента —
// параметрами адреса `?status=` и `?q=`, обычные ссылки и форма GET: работают и без скриптов (шаг 2 JURY-3.10).
// Набор и так ограничен слоем доступа; фильтр отбирает из уже разрешённого списка.
// Пакет 4.1: фишка «Вопросы» (`?view=questions`) показывает вопросы студентов набора вместо заявок; поиск `?q=` работает и там.
export const dynamic = 'force-dynamic'

type Params = {
  status?: string | string[]
  q?: string | string[]
  view?: string | string[]
  // 20.11, деканат: исход пачки (см. components/staff/bulk-result.ts)
  bulk?: string | string[]
  done?: string | string[]
  skipped?: string | string[]
  why?: string | string[]
}

export default async function StaffRequestsPage({ searchParams }: { searchParams: Promise<Params> }) {
  // Вход проверяется выше границы ожидания: после начала потока отказ уже не получил бы код 307 или 403 (пакет 3.7).
  const actor = await requireStaffActor()

  return (
    <Suspense
      fallback={
        <StaffShell juryMode={getConfig().juryMode}>
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

/** Адрес вида: статус заявок или `view=questions`; поиск `q` переносится в любую фишку. */
function hrefFor(status: RequestStatus | 'questions' | null, q: string): string {
  const params = new URLSearchParams()
  if (status === 'questions') params.set('view', 'questions')
  else if (status) params.set('status', status)
  if (q) params.set('q', q)
  const query = params.toString()
  return query ? `/staff/requests?${query}` : '/staff/requests'
}

async function StaffRequestsContent({ actor, params }: { actor: Actor; params: Params }) {
  const [all, allQuestions] = await Promise.all([listCohortRequests(actor), listCohortQuestions(actor)])
  const tz = getConfig().timezone
  const questionsView = one(params.view) === 'questions'
  const rawStatus = one(params.status)
  const status = !questionsView && isRequestStatus(rawStatus) ? rawStatus : null
  const q = one(params.q).slice(0, 100)
  const needle = q.toLocaleLowerCase('ru')
  const found = needle ? all.filter((r) => r.studentName.toLocaleLowerCase('ru').includes(needle)) : all
  const foundQuestions = needle ? allQuestions.filter((r) => r.studentName.toLocaleLowerCase('ru').includes(needle)) : allQuestions
  const counts = new Map<RequestStatus, number>(REQUEST_STATUSES.map((s) => [s, found.filter((r) => r.status === s).length]))
  const filtered = status ? found.filter((r) => r.status === status) : found
  // Просрочка: у заявки «В работе» срок записан при взятии в работу (`dueDate`). Просроченные идут первыми.
  const today = todayIn(tz)
  const overdueById = new Map<string, number>()
  for (const r of filtered) {
    const days = overdueDays(r.dueDate, r.status, today)
    if (days > 0) overdueById.set(r.id, days)
  }
  const items = sortOverdueFirst(filtered, overdueById)
  const chips: { status: RequestStatus | 'questions' | null; label: string; count: number }[] = [
    { status: null, label: 'Все', count: found.length },
    ...REQUEST_STATUSES.map((s) => ({ status: s, label: STATUS_LABELS[s], count: counts.get(s) ?? 0 })),
    { status: 'questions', label: 'Вопросы', count: foundQuestions.length },
  ]
  const bulkResult = describeBulkResult(params)
  return (
    <StaffShell juryMode={getConfig().juryMode}>
      <PageTitle>Заявки студентов</PageTitle>
      {all.length === 0 && allQuestions.length === 0 ? (
        <EmptyState title="Заявок пока нет" text="Когда студенты подадут заявки, они появятся здесь" />
      ) : (
        <div className="flex flex-col gap-[var(--gap)]">
          {bulkResult ? (
            <p
              role="status"
              data-testid="bulk-result"
              className={cn('m-0 rounded-surface border-2 px-[var(--sp-4)] py-[var(--sp-3)] text-[length:var(--fs-md)] font-bold', bulkResult.ok ? 'border-success bg-success-bg text-success' : 'border-error bg-error-bg text-error')}
            >
              {bulkResult.text}
            </p>
          ) : null}
          <form action="/staff/requests" method="get" role="search" className="flex flex-col gap-[var(--sp-2)] sm:flex-row sm:items-end">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            {questionsView ? <input type="hidden" name="view" value="questions" /> : null}
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
                const active = c.status === 'questions' ? questionsView : !questionsView && c.status === status
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
          {questionsView ? (
            foundQuestions.length === 0 ? (
              <EmptyState title={allQuestions.length === 0 ? 'Вопросов пока нет' : 'Ничего не найдено'} />
            ) : (
              <ul className="flex flex-col gap-[var(--gap)] lg:grid lg:grid-cols-2">
                {foundQuestions.map((r) => (
                  <li key={r.id}>
                    {/* Карточка-ссылка, как у заявки: рамка фокуса внутри карточки, отступ −3 px. */}
                    <Link
                      href={`/staff/questions/${r.id}`}
                      className="flex min-h-[var(--tap)] items-start gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card active:bg-primary-soft focus-visible:-outline-offset-3"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                        <span className="text-[length:var(--fs-md)] font-bold leading-[1.3]">{r.studentName}</span>
                        <span className="text-[length:var(--fs-sm)] text-muted">Группа {r.groupName}</span>
                        <span className="text-[length:var(--fs-sm)]">{topicLabel(r.topic)}</span>
                        <span className="text-[length:var(--fs-sm)] text-muted">Отправлен {formatDate(todayIn(tz, r.createdAt))}</span>
                        <QuestionStatusChip status={r.status} />
                      </span>
                      <RequestIcon name="chevron" className="mt-1 size-4 flex-none text-primary" />
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : items.length === 0 ? (
            <EmptyState
              title="Ничего не найдено"
              text={q ? `Нет заявок студентов, в ФИО которых есть «${q}»${status ? `, со статусом «${STATUS_LABELS[status]}»` : ''}` : 'Заявок с таким статусом нет'}
            />
          ) : (
        <form id="bulk-form" action={bulkStatusAction} className="flex flex-col gap-[var(--gap)]">
          {/* 20.11, деканат: заявки пачкой. Фильтр и поиск возвращаются на страницу после действия. */}
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {q ? <input type="hidden" name="q" value={q} /> : null}
          <BulkBar formId="bulk-form" />
        <ul className="flex flex-col gap-[var(--gap)] lg:grid lg:grid-cols-2">
          {items.map((r) => (
            <li key={r.id} className="flex items-stretch gap-[var(--sp-2)]">
              {isRequestStatus(r.status) && nextStatuses(r.status).some((t) => t !== 'rejected') ? (
                <label className="flex min-w-[var(--tap)] flex-none items-start justify-center pt-[var(--card-pad)]">
                  <input
                    type="checkbox"
                    name="id"
                    value={r.id}
                    data-testid="bulk-check"
                    aria-label={`Отметить заявку: ${r.studentName}`}
                    className="size-6 accent-[var(--primary)]"
                  />
                </label>
              ) : (
                <span aria-hidden="true" className="min-w-[var(--tap)] flex-none" />
              )}
              {/* Карточка-ссылка: рамка фокуса внутри карточки, отступ −3 px. Текст «Статус: Подана» — одним узлом: по нему скрипт снимков находит заявку. */}
              <Link
                href={`/staff/requests/${r.id}`}
                className="flex min-h-[var(--tap)] min-w-0 flex-1 items-start gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card active:bg-primary-soft focus-visible:-outline-offset-3"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                  <span className="text-[length:var(--fs-md)] font-bold leading-[1.3]">{r.studentName}</span>
                  <span className="text-[length:var(--fs-sm)] text-muted">Группа {r.groupName}</span>
                  <span className="text-[length:var(--fs-sm)]">{isRequestKind(r.kind) ? REQUEST_KIND_INFO[r.kind].title : 'Заявка'}</span>
                  <span className="text-[length:var(--fs-sm)] text-muted">Подана {formatDate(todayIn(tz, r.createdAt))}</span>
                  {overdueById.has(r.id) ? (
                    <span
                      data-testid="overdue-mark"
                      className="inline-flex w-fit items-center rounded-pill bg-error-bg px-[var(--sp-3)] py-1 text-[length:var(--fs-sm)] font-extrabold text-error"
                    >
                      {overdueLabel(overdueById.get(r.id) ?? 0)}
                    </span>
                  ) : null}
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
        </form>
          )}
        </div>
      )}
    </StaffShell>
  )
}
