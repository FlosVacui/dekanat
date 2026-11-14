import { DisciplineView } from '@/components/grades/discipline-view'
import { StudentShell } from '@/components/student-shell'
import { todayIn } from '@/lib/dates'
import { denyRecord, requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getMyDiscipline } from '@/server/dal/student'

// Э-5 «Дисциплина» (пакет 3.3): адрес /grades/<номер дисциплины>. Данные — только через getMyDiscipline.
// Номер в адресе — только номер дисциплины; студента и группу сервер берёт из сессии. Чужая дисциплина, несуществующий номер
// и мусор вместо номера дают один ответ: 404 и страница «Нет такой дисциплины» (ADR-0002). Событие пишет denyRecord.
export const dynamic = 'force-dynamic'

export default async function DisciplinePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStudentActor()
  const { id } = await params
  const item = await getMyDiscipline(actor, id)
  if (!item) return denyRecord(actor)
  const today = todayIn(getConfig().timezone)
  return (
    <StudentShell actor={actor} active="grades">
      <DisciplineView item={item} today={today} />
    </StudentShell>
  )
}
