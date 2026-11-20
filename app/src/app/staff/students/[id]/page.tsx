import Link from 'next/link'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { QuestionStatusChip } from '@/components/questions/status-chip'
import { BackLink } from '@/components/requests/back-link'
import { RequestIcon } from '@/components/requests/icons'
import { RequestStatusChip } from '@/components/requests/status-chip'
import { StaffShell } from '@/components/staff-shell'
import { briefGrades } from '@/components/staff/grades-brief'
import { formatDate, todayIn } from '@/lib/dates'
import { formatAverage } from '@/lib/grades'
import { topicLabel } from '@/lib/questions'
import { REQUEST_KIND_INFO, isRequestKind, isRequestStatus } from '@/lib/requests'
import { denyRecord, requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getCohortStudent } from '@/server/dal/staff'

// Карточка студента для сотрудника (20.11, блиц): ФИО, курс, группа, краткая успеваемость, заявки и вопросы со ссылками.
// Студент ищется слоем доступа вместе с набором сотрудника; чужой набор и несуществующий номер — событие и 404, как у заявки.
export const dynamic = 'force-dynamic'

const rowLink =
  'flex min-h-[var(--tap)] items-start gap-[var(--sp-2)] rounded-control px-1 py-1.5 active:bg-primary-soft focus-visible:-outline-offset-3'

export default async function StaffStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor()
  const { id } = await params
  const student = await getCohortStudent(actor, id)
  if (!student) return denyRecord(actor)
  const tz = getConfig().timezone
  const brief = briefGrades(student.disciplines)
  return (
    <StaffShell juryMode={getConfig().juryMode}>
      <div className="flex flex-col gap-[var(--gap)]">
        <BackLink href="/staff/students">К списку студентов</BackLink>
        <PageTitle>{student.fullName}</PageTitle>
        <div className="flex flex-col gap-[var(--gap)] lg:grid lg:grid-cols-2 lg:items-start">
          <Card>
            <dl className="flex flex-col gap-[var(--sp-3)]">
              <div>
                <dt className="text-[length:var(--fs-sm)] text-muted">Группа</dt>
                <dd className="text-[length:var(--fs-md)] font-bold">{student.groupName}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--fs-sm)] text-muted">Курс</dt>
                <dd className="text-[length:var(--fs-md)]">{student.course}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--fs-sm)] text-muted">Факультет</dt>
                <dd className="text-[length:var(--fs-md)] [overflow-wrap:anywhere]">{student.faculty}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--fs-sm)] text-muted">Направление</dt>
                <dd className="text-[length:var(--fs-md)] [overflow-wrap:anywhere]">{student.programme}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardTitle>Успеваемость</CardTitle>
            {student.disciplines.length === 0 ? (
              <p className="text-[length:var(--fs-sm)] text-muted">Дисциплин у группы пока нет</p>
            ) : (
              <div className="flex flex-col gap-[var(--sp-3)] text-[length:var(--fs-md)]">
                <p data-testid="student-grades-line">
                  Сдано: {brief.summary.passed}. Долгов: {brief.summary.debt}. Впереди: {brief.summary.ahead}. Средняя оценка: {formatAverage(brief.summary.average)}
                </p>
                <div>
                  <h3 className="text-[length:var(--fs-sm)] font-bold">Долги</h3>
                  {brief.debts.length === 0 ? (
                    <p data-testid="student-debts" className="text-[length:var(--fs-sm)] text-muted">Долгов нет</p>
                  ) : (
                    <ul data-testid="student-debts" className="list-disc pl-5 text-[length:var(--fs-sm)]">
                      {brief.debts.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="text-[length:var(--fs-sm)] font-bold">До допуска</h3>
                  {brief.admission.length === 0 ? (
                    <p data-testid="student-admission" className="text-[length:var(--fs-sm)] text-muted">Допуск есть по всем дисциплинам впереди</p>
                  ) : (
                    <ul data-testid="student-admission" className="list-disc pl-5 text-[length:var(--fs-sm)]">
                      {brief.admission.map((a) => (
                        <li key={a.name}>
                          {a.name}: {a.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Заявки</CardTitle>
            {student.requests.length === 0 ? (
              <p className="text-[length:var(--fs-sm)] text-muted">Заявок нет</p>
            ) : (
              <ul className="flex flex-col">
                {student.requests.map((r) => (
                  <li key={r.id}>
                    <Link href={`/staff/requests/${r.id}`} className={rowLink}>
                      <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                        <span className="text-[length:var(--fs-md)] font-bold">{isRequestKind(r.kind) ? REQUEST_KIND_INFO[r.kind].title : 'Заявка'}</span>
                        <span className="text-[length:var(--fs-sm)] text-muted">Подана {formatDate(todayIn(tz, r.createdAt))}</span>
                        {isRequestStatus(r.status) ? <RequestStatusChip status={r.status} className="w-fit" /> : <span className="text-[length:var(--fs-sm)]">{r.status}</span>}
                      </span>
                      <RequestIcon name="chevron" className="mt-1 size-4 flex-none text-primary" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Вопросы</CardTitle>
            {student.questions.length === 0 ? (
              <p className="text-[length:var(--fs-sm)] text-muted">Вопросов нет</p>
            ) : (
              <ul className="flex flex-col">
                {student.questions.map((q) => (
                  <li key={q.id}>
                    <Link href={`/staff/questions/${q.id}`} className={rowLink}>
                      <span className="flex min-w-0 flex-1 flex-col gap-[var(--sp-1)]">
                        <span className="text-[length:var(--fs-md)] font-bold">{topicLabel(q.topic)}</span>
                        <span className="text-[length:var(--fs-sm)] text-muted">Отправлен {formatDate(todayIn(tz, q.createdAt))}</span>
                        <QuestionStatusChip status={q.status} className="w-fit" />
                      </span>
                      <RequestIcon name="chevron" className="mt-1 size-4 flex-none text-primary" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </StaffShell>
  )
}
