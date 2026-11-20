import Link from 'next/link'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { RequestIcon } from '@/components/requests/icons'
import { RequestStatusChip } from '@/components/requests/status-chip'
import { StaffShell } from '@/components/staff-shell'
import { StatLink } from '@/components/staff/stat-link'
import { formatDate, todayIn } from '@/lib/dates'
import { topicLabel } from '@/lib/questions'
import { REQUEST_KIND_INFO, REQUEST_STATUSES, STATUS_LABELS, isRequestKind, isRequestStatus } from '@/lib/requests'
import { aiEnabled } from '@/server/ai'
import { requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getCohortSummary, listCohortRequests, listCohortUnansweredQuestions } from '@/server/dal/staff'
import { weekSummaryAction } from './actions'
import { WeekSummary } from './week-summary'

// Сводка сотрудника (20.11, блиц): заявки по статусам, просрочено, вопросы без ответа, объявления за неделю.
// У каждого числа — ссылка на список. Набор и числа — из слоя доступа; адрес вход не расширяет.
// Шлифовка 20.11: от 1024 px ниже двух карточек — «Последние заявки» (5) и «Вопросы без ответа» (до 5); на телефоне всё столбцом.
// Вход сотрудника по-прежнему ведёт на список заявок: сводка открывается из меню.
export const dynamic = 'force-dynamic'

const RECENT_REQUESTS = 5

// Строка-ссылка: вся строка нажимается, зона касания не ниже --tap, рамка фокуса внутри строки.
const ROW_LINK =
  'flex min-h-[var(--tap)] items-start gap-[var(--sp-2)] rounded-control px-1 py-[var(--sp-2)] active:bg-primary-soft focus-visible:-outline-offset-3'

export default async function StaffSummaryPage() {
  const actor = await requireStaffActor()
  const tz = getConfig().timezone
  const [summary, allRequests, unanswered] = await Promise.all([
    getCohortSummary(actor, todayIn(tz)),
    listCohortRequests(actor),
    listCohortUnansweredQuestions(actor),
  ])
  // Список слоя идёт от новых к старым: берутся пять первых.
  const recent = allRequests.slice(0, RECENT_REQUESTS)
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
        {/* 20.11: без ключа модели карточки нет. */}
        {aiEnabled() ? (
          <div className="lg:col-span-2">
            <WeekSummary action={weekSummaryAction} />
          </div>
        ) : null}
        <Card>
          <CardTitle>Последние заявки</CardTitle>
          {recent.length === 0 ? (
            <p className="text-[length:var(--fs-sm)] text-muted">Заявок пока нет.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border" data-testid="summary-recent-requests">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link href={`/staff/requests/${r.id}`} className={ROW_LINK}>
                    <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                      <span className="text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]">{r.studentName}</span>
                      <span className="text-[length:var(--fs-sm)]">{isRequestKind(r.kind) ? REQUEST_KIND_INFO[r.kind].title : 'Заявка'}</span>
                      <span className="text-[length:var(--fs-sm)] text-muted">Подана {formatDate(todayIn(tz, r.createdAt))}</span>
                      {isRequestStatus(r.status) ? (
                        <RequestStatusChip status={r.status} label={`Статус: ${STATUS_LABELS[r.status]}`} className="w-fit" />
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
        </Card>
        <Card>
          <CardTitle>Вопросы без ответа</CardTitle>
          {unanswered.length === 0 ? (
            <p className="text-[length:var(--fs-sm)] text-muted">Вопросов без ответа нет.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border" data-testid="summary-unanswered-questions">
              {unanswered.map((q) => (
                <li key={q.id}>
                  <Link href={`/staff/questions/${q.id}`} className={ROW_LINK}>
                    <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                      <span className="text-[length:var(--fs-md)] font-bold leading-[1.3] [overflow-wrap:anywhere]">{q.studentName}</span>
                      <span className="text-[length:var(--fs-sm)] font-bold">{topicLabel(q.topic)}</span>
                      <span className="line-clamp-2 text-[length:var(--fs-sm)] [overflow-wrap:anywhere]">{q.excerpt}</span>
                      <span className="text-[length:var(--fs-sm)] text-muted">Отправлен {formatDate(todayIn(tz, q.createdAt))}</span>
                    </span>
                    <RequestIcon name="chevron" className="mt-1 size-4 flex-none text-primary" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </StaffShell>
  )
}
