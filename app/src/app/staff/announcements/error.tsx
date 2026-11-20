'use client'

import { ErrorCard } from '@/components/states/error-card'
import { StaffShell } from '@/components/staff-shell'

// Объявления сотрудника.
export default function Error({ retry }: { retry: () => void }) {
  return (
    <StaffShell>
      <ErrorCard title="Не удалось загрузить объявления" onRetry={retry} />
    </StaffShell>
  )
}
