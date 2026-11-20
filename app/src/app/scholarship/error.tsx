'use client'

import { ErrorCard } from '@/components/states/error-card'
import { StudentFrame } from '@/components/states/shell-parts'

// «Стипендия». Каркас без данных: серверный код и сессия в клиентский компонент не тянутся.
export default function Error({ retry }: { retry: () => void }) {
  return (
    <StudentFrame data={null} active="scholarship">
      <ErrorCard title="Не удалось загрузить страницу" onRetry={retry} />
    </StudentFrame>
  )
}
