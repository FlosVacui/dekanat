import { NotFoundView } from '@/components/requests/not-found-view'

export default function NotFound() {
  return (
    <NotFoundView title="Такой страницы нет" href="/" action="На главную">
      Проверьте адрес или вернитесь на главную.
    </NotFoundView>
  )
}
