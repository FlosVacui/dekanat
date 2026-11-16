'use client'

import { ErrorCard } from '@/components/states/error-card'
import { StudentFrame } from '@/components/states/shell-parts'

// «Сегодня» и всё, у чего нет своего error.tsx. Каркас без данных: серверный код и сессия в клиентский компонент не тянутся.
// `retry` заново запрашивает страницу у сервера (Next.js 16.3+): причина устранена — на экране содержимое без ручной перезагрузки.
// Текст ошибки и служебный номер на экран не выводятся. «Не найдено» и «нет доступа» сюда не попадают: у них свои страницы.
export default function Error({ retry }: { retry: () => void }) {
  return (
    <StudentFrame data={null} active="today">
      <ErrorCard title="Не удалось загрузить страницу" onRetry={retry} />
    </StudentFrame>
  )
}
