'use client'

import { ErrorCard } from '@/components/states/error-card'
import { StaffShell } from '@/components/staff-shell'

// Кабинет сотрудника: список заявок и заявка (staff/requests/[id]).
export default function Error({ retry }: { retry: () => void }) {
  return (
    <StaffShell>
      <ErrorCard title="Не удалось загрузить заявки" onRetry={retry} />
    </StaffShell>
  )
}
