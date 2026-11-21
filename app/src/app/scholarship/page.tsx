import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { Chip } from '@/components/grades/chip'
import { GradeIcon } from '@/components/grades/icons'
import { LinkButton } from '@/components/link-button'
import { StudentShell } from '@/components/student-shell'
import { formatDayMonth, todayIn } from '@/lib/dates'
import { findItem, itemHref } from '@/lib/regulations/data'
import {
  PAYMENT_DAY,
  PREVIOUS_SESSION_END,
  SAMPLE_NOTE,
  SCHOLARSHIP_ORDER,
  TERM_END,
  buildPayouts,
  buildTodo,
  dayWithWeekday,
  describeStatus,
  evaluateScholarship,
  firstOfNextMonth,
  formatRub,
  nextSessionEnd,
  raisedQuestionHref,
  raisedWindow,
} from '@/lib/scholarship'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listMyGrades } from '@/server/dal/student'

// «Стипендия» (20.11): статус на текущий семестр по итогам прошлой сессии, выплаты, как получить повышенную, размеры по приказу.
// Всё считают чистые функции `lib/scholarship.ts` из оценок студента (`listMyGrades` слоя доступа: владелец — из сессии);
// отдельных таблиц и миграций нет. Суммы и даты вымышленные. Платежей, реквизитов и квитанций на странице нет.
// Читает страницу только студент: гость уходит на вход, сотрудник получает 403 (`requireStudentActor`).
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Стипендия' }

const LINK = 'inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-md)] font-bold text-primary'
const ROW = 'flex flex-wrap items-baseline justify-between gap-x-[var(--sp-3)] gap-y-0.5'

function PointLink({ num, label }: { num: string; label?: string }) {
  const item = findItem(num)
  return (
    <Link href={itemHref(num)} data-point={num} className={LINK}>
      {label ?? `п. ${num}${item ? `. ${item.title}` : ''}`}
    </Link>
  )
}

function Amount({ children }: { children: ReactNode }) {
  return <b className="text-[length:var(--fs-md)] font-extrabold tabular-nums">{children}</b>
}

export default async function ScholarshipPage() {
  const actor = await requireStudentActor()
  const today = todayIn(getConfig().timezone)
  const grades = await listMyGrades(actor, today)

  // Основы обучения в данных кабинета нет: считаем место бюджетным и говорим об этом на экране.
  const status = evaluateScholarship({ grades })
  const view = describeStatus(status)
  const sessionEnd = nextSessionEnd(grades, status.currentSemester)
  const assigned = status.kind === 'academic'
  const todo = buildTodo(status, { today, sessionEnd })
  const payFrom = firstOfNextMonth(PREVIOUS_SESSION_END)
  const payouts = buildPayouts({ payFrom, termEnd: TERM_END, today, amount: SCHOLARSHIP_ORDER.academic })
  const raised = raisedWindow(sessionEnd, today)

  return (
    <StudentShell actor={actor} active="scholarship">
      <div className="flex flex-col gap-[var(--gap)]">
        <div className="flex flex-col items-start gap-[var(--sp-1)]">
          <PageTitle>Стипендия</PageTitle>
          <p
            data-testid="scholarship-sample"
            className="m-0 w-fit rounded-pill bg-accent-2-bg px-2.5 py-1 text-[length:var(--fs-xs)] font-bold leading-[1.2] text-accent-2-text"
          >
            {SAMPLE_NOTE}
          </p>
        </div>

        <div className="flex flex-col gap-[var(--gap)] lg:grid lg:grid-cols-2 lg:items-start lg:gap-[var(--sp-5)]">
          {/* Слева: статус и выплаты (или «что сделать»). */}
          <div className="flex flex-col gap-[var(--gap)]">
            <Card>
              <div className="flex flex-col gap-[var(--sp-2)]" data-testid="scholarship-status" data-status={status.kind}>
                <CardTitle>{status.currentSemester ? `Статус на ${status.currentSemester} семестр` : 'Статус на семестр'}</CardTitle>
                <p className="m-0 flex items-start gap-[var(--sp-2)] text-[length:var(--fs-lg)] font-extrabold leading-[1.25]">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 grid size-7 flex-none place-items-center rounded-lg ${view.tone === 'ok' ? 'bg-success-bg text-success' : 'bg-error-bg text-error'}`}
                  >
                    <GradeIcon name={view.tone === 'ok' ? 'check' : 'x'} className="size-4" />
                  </span>
                  <span data-testid="scholarship-title" className="min-w-0 [overflow-wrap:anywhere]">
                    {view.title}
                  </span>
                </p>
                <p className="m-0 text-[length:var(--fs-md)] leading-[1.45]">{view.text}</p>
                <PointLink num={view.point} />
                <p className="m-0 text-[length:var(--fs-xs)] leading-[1.35] text-muted">
                  Основа обучения в кабинете не указана: считаем, что вы на бюджетном месте (п. 3.1).
                </p>
              </div>
            </Card>

            {assigned ? (
              <Card>
                <div className="flex flex-col gap-[var(--sp-2)]" data-testid="scholarship-payments">
                  <CardTitle>Выплаты</CardTitle>
                  <div className={ROW}>
                    <span className="text-[length:var(--fs-md)] text-muted">В месяц</span>
                    <Amount>
                      <span data-testid="scholarship-monthly">{formatRub(SCHOLARSHIP_ORDER.academic)}</span>
                    </Amount>
                  </div>
                  <div className={ROW}>
                    <span className="text-[length:var(--fs-md)] text-muted">Ближайшая выплата</span>
                    {payouts.next ? (
                      <b data-testid="scholarship-next" className="text-[length:var(--fs-md)] font-extrabold tabular-nums">
                        {dayWithWeekday(payouts.next.date)}
                      </b>
                    ) : (
                      <b data-testid="scholarship-next" className="text-[length:var(--fs-md)] font-bold">
                        Выплаты за семестр закончились
                      </b>
                    )}
                  </div>
                  <div className={ROW}>
                    <span className="text-[length:var(--fs-md)] text-muted">Получено за семестр</span>
                    <Amount>
                      <span data-testid="scholarship-total">{formatRub(payouts.paidTotal)}</span>
                    </Amount>
                  </div>
                  <h3 className="mb-0 mt-[var(--sp-2)] text-[length:var(--fs-md)] font-bold">История начислений</h3>
                  <ul data-testid="scholarship-history" className="m-0 flex list-none flex-col divide-y divide-border p-0">
                    {payouts.history.map((p) => (
                      <li key={p.month} data-state={p.state} className="flex flex-wrap items-center justify-between gap-x-[var(--sp-3)] gap-y-1 py-[var(--sp-2)]">
                        <span className="flex min-w-0 flex-col">
                          <b className="text-[length:var(--fs-md)] font-semibold">{p.label}</b>
                          <span className="text-[length:var(--fs-sm)] text-muted">
                            {p.state === 'paid' ? `Выплачено ${formatDayMonth(p.date)}` : `Выплата ${formatDayMonth(p.date)}`}
                          </span>
                        </span>
                        <span className="flex items-center gap-[var(--sp-2)]">
                          <Chip tone={p.state === 'paid' ? 'ok' : 'info'}>{p.state === 'paid' ? 'Выплачено' : 'Ожидается'}</Chip>
                          <Amount>{formatRub(p.amount)}</Amount>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 text-[length:var(--fs-sm)] leading-[1.4] text-muted">
                    Выплата — не позднее {PAYMENT_DAY} числа каждого месяца до конца семестра.
                  </p>
                  <PointLink num="3.7" />
                </div>
              </Card>
            ) : todo.length > 0 ? (
              <Card>
                <div className="flex flex-col gap-[var(--sp-2)]" data-testid="scholarship-todo">
                  <CardTitle>Что сделать, чтобы получать</CardTitle>
                  <ul className="m-0 flex list-none flex-col gap-[var(--sp-1)] p-0">
                    {todo.map((line) => (
                      <li key={line.text} className="text-[length:var(--fs-md)] leading-[1.4]">
                        {line.href ? (
                          <Link href={line.href} className="inline-flex min-h-[var(--tap)] items-center gap-1 font-bold text-primary [overflow-wrap:anywhere]">
                            {line.text}
                            <GradeIcon name="chevron" className="size-4 flex-none" />
                          </Link>
                        ) : (
                          line.text
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 text-[length:var(--fs-sm)] leading-[1.4] text-muted">Пока стипендия не назначена, выплат и истории начислений нет.</p>
                </div>
              </Card>
            ) : null}
          </div>

          {/* Справа: условия повышенной и размеры по приказу. */}
          <div className="flex flex-col gap-[var(--gap)]">
            <Card>
              <div className="flex flex-col gap-[var(--sp-2)]" data-testid="scholarship-raised">
                <CardTitle>Как получить повышенную</CardTitle>
                <p className="m-0 text-[length:var(--fs-md)] leading-[1.45]">
                  Повышенную назначает стипендиальная комиссия факультета дважды в год: по итогам осенней и весенней сессий.
                </p>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[length:var(--fs-md)] leading-[1.4]">
                  <li>Оценки «отлично» или достижения в науке, спорте, творчестве, общественной работе.</li>
                  <li>Заявление и портфолио — в деканат в течение 10 рабочих дней после последнего экзамена.</li>
                  <li>Решение комиссии — не позднее чем через 10 рабочих дней после окончания приёма.</li>
                </ul>
                {raised ? (
                  <p data-testid="scholarship-raised-deadline" className="m-0 text-[length:var(--fs-md)] leading-[1.4]">
                    <b className="font-extrabold">Подать заявление — до {formatDayMonth(raised.deadline)}.</b> Последний экзамен — {formatDayMonth(raised.lastExam)}, решение
                    комиссии — до {formatDayMonth(raised.decisionBy)}.
                  </p>
                ) : null}
                {status.excellent ? (
                  <p data-testid="scholarship-excellent" className="m-0 text-[length:var(--fs-md)] leading-[1.4]">
                    Все экзамены сессии {status.sessionSemester} семестра у вас сданы на «отлично»: по оценкам условие выполнено. Решение за комиссией.
                  </p>
                ) : null}
                <PointLink num="3.3" />
                <p className="m-0 text-[length:var(--fs-sm)] leading-[1.4] text-muted">
                  Отдельной заявки на повышенную стипендию в кабинете нет: заявление принимает деканат. Текст вопроса уже написан — останется выбрать тему «Стипендия
                  и оплата» и отправить.
                </p>
                <LinkButton href={raisedQuestionHref()} data-testid="scholarship-raised-apply">
                  Спросить деканат о заявлении
                </LinkButton>
              </div>
            </Card>

            <Card>
              <div className="flex flex-col gap-[var(--sp-2)]" data-testid="scholarship-sizes">
                <CardTitle>Размеры стипендий</CardTitle>
                <div className={ROW}>
                  <span className="text-[length:var(--fs-md)]">Академическая</span>
                  <Amount>{formatRub(SCHOLARSHIP_ORDER.academic)}</Amount>
                </div>
                <div className={ROW}>
                  <span className="text-[length:var(--fs-md)]">Повышенная</span>
                  <Amount>{formatRub(SCHOLARSHIP_ORDER.raised)}</Amount>
                </div>
                <div className={ROW}>
                  <span className="text-[length:var(--fs-md)]">Социальная</span>
                  <Amount>{formatRub(SCHOLARSHIP_ORDER.social)}</Amount>
                </div>
                <p className="m-0 text-[length:var(--fs-sm)] leading-[1.4] text-muted">
                  {SCHOLARSHIP_ORDER.title} {SCHOLARSHIP_ORDER.number} от {formatDayMonth(SCHOLARSHIP_ORDER.date)} {SCHOLARSHIP_ORDER.date.slice(0, 4)} года (вымышленный). В
                  положении размеров нет: их устанавливает приказ.
                </p>
                <PointLink num="3.1" />
                <PointLink num="3.4" label="п. 3.4. Как получить социальную" />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </StudentShell>
  )
}
