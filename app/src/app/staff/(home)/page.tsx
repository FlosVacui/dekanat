import { Card, CardTitle, PageTitle } from '@/components/card'
import { StaffShell } from '@/components/staff-shell'
import { StatLink } from '@/components/staff/stat-link'
import { todayIn } from '@/lib/dates'
import { REQUEST_STATUSES, STATUS_LABELS } from '@/lib/requests'
import { requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getCohortSummary } from '@/server/dal/staff'

// Сводка сотрудника (20.11, блиц): заявки по статусам, просрочено, вопросы без ответа, объявления за неделю.
// У каждого числа — ссылка на список. Набор и числа — из слоя доступа; адрес вход не расширяет.
// Вход сотрудника по-прежнему ведёт на список заявок: сводка открывается из меню.
export const dynamic = 'force-dynamic'

export default async function StaffSummaryPage() {
  const actor = await requireStaffActor()
  const summary = await getCohortSummary(actor, todayIn(getConfig().timezone))
  return (
    <StaffShell juryMode={getConfig().juryMode}>
      <PageTitle>Сводка</PageTitle>
      <div className="flex flex-col gap-[var(--gap)] lg:grid lg:grid-cols-2 lg:items-start">
        <Card>
          <CardTitle>Заявки по статусам</CardTitle>
          <p className="mb-[var(--sp-2)] text-[length:var(--fs-sm)] text-muted">Всего заявок: {summary.total}</p>
          <ul className="flex flex-col">
            {REQUEST_STATUSES.map((status) => (
              <li key={status}>
                <StatLink href={`/staff/requests?status=${status}`} label={STATUS_LABELS[status]} value={summary.byStatus[status]} testId={`summary-${status}`} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Что требует внимания</CardTitle>
          <ul className="flex flex-col">
            <li>
              {/* Просроченные заявки — среди «В работе»; список ставит их первыми. */}
              <StatLink href="/staff/requests?status=in_progress" label="Просрочено" value={summary.overdue} alert testId="summary-overdue" />
            </li>
            <li>
              <StatLink href="/staff/requests?view=questions" label="Вопросы без ответа" value={summary.unanswered} alert testId="summary-unanswered" />
            </li>
            <li>
              <StatLink href="/staff/announcements" label="Объявления за неделю" value={summary.announcementsWeek} testId="summary-announcements" />
            </li>
          </ul>
        </Card>
      </div>
    </StaffShell>
  )
}
