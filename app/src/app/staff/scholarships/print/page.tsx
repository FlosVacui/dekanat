import type { Metadata } from 'next'
import Link from 'next/link'
import { PrintButton } from '@/components/requests/print-button'
import { isRaisedCandidate } from '@/components/staff/scholarship-view'
import { formatDate, todayIn } from '@/lib/dates'
import { requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { listCohortScholarships } from '@/server/dal/staff'

// 20.11, деканат: печатная страница «Список кандидатов на повышенную стипендию». Только студенты своего набора, у которых выполнено
// условие по оценкам (п. 3.3). Это проект списка для комиссии, а не приказ: подписей, печатей и реквизитов в нём нет.
// Кнопка «Печать» открывает диалог браузера (`window.print()`); панель с кнопкой и ссылкой при печати скрыта (`print:hidden`).
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Проект списка для стипендиальной комиссии' }

export default async function StaffScholarshipPrintPage() {
  const actor = await requireStaffActor()
  const all = await listCohortScholarships(actor)
  const candidates = all.filter(isRaisedCandidate).sort((a, b) => a.groupName.localeCompare(b.groupName, 'ru') || a.fullName.localeCompare(b.fullName, 'ru'))
  const today = formatDate(todayIn(getConfig().timezone))
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-[var(--gap)] bg-card px-[var(--pad-x)] py-[var(--sp-4)] text-text print:max-w-none print:bg-white print:p-0 print:text-black">
      <div className="flex flex-wrap items-center gap-[var(--sp-3)] print:hidden">
        <Link href="/staff/scholarships" className="inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-sm)] font-bold text-primary">
          К списку стипендий
        </Link>
        <PrintButton>Печать</PrintButton>
      </div>
      <header className="flex flex-col gap-1">
        <h1 data-testid="print-title" className="m-0 text-[length:var(--h1-size)] font-bold leading-[1.15]">
          Проект списка для стипендиальной комиссии · пример для прототипа
        </h1>
        <p className="m-0 text-[length:var(--fs-md)]">Кандидаты на повышенную академическую стипендию. Дата: {today}</p>
        <p className="m-0 text-[length:var(--fs-sm)] text-muted print:text-black">
          Условие по оценкам (п. 3.3 положения): стипендия назначена, все экзамены прошлой сессии сданы на «5». Решение принимает комиссия.
        </p>
      </header>
      {candidates.length === 0 ? (
        <p data-testid="print-empty" className="m-0 text-[length:var(--fs-md)]">В наборе нет студентов, у которых выполнено условие по оценкам.</p>
      ) : (
        <table data-testid="print-table" className="w-full border-collapse text-left text-[length:var(--fs-md)]">
          <thead>
            <tr className="border-b-2 border-black text-[length:var(--fs-sm)]">
              <th scope="col" className="w-10 py-2 pr-3">№</th>
              <th scope="col" className="py-2 pr-3">Студент</th>
              <th scope="col" className="py-2">Группа</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => (
              <tr key={c.id} data-testid="print-row" className="border-b border-border print:border-black">
                <td className="py-2 pr-3">{i + 1}</td>
                <td className="py-2 pr-3 [overflow-wrap:anywhere]">{c.fullName}</td>
                <td className="py-2">{c.groupName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="m-0 text-[length:var(--fs-sm)] text-muted print:text-black">Всего: {candidates.length}. Вымышленные данные учебного прототипа.</p>
    </main>
  )
}
