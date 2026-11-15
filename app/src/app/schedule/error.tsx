'use client'

import { ErrorCard } from '@/components/states/error-card'
import { StudentFrame } from '@/components/states/shell-parts'

export default function Error({ retry }: { retry: () => void }) {
  return (
    <StudentFrame data={null} active="schedule">
      <ErrorCard title="Не удалось загрузить расписание" onRetry={retry} />
    </StudentFrame>
  )
}
