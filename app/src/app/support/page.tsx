import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { StaffShell } from '@/components/staff-shell'
import { StudentShell } from '@/components/student-shell'
import { findItem, itemHref } from '@/lib/regulations/data'
import { HARDSHIP_POINTS, PSYCH_SERVICE } from '@/lib/support/data'
import { getCurrentActor } from '@/server/auth/cookie'
import { getConfig } from '@/server/config'
import { CrisisNumbers } from './crisis-numbers'

// «Поддержка» (20.11): психологическая служба факультета (вымышленная), номера помощи и пункты положения о трудном периоде.
// Только для вошедших, как `/rules`: студент видит страницу в своей оболочке, сотрудник — в своей, гость уходит на вход.
// Данных пользователя страница не читает и не пишет: ни счётчиков, ни журнала, ни записи через заявки. Форм на ней нет.
// Номера — только из `lib/support/data.ts`.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Поддержка' }

function Support() {
  return (
    <div className="flex flex-col gap-[var(--gap)]">
      <PageTitle>Поддержка</PageTitle>

      <Card>
        <div className="flex flex-col gap-[var(--sp-2)]" data-testid="support-psych">
          <CardTitle>{PSYCH_SERVICE.title}</CardTitle>
          <p
            data-testid="support-sample"
            className="m-0 w-fit rounded-pill bg-accent-2-bg px-2.5 py-1 text-[length:var(--fs-xs)] font-bold leading-[1.2] text-accent-2-text"
          >
            {PSYCH_SERVICE.sample}
          </p>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-[var(--sp-3)] gap-y-1 text-[length:var(--fs-md)] leading-[1.4]">
            <dt className="text-muted">Кабинет</dt>
            <dd className="m-0">{PSYCH_SERVICE.room}</dd>
            <dt className="text-muted">Часы приёма</dt>
            <dd className="m-0">{PSYCH_SERVICE.hours}</dd>
            <dt className="text-muted">Телефон</dt>
            <dd className="m-0">{PSYCH_SERVICE.phone}</dd>
            <dt className="text-muted">Почта</dt>
            <dd className="m-0 [overflow-wrap:anywhere]">{PSYCH_SERVICE.email}</dd>
          </dl>
          <p data-testid="support-privacy" className="m-0 text-[length:var(--fs-md)] font-bold leading-[1.4]">
            {PSYCH_SERVICE.privacy}
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-[var(--sp-2)]" data-testid="support-now">
          <CardTitle>Если плохо прямо сейчас</CardTitle>
          <CrisisNumbers />
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-[var(--sp-2)]" data-testid="support-study">
          <CardTitle>Учёба в трудный период</CardTitle>
          <p className="m-0 text-[length:var(--fs-md)] leading-[1.45]">Что говорит о таких случаях положение о студентах (учебный пример для прототипа):</p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {HARDSHIP_POINTS.map((num) => {
              const item = findItem(num)
              if (!item) return null
              return (
                <li key={num}>
                  <Link href={itemHref(num)} data-point={num} className="inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-md)] font-bold text-primary">
                    п. {num}. {item.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </Card>
    </div>
  )
}

export default async function SupportPage(): Promise<ReactNode> {
  const actor = await getCurrentActor()
  if (!actor) redirect('/login')
  if (actor.role === 'student') {
    return (
      <StudentShell actor={actor} active="support">
        <Support />
      </StudentShell>
    )
  }
  return (
    <StaffShell juryMode={getConfig().juryMode}>
      <Support />
    </StaffShell>
  )
}
