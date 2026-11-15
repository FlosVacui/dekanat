import { NotFoundView } from '@/components/requests/not-found-view'

// Заявка другого набора и несуществующая выглядят одинаково (ADR-0002).
export default function StaffRequestNotFound() {
  return (
    <NotFoundView title="Нет такой заявки" href="/staff/requests" action="К списку заявок">
      Заявки с таким номером в вашем наборе нет.
    </NotFoundView>
  )
}
