import Image from 'next/image'
import { Suspense, type ReactNode } from 'react'
import { logoutAction } from '@/app/login/actions'
import { SubmitButton } from '@/components/submit-button'
import { JuryPanel } from '@/components/jury/jury-panel'
import { ProcessLink } from '@/components/jury/process-link'
import { StaffNav } from '@/components/staff/staff-nav'

// Каркас экранов сотрудника: знак, название и «Выйти». Нижней панели вкладок у сотрудника нет (S-2.1, раздел 2); 20.11 добавлено меню разделов под шапкой.
// Шапка — по разделу 6 дизайн-системы (D-2.2-system), знак — по разделу 7.
// juryMode приходит от серверной страницы: оболочку рисует и клиентский error.tsx, где config недоступен.
export function StaffShell({ children, juryMode = false }: { children: ReactNode; juryMode?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-3xl lg:max-w-[1200px]">
      <header className="flex items-center gap-1 bg-header-bg px-[var(--pad-x)] pb-[var(--sp-3)] pt-[var(--sp-4)] text-on-header">
        {/* Знак 40×40 внутри круга 44×44. Подложка круга — переменная системы: прозрачная в светлой теме. */}
        <div className="grid size-11 flex-none place-items-center rounded-full bg-logo-plate">
          <Image src="/owl-128.png" alt="" width={40} height={40} unoptimized />
        </div>
        <div className="order-1 min-w-0 flex-1 text-[length:var(--fs-md)] font-bold leading-[1.2]">Деканат в кармане</div>
        <form action={logoutAction} className="order-3 flex-none">
          {/* Кнопка ниже обычной (44 вместо 52) и уже: иначе она тянет за собой шапку. Зона касания — норма системы. */}
          <SubmitButton variant="ghost" className="min-h-[var(--tap)] px-[var(--sp-4)]">
            Выйти
          </SubmitButton>
        </form>
        {/* От 1024 px меню в строке шапки: показано перед «Выйти», а в порядке Tab идёт после него. */}
        <div className="order-2 hidden flex-none lg:block">
          <Suspense fallback={null}>
            <StaffNav bare />
          </Suspense>
        </div>
      </header>
      {/* 20.11, блиц: меню ниже шапки и вне <main>. Граница ожидания нужна для useSearchParams; меню само скрывается вне /staff. */}
      {/* До 1024 px меню под содержимым: сверху оно опускало «Сохранить» заявки ниже первого окна (Э-12). */}
      <main className="px-[var(--pad-x)] py-[var(--sp-4)]">{children}</main>
      <div className="pb-[var(--sp-4)] lg:hidden">
        <Suspense fallback={null}>
          <StaffNav />
        </Suspense>
      </div>
      <ProcessLink />
      {juryMode ? <JuryPanel /> : null}
    </div>
  )
}
