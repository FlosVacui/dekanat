import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { PageTitle } from '@/components/card'
import { StaffShell } from '@/components/staff-shell'
import { StudentShell } from '@/components/student-shell'
import { REG_SECTIONS, itemAnchor, itemsOfSection } from '@/lib/regulations/data'
import { getCurrentActor } from '@/server/auth/cookie'
import { getConfig } from '@/server/config'

// «Положение о студентах факультета» (20.11, помощник по положениям): весь вымышленный текст с якорями `#p-4-3`.
// Только для вошедших: студент видит его в своей оболочке, сотрудник — в своей, гость уходит на вход. Данных пользователя на странице нет.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Положение о студентах факультета' }

function Rules() {
  return (
    <div className="flex flex-col gap-[var(--gap)]">
      <PageTitle>Положение о студентах факультета</PageTitle>
      <p
        data-testid="rules-notice"
        className="m-0 rounded-surface border border-border bg-primary-soft p-[var(--card-pad)] text-[length:var(--fs-md)] font-bold leading-[1.4] text-primary"
      >
        Учебный пример для прототипа, не настоящий документ вуза
      </p>
      <nav aria-label="Разделы положения">
        <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
          {REG_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#s-${section.id}`}
                className="inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-md)] font-bold text-primary"
              >
                {section.id}. {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {REG_SECTIONS.map((section) => (
        <section key={section.id} id={`s-${section.id}`} aria-labelledby={`s-${section.id}-h`} className="flex scroll-mt-4 flex-col gap-[var(--sp-3)]">
          <h2 id={`s-${section.id}-h`} className="text-[length:var(--h2-size)] font-bold leading-tight text-[color:var(--h2-color)]">
            {section.id}. {section.title}
          </h2>
          {itemsOfSection(section.id).map((item) => (
            <article
              key={item.num}
              id={itemAnchor(item.num)}
              data-point={item.num}
              className="scroll-mt-4 rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card target:border-2 target:border-primary"
            >
              <h3 className="mb-[var(--sp-1)] text-[length:var(--fs-md)] font-bold leading-[1.3]">
                п. {item.num}. {item.title}
              </h3>
              <p className="m-0 text-[length:var(--fs-md)] leading-[1.45]">{item.text}</p>
            </article>
          ))}
        </section>
      ))}
      <p className="m-0">
        <Link href="/assistant" className="inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-md)] font-bold text-primary">
          Спросить помощника по этому положению
        </Link>
      </p>
    </div>
  )
}

export default async function RulesPage(): Promise<ReactNode> {
  const actor = await getCurrentActor()
  if (!actor) redirect('/login')
  if (actor.role === 'student') {
    return (
      <StudentShell actor={actor} active="assistant">
        <Rules />
      </StudentShell>
    )
  }
  return (
    <StaffShell juryMode={getConfig().juryMode}>
      <Rules />
    </StaffShell>
  )
}
