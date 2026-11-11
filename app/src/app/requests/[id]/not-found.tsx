import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'

// Чужая и несуществующая заявка выглядят одинаково (ADR-0002): ответ 404 и этот текст, без данных заявки.
export default function RequestNotFound() {
  return (
    <main className="mx-auto max-w-sm p-4">
      <PageTitle>Нет такой заявки</PageTitle>
      <Card>
        <p className="mb-3 text-sm">Заявки с таким номером у вас нет.</p>
        <LinkButton href="/requests">К моим заявкам</LinkButton>
      </Card>
    </main>
  )
}
