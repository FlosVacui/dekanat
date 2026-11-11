import Link from 'next/link'
import { Card, PageTitle } from '@/components/card'
import { StudentShell } from '@/components/student-shell'
import { formatDate, todayIn } from '@/lib/dates'
import { formatAverage, summarizeGrades } from '@/lib/grades'
import { controlKindLabel, outcomeLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listMyGrades, type GradeItem } from '@/server/dal/student'

// Э-4 «Успеваемость». Вид «Семестр» — полностью, вид «Сессия» — заготовка (полный экран — пакет 3.3).
// Карточка дисциплины — не ссылка: экран «Дисциплина» делается в пакете 3.3.
export const dynamic = 'force-dynamic'

type View = 'semester' | 'session'

function ViewSwitch({ view }: { view: View }) {
  const base = 'inline-flex min-h-11 flex-1 items-center justify-center rounded text-sm font-medium'
  return (
    <div role="group" aria-label="Вид" className="mb-3 flex gap-1 rounded border border-neutral-400 bg-white p-1">
      <Link
        href="/grades"
        aria-current={view === 'semester' ? 'true' : undefined}
        className={cn(base, view === 'semester' ? 'bg-blue-700 text-white' : 'text-neutral-900')}
      >
        Семестр
      </Link>
      <Link
        href="/grades?view=session"
        aria-current={view === 'session' ? 'true' : undefined}
        className={cn(base, view === 'session' ? 'bg-blue-700 text-white' : 'text-neutral-900')}
      >
        Сессия
      </Link>
    </div>
  )
}

function Summary({ items }: { items: GradeItem[] }) {
  const s = summarizeGrades(items)
  return (
    <Card className="mb-3">
      <h2 className="mb-2 text-base font-semibold">Как у меня дела</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col">
          <dt className="text-neutral-700">Сдано</dt>
          <dd className="text-lg font-semibold">{s.passed}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-neutral-700">Долг</dt>
          <dd className="text-lg font-semibold">{s.debt}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-neutral-700">Впереди</dt>
          <dd className="text-lg font-semibold">{s.ahead}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-neutral-700">Средний балл</dt>
          <dd className="text-lg font-semibold">{formatAverage(s.average)}</dd>
        </div>
      </dl>
    </Card>
  )
}

function SemesterView({ items }: { items: GradeItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((g) => (
        <li key={g.disciplineId}>
          <Card>
            <h3 className="text-base font-semibold">{g.name}</h3>
            <div className="text-sm text-neutral-800">
              {controlKindLabel(g.controlKind)}
              <br />
              Баллы за семестр: {g.points ?? '—'}
            </div>
            <p className="mt-1 text-sm font-medium">Итог: {outcomeLabel(g.outcome)}</p>
            {g.nextDue ? (
              <p className="mt-1 text-sm text-neutral-800">
                Ближайшая работа: {g.nextDue.title}, до {formatDate(g.nextDue.dueDate)}
              </p>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  )
}

function SessionRow({ g, showOutcome }: { g: GradeItem; showOutcome: boolean }) {
  return (
    <li>
      <Card>
        <h3 className="text-base font-semibold">{g.name}</h3>
        <div className="text-sm text-neutral-800">
          {controlKindLabel(g.controlKind)}, {g.examDate ? formatDate(g.examDate) : 'дата не назначена'}
          {g.examTime ? `, ${g.examTime}` : ''}
          {g.examRoom ? (
            <>
              <br />
              Аудитория: {g.examRoom}
            </>
          ) : null}
        </div>
        <p className="mt-1 text-sm font-medium">
          {showOutcome ? `Итог: ${outcomeLabel(g.outcome)}` : g.admitted ? 'Допущен' : 'Не допущен'}
        </p>
      </Card>
    </li>
  )
}

function SessionView({ items, today }: { items: GradeItem[]; today: string }) {
  const withDate = items.filter((g) => g.examDate)
  const next = withDate
    .filter((g) => (g.examDate ?? '') >= today)
    .sort((a, b) => (a.examDate ?? '').localeCompare(b.examDate ?? ''))
  const past = withDate
    .filter((g) => (g.examDate ?? '') < today)
    .sort((a, b) => (b.examDate ?? '').localeCompare(a.examDate ?? ''))
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h2 className="mb-2 text-base font-semibold">Экзамены и зачёты по датам</h2>
        {next.length === 0 ? (
          <Card>
            <p className="text-sm">Экзаменов и зачётов впереди нет</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {next.map((g) => (
              <SessionRow key={g.disciplineId} g={g} showOutcome={false} />
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-base font-semibold">Итоги прошлой сессии</h2>
        {past.length === 0 ? (
          <Card>
            <p className="text-sm">Итогов пока нет</p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {past.map((g) => (
              <SessionRow key={g.disciplineId} g={g} showOutcome />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default async function GradesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const actor = await requireStudentActor()
  const { view: rawView } = await searchParams
  const view: View = rawView === 'session' ? 'session' : 'semester'
  const today = todayIn(getConfig().timezone)
  const items = await listMyGrades(actor, today)
  return (
    <StudentShell actor={actor} active="grades">
      <PageTitle>Успеваемость</PageTitle>
      <Summary items={items} />
      <ViewSwitch view={view} />
      {items.length === 0 ? (
        <Card>
          <p className="text-sm">Дисциплин пока нет</p>
        </Card>
      ) : view === 'semester' ? (
        <SemesterView items={items} />
      ) : (
        <SessionView items={items} today={today} />
      )}
    </StudentShell>
  )
}
