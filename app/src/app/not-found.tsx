import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'

export default function NotFound() {
  return (
    <main className="mx-auto max-w-sm p-4">
      <PageTitle>Такой страницы нет</PageTitle>
      <Card>
        <p className="mb-3 text-sm">Проверьте адрес или вернитесь на главную.</p>
        <LinkButton href="/">На главную</LinkButton>
      </Card>
    </main>
  )
}
