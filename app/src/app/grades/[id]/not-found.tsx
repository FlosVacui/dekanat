import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'

// Чужая, несуществующая дисциплина и мусор вместо номера выглядят одинаково (ADR-0002): ответ 404 и этот текст, без данных дисциплины.
export default function DisciplineNotFound() {
  return (
    <main className="mx-auto max-w-sm p-4">
      <PageTitle>Нет такой дисциплины</PageTitle>
      <Card>
        <p className="mb-3 text-sm">Дисциплины с таким номером у вас нет.</p>
        <LinkButton href="/grades">Все дисциплины</LinkButton>
      </Card>
    </main>
  )
}
