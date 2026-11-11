import type { ReactNode } from 'react'
import { logoutAction } from '@/app/login/actions'
import { SubmitButton } from '@/components/submit-button'

// Каркас экранов сотрудника: название и «Выйти». Вкладок у сотрудника нет (S-2.1, раздел 2).
export function StaffShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-300 bg-white px-4 py-2">
        <div className="text-base font-semibold">Деканат в кармане</div>
        <form action={logoutAction}>
          <SubmitButton variant="secondary">Выйти</SubmitButton>
        </form>
      </header>
      <main className="p-4">{children}</main>
    </div>
  )
}
