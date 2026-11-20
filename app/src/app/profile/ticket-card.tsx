import { Card, CardTitle } from '@/components/card'

/** Что нужно карточке билета. QR нарисован заранее (qrPath). Нет секрета — `qr` пусто. */
export interface TicketData {
  fullName: string
  faculty: string
  programme: string
  course: number
  groupName: string
  qr: { size: number; d: string } | null
  /** Адрес проверки, тот же, что в QR: для тех, кто не может навести камеру. */
  verifyUrl: string | null
}

/**
 * Электронный студенческий билет. Форма и срок обучения в данных не хранятся, поэтому их в карточке нет: не придумываются.
 * QR ведёт на публичную проверку `/verify/student/<код>`; без секрета подписи проверка выключена и карточка без QR.
 */
export function TicketCard({ ticket }: { ticket: TicketData }) {
  const rows: [string, string][] = [
    ['Факультет', ticket.faculty],
    ['Направление', ticket.programme],
    ['Курс', String(ticket.course)],
    ['Группа', ticket.groupName],
  ]
  return (
    <Card>
      <div data-testid="student-ticket" className="flex flex-col gap-[var(--sp-3)]">
        <CardTitle>Студенческий билет</CardTitle>
        <p data-testid="ticket-name" className="text-[length:var(--fs-lg)] font-bold leading-[1.2]">
          {ticket.fullName}
        </p>
        <dl className="flex flex-col gap-[var(--sp-2)]">
          {rows.map(([name, value]) => (
            <div key={name}>
              <dt className="text-[length:var(--fs-sm)] text-muted">{name}</dt>
              <dd className="text-[length:var(--fs-md)]">{value}</dd>
            </div>
          ))}
        </dl>
        {ticket.qr ? (
          <div className="flex flex-col items-start gap-[var(--sp-2)]">
            <svg
              data-testid="ticket-qr"
              role="img"
              aria-label="QR-код для проверки студенческого билета"
              viewBox={`0 0 ${ticket.qr.size} ${ticket.qr.size}`}
              shapeRendering="crispEdges"
              className="size-40 max-w-full bg-white"
            >
              <path d={ticket.qr.d} fill="#000" />
            </svg>
            <p className="text-[length:var(--fs-sm)] text-muted">Покажите QR-код: по нему можно проверить, что студент обучается.</p>
            {ticket.verifyUrl ? (
              <a data-testid="ticket-verify-link" href={ticket.verifyUrl} className="inline-flex min-h-[var(--tap)] items-center break-all text-[length:var(--fs-sm)] font-bold text-primary underline">
                {ticket.verifyUrl}
              </a>
            ) : null}
          </div>
        ) : (
          <p data-testid="ticket-no-qr" className="text-[length:var(--fs-sm)] font-bold text-muted">
            Проверка по QR выключена
          </p>
        )}
        <p className="text-[length:var(--fs-sm)] font-bold">Прототип. Данные вымышленные</p>
      </div>
    </Card>
  )
}
