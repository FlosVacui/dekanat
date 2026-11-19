import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card } from '@/components/card'
import { CERTIFICATE_TITLE, shortName, verifyCertificateCode } from '@/lib/certificate'
import { formatDate, todayIn } from '@/lib/dates'
import { getConfig } from '@/server/config'
import { getCertificateForVerification } from '@/server/dal/student'

// Публичная проверка справки, вход не нужен. Код проверяется подписью (HMAC, сравнение за постоянное время); слой доступа
// вызывается только с номером из верного кода. Показываются: тип, сокращённое ФИО, курс и группа, дата выдачи. Больше ничего.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Проверка справки', robots: { index: false, follow: false } }

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { certificateSecret, timezone } = getConfig()
  if (!certificateSecret) notFound()
  const requestId = verifyCertificateCode(code, certificateSecret)
  if (!requestId) notFound()
  const check = await getCertificateForVerification(requestId)
  if (!check) notFound()

  return (
    <main className="mx-auto w-full max-w-3xl px-[var(--pad-x)] py-[var(--sp-4)]">
      <Card className="flex flex-col gap-[var(--sp-3)]">
        <h1 data-testid="verify-result" className="text-[length:var(--h1-size)] font-bold leading-[1.15] text-success">
          Справка действительна
        </h1>
        <dl className="flex flex-col gap-[var(--sp-2)]">
          <div>
            <dt className="text-[length:var(--fs-sm)] text-muted">Документ</dt>
            <dd className="text-[length:var(--fs-md)] font-bold">{CERTIFICATE_TITLE}</dd>
          </div>
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
          <div>
            <dt className="text-[length:var(--fs-sm)] text-muted">Дата выдачи</dt>
            <dd className="text-[length:var(--fs-md)]">{formatDate(todayIn(timezone, check.issuedAt))}</dd>
          </div>
        </dl>
        <p className="text-[length:var(--fs-sm)] font-bold">Прототип. Данные вымышленные</p>
      </Card>
    </main>
  )
}
