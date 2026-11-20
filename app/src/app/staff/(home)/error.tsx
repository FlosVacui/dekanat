'use client'

import { ErrorCard } from '@/components/states/error-card'
import { StaffShell } from '@/components/staff-shell'

// Сводка сотрудника: свой текст ошибки, чтобы не говорить о заявках.
export default function Error({ retry }: { retry: () => void }) {
  return (
    <StaffShell>
      <ErrorCard title="Не удалось загрузить сводку" onRetry={retry} />
    </StaffShell>
  )
}
