import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'

// Ответ 403: сотрудник на адресе студента и наоборот (ADR-0002, правило 3).
export default function Forbidden() {
  return (
    <main className="mx-auto max-w-sm p-4">
      <PageTitle>Нет доступа</PageTitle>
      <Card>
        <p className="mb-3 text-sm">Этот раздел для другой роли.</p>
        <LinkButton href="/">На главную</LinkButton>
      </Card>
    </main>
  )
}
