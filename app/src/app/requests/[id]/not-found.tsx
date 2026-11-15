import { NotFoundView } from '@/components/requests/not-found-view'

// Чужая и несуществующая заявка выглядят одинаково (ADR-0002): ответ 404 и этот текст, без данных заявки.
export default function RequestNotFound() {
  return (
    <NotFoundView title="Нет такой заявки" href="/requests" action="К моим заявкам">
      Заявки с таким номером у вас нет.
    </NotFoundView>
  )
}
