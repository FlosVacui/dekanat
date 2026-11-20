import { NotFoundView } from '@/components/requests/not-found-view'

// Студент другого набора и несуществующий выглядят одинаково (ADR-0002).
export default function StaffStudentNotFound() {
  return (
    <NotFoundView title="Нет такого студента" href="/staff/students" action="К списку студентов">
      Студента с таким номером в вашем наборе нет.
    </NotFoundView>
  )
}
