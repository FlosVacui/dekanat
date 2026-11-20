import Link from 'next/link'
import { PageTitle } from '@/components/card'
import { EmptyState } from '@/components/grades/empty-state'
import { RequestIcon } from '@/components/requests/icons'
import { SelectField } from '@/components/requests/select-field'
import { StaffShell } from '@/components/staff-shell'
import { filterStudents, oneParam } from '@/components/staff/students-filter'
import { Button } from '@/components/ui/button'
import { requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listCohortStudents } from '@/server/dal/staff'

// Студенты набора (20.11, блиц): список, поиск по ФИО `?q=` и фильтр по группе `?group=` — параметры адреса, форма GET, работает без скриптов.
// Набор — из сессии, в слое доступа; поиск и группа отбирают из уже разрешённого списка.
export const dynamic = 'force-dynamic'

type Params = { q?: string | string[]; group?: string | string[] }

export default async function StaffStudentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requireStaffActor()
  const params = await searchParams
  const all = await listCohortStudents(actor)
  const q = oneParam(params.q).slice(0, 100)
  const groups = [...new Map(all.map((s) => [s.groupId, s.groupName])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'))
  const group = oneParam(params.group)
  const items = filterStudents(all, q, group, groups.map(([id]) => id))
  const activeGroup = groups.some(([id]) => id === group) ? group : ''
  return (
    <StaffShell juryMode={getConfig().juryMode}>
      <PageTitle>Студенты</PageTitle>
      {all.length === 0 ? (
        <EmptyState title="Студентов пока нет" text="Когда в наборе появятся студенты, они будут здесь" />
      ) : (
        <div className="flex flex-col gap-[var(--gap)]">
          <form action="/staff/students" method="get" role="search" className="flex flex-col gap-[var(--sp-2)] sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1.5 text-[length:var(--fs-sm)] font-bold">
              Поиск по ФИО
              <input
                name="q"
                type="search"
                defaultValue={q}
                maxLength={100}
                autoComplete="off"
                className="min-h-[var(--control-h)] w-full rounded-control border-2 border-border-strong bg-card px-[var(--sp-4)] text-[length:var(--fs-md)] font-normal text-text focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
              />
            </label>
            <div className="sm:w-64">
              <SelectField id="students-group" name="group" label="Группа" defaultValue={activeGroup}>
                <option value="">Все группы</option>
                {groups.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </SelectField>
            </div>
            <Button type="submit">Показать</Button>
          </form>
          <p role="status" className="text-[length:var(--fs-sm)] text-muted">
            Найдено: {items.length} из {all.length}
          </p>
          {items.length === 0 ? (
            <EmptyState title="Ничего не найдено" text="Измените поиск или выберите другую группу" />
          ) : (
            <ul className="flex flex-col gap-[var(--gap)] lg:grid lg:grid-cols-2">
              {items.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/staff/students/${s.id}`}
                    className="flex min-h-[var(--tap)] items-start gap-[var(--sp-2)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card active:bg-primary-soft focus-visible:-outline-offset-3"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                      <span className="text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]">{s.fullName}</span>
                      <span className="text-[length:var(--fs-sm)] text-muted">
                        Группа {s.groupName}, {s.course} курс
                      </span>
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
