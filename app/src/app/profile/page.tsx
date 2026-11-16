import { Suspense } from 'react'
import { Card, PageTitle } from '@/components/card'
import { LoadingCard } from '@/components/states/loading-card'
import { StudentFrame } from '@/components/states/shell-parts'
import { StudentShell } from '@/components/student-shell'
import { SubmitButton } from '@/components/submit-button'
import { logoutAction } from '@/app/login/actions'
import { requireStudentActor } from '@/server/auth/page-guards'
import type { Actor } from '@/server/auth/session'
import { getMyProfile } from '@/server/dal/student'

// Э-10 «Профиль»: ФИО, факультет, направление, курс, группа; кнопка «Выйти» (ЯД-1).
export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  // Вход проверяется выше границы ожидания: после начала потока отказ уже не получил бы код 307 или 403 (пакет 3.7).
  const actor = await requireStudentActor()

  return (
    <Suspense
      fallback={
        <StudentFrame data={null} active={null}>
          <LoadingCard label="Загружаем профиль…" />
        </StudentFrame>
      }
    >
      <ProfileContent actor={actor} />
    </Suspense>
  )
}

// Читает данные экрана и рисует его. Внутри границы нет redirect(), notFound(), forbidden() и denyRecord().
async function ProfileContent({ actor }: { actor: Actor }) {
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
        <dl className="flex flex-col gap-[var(--sp-3)]">
          {rows.map(([name, value]) => (
            <div key={name}>
              <dt className="text-[length:var(--fs-sm)] text-muted">{name}</dt>
              <dd className="text-[length:var(--fs-md)] font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <form action={logoutAction} className="mt-[var(--gap)]">
        <SubmitButton variant="ghost" className="w-full">
          Выйти
        </SubmitButton>
      </form>
    </StudentShell>
  )
}
