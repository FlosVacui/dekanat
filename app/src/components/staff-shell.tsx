import Image from 'next/image'
import type { ReactNode } from 'react'
import { logoutAction } from '@/app/login/actions'
import { SubmitButton } from '@/components/submit-button'

// Каркас экранов сотрудника: знак, название и «Выйти». Вкладок у сотрудника нет (S-2.1, раздел 2).
// Шапка — по разделу 6 дизайн-системы (D-2.2-system), знак — по разделу 7.
export function StaffShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl lg:max-w-[1200px]">
      <header className="flex items-center gap-1 bg-header-bg px-[var(--pad-x)] pb-[var(--sp-3)] pt-[var(--sp-4)] text-on-header">
        {/* Знак 40×40 внутри круга 44×44. Подложка круга — переменная системы: прозрачная в светлой теме. */}
        <div className="grid size-11 flex-none place-items-center rounded-full bg-logo-plate">
          <Image src="/owl-128.png" alt="" width={40} height={40} unoptimized />
        </div>
        <div className="min-w-0 flex-1 text-[length:var(--fs-md)] font-bold leading-[1.2]">Деканат в кармане</div>
        <form action={logoutAction} className="flex-none">
          {/* Кнопка ниже обычной (44 вместо 52) и уже: иначе она тянет за собой шапку. Зона касания — норма системы. */}
          <SubmitButton variant="ghost" className="min-h-[var(--tap)] px-[var(--sp-4)]">
            Выйти
          </SubmitButton>
        </form>
      </header>
      <main className="px-[var(--pad-x)] py-[var(--sp-4)]">{children}</main>
    </div>
  )
}
