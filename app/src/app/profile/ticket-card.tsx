import Image from 'next/image'
import type { ReactNode } from 'react'
import { Card, CardTitle } from '@/components/card'

/** Что нужно карточке билета. QR нарисован заранее (qrPath). Нет секрета — `qr` пусто. */
export interface TicketData {
  fullName: string
  faculty: string
  programme: string
  course: number
  groupName: string
  /** Есть ли у студента фото: нет — вместо него инициалы. */
  hasAvatar: boolean
  qr: { size: number; d: string } | null
  /** Адрес проверки, тот же, что в QR: кнопка «Открыть проверку» для тех, кто не может навести камеру. */
  verifyUrl: string | null
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

/**
 * Студенческий билет — главная карточка профиля: фото (или инициалы), ФИО, факультет, направление, курс, группа и QR.
 * Форма и срок обучения в данных не хранятся, поэтому их в карточке нет: не придумываются.
 * QR ведёт на публичную проверку `/verify/student/<код>`; без секрета подписи проверка выключена и карточка без QR.
 * `photoActions` — кнопки смены и удаления фото (форма загрузки), `notice` — итог последней загрузки; их готовит страница.
 */
export function TicketCard({ ticket, photoActions, notice }: { ticket: TicketData; photoActions?: ReactNode; notice?: ReactNode }) {
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
        <div className="flex flex-col gap-[var(--sp-4)] sm:flex-row sm:items-start sm:gap-[var(--sp-5)]">
          <div className="flex min-w-0 flex-1 flex-col gap-[var(--sp-3)]">
            <div className="flex items-center gap-[var(--sp-3)]">
              {ticket.hasAvatar ? (
                <Image
                  data-testid="profile-avatar"
                  src="/profile/avatar"
                  alt="Ваше фото"
                  width={96}
                  height={96}
                  unoptimized
                  className="size-24 flex-none rounded-full bg-avatar-bg object-cover"
                />
              ) : (
                <span
                  data-testid="profile-initials"
                  aria-hidden="true"
                  className="grid size-24 flex-none place-items-center rounded-full bg-avatar-bg text-[length:var(--fs-xl)] font-extrabold text-avatar-fg"
                >
                  {initials(ticket.fullName)}
                </span>
              )}
              <p data-testid="ticket-name" className="min-w-0 text-[length:var(--fs-lg)] font-bold leading-[1.2] [overflow-wrap:anywhere]">
                {ticket.fullName}
              </p>
            </div>
            {notice}
            {photoActions}
            <dl className="flex flex-col gap-[var(--sp-2)]">
              {rows.map(([name, value]) => (
                <div key={name}>
                  <dt className="text-[length:var(--fs-sm)] text-muted">{name}</dt>
                  <dd className="text-[length:var(--fs-md)] font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          {ticket.qr ? (
            <div className="flex flex-none flex-col items-start gap-[var(--sp-2)] sm:items-center">
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
              <p className="text-[length:var(--fs-sm)] text-muted sm:max-w-40">Покажите QR-код: по нему можно проверить, что студент обучается.</p>
              {ticket.verifyUrl ? (
                <a
                  data-testid="ticket-verify-link"
                  href={ticket.verifyUrl}
                  className="inline-flex min-h-[var(--tap)] min-w-[var(--tap)] items-center justify-center rounded-pill bg-primary-soft px-[var(--sp-4)] text-[length:var(--fs-sm)] font-bold text-primary"
                >
                  Открыть проверку
                </a>
              ) : null}
            </div>
          ) : (
            <p data-testid="ticket-no-qr" className="text-[length:var(--fs-sm)] font-bold text-muted">
              Проверка по QR выключена
            </p>
          )}
        </div>
        <p className="text-[length:var(--fs-sm)] font-bold">Прототип. Данные вымышленные</p>
      </div>
    </Card>
  )
}
