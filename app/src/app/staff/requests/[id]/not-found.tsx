import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'

// Заявка другого набора и несуществующая выглядят одинаково (ADR-0002).
export default function StaffRequestNotFound() {
  return (
    <main className="mx-auto max-w-sm p-4">
      <PageTitle>Нет такой заявки</PageTitle>
      <Card>
        <p className="mb-3 text-sm">Заявки с таким номером в вашем наборе нет.</p>
        <LinkButton href="/staff/requests">К списку заявок</LinkButton>
      </Card>
    </main>
  )
}
