import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Card } from '@/components/card'
import { LinkButton } from '@/components/link-button'
import { PrintButton } from '@/components/requests/print-button'
import { StudentShell } from '@/components/student-shell'
import { formatDate, todayIn } from '@/lib/dates'
import { CERTIFICATE_TITLE, baseUrlFrom, certificateCode, qrPath } from '@/lib/certificate'
import { denyRecord, requireStudentActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getMyProfile, getMyRequest } from '@/server/dal/student'

// Печатная страница справки об обучении: HTML с @media print, «Сохранить в PDF» — печать браузера. QR ведёт на /verify/<код>.
// Заявку страница читает через слой доступа вместе с владельцем из сессии: чужая и несуществующая — 404. Без секрета в окружении
// страницы нет. Адрес в QR — из заголовка Host запроса.
export const dynamic = 'force-dynamic'

const PRINT_CSS = `@media print {
  header, nav, footer, [data-sidenav], [data-no-print] { display: none !important; }
  body { background: #fff !important; }
  main { padding: 0 !important; }
}`

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStudentActor()
  const { id } = await params
  const { certificateSecret, timezone } = getConfig()
  if (!certificateSecret) notFound()
  const request = await getMyRequest(actor, id)
  if (!request) return denyRecord(actor)
  if (request.kind !== 'dean_certificate' || (request.status !== 'ready' && request.status !== 'issued')) notFound()
  const profile = await getMyProfile(actor)
  if (!profile) notFound()

  const h = await headers()
  const base = baseUrlFrom(h.get('host'), h.get('x-forwarded-proto'))
  if (!base) notFound()
  const url = `${base}/verify/${certificateCode(request.id, certificateSecret)}`
  const qr = qrPath(url)
  const readyAt = request.events.find((e) => e.status === 'ready')?.createdAt ?? request.createdAt
  const issuedOn = formatDate(todayIn(timezone, readyAt))

  return (
    <StudentShell actor={actor} active="requests">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-col gap-[var(--gap)]">
        <Card className="flex flex-col gap-[var(--sp-3)]">
          <h1 data-testid="certificate-title" className="text-[length:var(--h1-size)] font-bold leading-[1.15]">
            {CERTIFICATE_TITLE}
          </h1>
          <p className="text-[length:var(--fs-md)] leading-[1.4]">
            {request.studentName} — студент(ка) {profile.course} курса, группа {profile.groupName}, {profile.faculty}. Справка выдана по месту
            требования.
          </p>
          <p className="text-[length:var(--fs-sm)] text-muted">Дата выдачи: {issuedOn}</p>
          <div className="flex flex-col items-start gap-[var(--sp-2)]">
            <svg
              data-testid="certificate-qr"
              role="img"
              aria-label="QR-код для проверки справки"
              viewBox={`0 0 ${qr.size} ${qr.size}`}
              shapeRendering="crispEdges"
              className="size-40 bg-white"
            >
              <path d={qr.d} fill="#000" />
            </svg>
            <p className="break-all text-[length:var(--fs-sm)] text-muted">Проверка подлинности: {url}</p>
          </div>
          <p className="text-[length:var(--fs-sm)] font-bold">Прототип. Данные вымышленные</p>
        </Card>
        <div data-no-print className="flex flex-col gap-[var(--sp-2)]">
          <PrintButton>Сохранить в PDF</PrintButton>
          <LinkButton href={`/requests/${request.id}`} variant="ghost">
            К заявке
          </LinkButton>
        </div>
      </div>
    </StudentShell>
  )
}
