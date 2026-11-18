import { PageTitle } from '@/components/card'
import { EmptyState } from '@/components/grades/empty-state'
import { SemesterView } from '@/components/grades/semester-view'
import { SessionView } from '@/components/grades/session-view'
import { Summary } from '@/components/grades/summary'
import { ViewSwitch, type GradesView } from '@/components/grades/view-switch'
import { StudentShell } from '@/components/student-shell'
import { todayIn } from '@/lib/dates'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listMyGrades } from '@/server/dal/student'

// Э-4 «Успеваемость» (пакет 3.3): блок «как у меня дела», виды «Семестр» и «Сессия», карточки ведут на Э-5 «Дисциплина».
// Вид — параметр адреса ?view=session; мусор в нём даёт «Семестр». «Семестр» — название вида, а не фильтр: показаны все дисциплины
// группы (долг и сданное лежат в прошлом семестре). Студент и группа — из сессии. Загрузка и ошибка — пакет 3.7.
export const dynamic = 'force-dynamic'

export default async function GradesPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const actor = await requireStudentActor()
  const { view: rawView } = await searchParams
  const view: GradesView = rawView === 'session' ? 'session' : 'semester'
  const today = todayIn(getConfig().timezone)
  const items = await listMyGrades(actor, today)
  return (
    <StudentShell actor={actor} active="grades">
      <PageTitle>Успеваемость</PageTitle>
      {items.length === 0 ? (
        <EmptyState title="Дисциплин пока нет" text="Когда деканат внесёт дисциплины вашей группы, здесь появятся баллы, зачёты и даты сессии." />
      ) : (
        <div className="flex flex-col gap-[var(--gap)]">
          <Summary items={items} today={today} />
          <ViewSwitch view={view} />
          {view === 'semester' ? <SemesterView items={items} today={today} /> : <SessionView items={items} today={today} />}
        </div>
      )}
    </StudentShell>
  )
}
