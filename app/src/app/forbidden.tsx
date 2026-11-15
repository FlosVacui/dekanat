import { NotFoundView } from '@/components/requests/not-found-view'

// Ответ 403: сотрудник на адресе студента и наоборот (ADR-0002, правило 3).
export default function Forbidden() {
  return (
    <NotFoundView title="Нет доступа" href="/" action="На главную">
      Этот раздел для другой роли.
    </NotFoundView>
  )
}
