import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card } from '@/components/card'
import { shortName, verifyStudentTicketCode } from '@/lib/certificate'
import { getConfig } from '@/server/config'
import { getStudentForTicketVerification } from '@/server/dal/student'

// Публичная проверка студенческого билета, вход не нужен. Код проверяется подписью (HMAC с меткой назначения «student-ticket»;
// код справки здесь не подходит). Слой доступа вызывается только с номером из верного кода. Показываются: «Студент обучается»,
// сокращённое ФИО, курс и группа. Больше ничего.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Проверка студенческого билета', robots: { index: false, follow: false } }

export default async function VerifyStudentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { certificateSecret } = getConfig()
  if (!certificateSecret) notFound()
  const studentId = verifyStudentTicketCode(code, certificateSecret)
  if (!studentId) notFound()
  const check = await getStudentForTicketVerification(studentId)
  if (!check) notFound()

  return (
    <main className="mx-auto w-full max-w-3xl px-[var(--pad-x)] py-[var(--sp-4)]">
      <Card className="flex flex-col gap-[var(--sp-3)]">
        <h1 data-testid="verify-result" className="text-[length:var(--h1-size)] font-bold leading-[1.15] text-success">
          Студент обучается
        </h1>
        <dl className="flex flex-col gap-[var(--sp-2)]">
          <div>
            <dt className="text-[length:var(--fs-sm)] text-muted">Студент</dt>
            <dd className="text-[length:var(--fs-md)] font-bold">{shortName(check.fullName)}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--fs-sm)] text-muted">Курс и группа</dt>
            <dd className="text-[length:var(--fs-md)]">
              {check.course} курс, группа {check.groupName}
            </dd>
          </div>
        </dl>
        <p className="text-[length:var(--fs-sm)] font-bold">Прототип. Данные вымышленные</p>
      </Card>
    </main>
  )
}
