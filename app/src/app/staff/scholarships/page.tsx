import Link from 'next/link'
import { PageTitle } from '@/components/card'
import { EmptyState } from '@/components/grades/empty-state'
import { LinkButton } from '@/components/link-button'
import { StaffShell } from '@/components/staff-shell'
import { Button } from '@/components/ui/button'
import {
  SCHOLARSHIP_FILTERS,
  SCHOLARSHIP_FILTER_LABELS,
  filterScholarships,
  isRaisedCandidate,
  matchesScholarshipFilter,
  parseScholarshipFilter,
  scholarshipsHref,
} from '@/components/staff/scholarship-view'
import { describeStatus, formatRub } from '@/lib/scholarship'
import { cn } from '@/lib/utils'
import { requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listCohortScholarships } from '@/server/dal/staff'

// 20.11, деканат: «Стипендии». Таблица студентов своего набора: статус по тем же правилам, что у студента (`evaluateScholarship`),
// сумма и признак «условие повышенной по оценкам выполнено». Фильтр и поиск — параметры адреса `?show=` и `?q=`, форма GET: без скриптов.
// Набор берёт слой доступа из сессии; страница отбирает из уже разрешённого списка. Повышенную назначает комиссия, не страница.
export const dynamic = 'force-dynamic'

type Params = { show?: string | string[]; q?: string | string[] }

const SAMPLE = 'Суммы — пример для прототипа'

export default async function StaffScholarshipsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requireStaffActor()
  const params = await searchParams
  const filter = parseScholarshipFilter(params.show)
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q
  const q = (typeof rawQuery === 'string' ? rawQuery : '').trim().slice(0, 100)
  const all = await listCohortScholarships(actor)
  const searched = filterScholarships(all, 'all', q)
  const rows = filterScholarships(all, filter, q)
  const rowsView = rows.map((r) => ({ ...r, view: describeStatus(r.status), raised: isRaisedCandidate(r) }))
  const candidates = all.filter(isRaisedCandidate).length

  return (
    <StaffShell juryMode={getConfig().juryMode}>
      <PageTitle>Стипендии</PageTitle>
      <div className="flex flex-col gap-[var(--gap)]">
        <p className="m-0 max-w-[70ch] text-[length:var(--fs-sm)] leading-[1.4] text-muted">
          Статус считается по правилам положения (
          <Link href="/rules#p-3-2" className="font-bold text-primary">
            п. 3.2
          </Link>
          ) на оценках студента. Повышенную стипендию назначает комиссия (
          <Link href="/rules#p-3-3" className="font-bold text-primary">
            п. 3.3
          </Link>
          ): здесь отмечено только выполнение условия по оценкам. {SAMPLE}.
        </p>

        <form action="/staff/scholarships" method="get" role="search" className="flex flex-col gap-[var(--sp-2)] sm:flex-row sm:items-end">
          {filter !== 'all' ? <input type="hidden" name="show" value={filter} /> : null}
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

        <nav aria-label="Фильтр стипендий">
          <ul className="flex flex-wrap gap-[var(--sp-2)]">
            {SCHOLARSHIP_FILTERS.map((f) => {
              const active = f === filter
              const count = searched.filter((r) => matchesScholarshipFilter(r, f)).length
              return (
                <li key={f}>
                  <Link
                    href={scholarshipsHref(f, q)}
                    aria-current={active ? 'page' : undefined}
                    data-filter={f}
                    className={cn(
                      'inline-flex min-h-[var(--tap)] items-center gap-1.5 rounded-pill border-2 px-[var(--sp-3)] text-[length:var(--fs-sm)] font-bold',
                      active ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-card text-text',
                    )}
                  >
                    {SCHOLARSHIP_FILTER_LABELS[f]}
                    <span className={cn('rounded-pill px-1.5 text-[length:var(--fs-xs)]', active ? 'bg-card text-primary' : 'bg-primary-soft text-primary')}>{count}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div>
          <LinkButton href="/staff/scholarships/print" variant="ghost" data-testid="print-link">
            Печать: список кандидатов на повышенную
          </LinkButton>
          <p className="mt-[var(--sp-2)] text-[length:var(--fs-sm)] text-muted">Кандидатов по оценкам: {candidates}</p>
        </div>

        {rowsView.length === 0 ? (
          <EmptyState title="Ничего не найдено" text={all.length === 0 ? 'В наборе нет студентов' : 'Измените фильтр или поиск'} />
        ) : (
          <>
            <ul data-testid="sch-cards" className="flex flex-col gap-[var(--gap)] lg:hidden">
              {rowsView.map((r) => (
                <li
                  key={r.id}
                  data-testid="sch-card"
                  className="flex flex-col gap-[var(--sp-1)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card"
                >
                  <Link href={`/staff/students/${r.id}`} className="inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-md)] font-bold text-primary">
                    {r.fullName}
                  </Link>
                  <span className="text-[length:var(--fs-sm)] text-muted">Группа {r.groupName}</span>
                  <span className={cn('text-[length:var(--fs-md)] font-bold [overflow-wrap:anywhere]', r.view.tone === 'ok' ? 'text-success' : 'text-error')}>{r.view.title}</span>
                  <span className="text-[length:var(--fs-sm)]">Сумма: {r.amount > 0 ? `${formatRub(r.amount)} в месяц` : '—'}</span>
                  <span className="text-[length:var(--fs-sm)]">
                    Условие повышенной по оценкам: {r.raised ? <strong>выполнено</strong> : 'нет'}
                  </span>
                </li>
              ))}
            </ul>
            <div className="hidden lg:block">
              <table data-testid="sch-table" className="w-full border-collapse text-left text-[length:var(--fs-md)]">
                <caption className="sr-only">Стипендии студентов набора</caption>
                <thead>
                  <tr className="border-b-2 border-border-strong text-[length:var(--fs-sm)]">
                    <th scope="col" className="py-2 pr-3">Студент</th>
                    <th scope="col" className="py-2 pr-3">Группа</th>
                    <th scope="col" className="py-2 pr-3">Статус</th>
                    <th scope="col" className="py-2 pr-3">Сумма</th>
                    <th scope="col" className="py-2">Условие повышенной по оценкам</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsView.map((r) => (
                    <tr key={r.id} data-testid="sch-row" className="border-b border-border align-top">
                      <td className="py-2 pr-3">
                        <Link href={`/staff/students/${r.id}`} className="font-bold text-primary">
                          {r.fullName}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{r.groupName}</td>
                      <td className={cn('py-2 pr-3 font-bold', r.view.tone === 'ok' ? 'text-success' : 'text-error')}>{r.view.title}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{r.amount > 0 ? formatRub(r.amount) : '—'}</td>
                      <td className="py-2">{r.raised ? <strong>выполнено</strong> : 'нет'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </StaffShell>
  )
}
