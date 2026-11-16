'use client'

import { ErrorCard } from '@/components/states/error-card'
import { StudentFrame } from '@/components/states/shell-parts'

// Успеваемость и дисциплина (grades/[id]).
export default function Error({ retry }: { retry: () => void }) {
  return (
    <StudentFrame data={null} active="grades">
      <ErrorCard title="Не удалось загрузить оценки" onRetry={retry} />
    </StudentFrame>
  )
}
