import { NotFoundView } from '@/components/requests/not-found-view'

// Чужая, несуществующая и не готовая к печати заявка выглядят одинаково: 404 без данных.
export default function CertificateNotFound() {
  return (
    <NotFoundView title="Нет такой справки" href="/requests" action="К моим заявкам">
      Справки с таким номером у вас нет.
    </NotFoundView>
  )
}
