'use client'

import { ErrorCard } from '@/components/states/error-card'
import { StudentFrame } from '@/components/states/shell-parts'

// Список заявок, новая заявка и заявка (requests/new, requests/[id]).
export default function Error({ retry }: { retry: () => void }) {
  return (
    <StudentFrame data={null} active="requests">
      <ErrorCard title="Не удалось загрузить заявки" onRetry={retry} />
    </StudentFrame>
  )
}
