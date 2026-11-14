import { Card, PageTitle } from '@/components/card'
import { StudentShell } from '@/components/student-shell'
import { SubmitButton } from '@/components/submit-button'
import { logoutAction } from '@/app/login/actions'
import { requireStudentActor } from '@/server/auth/page-guards'
import { getMyProfile } from '@/server/dal/student'

// Э-10 «Профиль»: ФИО, факультет, направление, курс, группа; кнопка «Выйти» (ЯД-1).
export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const actor = await requireStudentActor()
  const profile = await getMyProfile(actor)
  if (!profile) throw new Error('Профиль студента не найден')
  const rows: [string, string][] = [
    ['ФИО', profile.fullName],
    ['Факультет', profile.faculty],
    ['Направление', profile.programme],
    ['Курс', String(profile.course)],
    ['Группа', profile.groupName],
  ]
  return (
    <StudentShell actor={actor} active={null}>
      <PageTitle>Профиль</PageTitle>
      <Card>
        <dl className="flex flex-col gap-3 text-sm">
          {rows.map(([name, value]) => (
            <div key={name}>
              <dt className="text-neutral-700">{name}</dt>
              <dd className="text-base font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <form action={logoutAction} className="mt-4">
        <SubmitButton variant="ghost" className="w-full">
          Выйти
        </SubmitButton>
      </form>
    </StudentShell>
  )
}
