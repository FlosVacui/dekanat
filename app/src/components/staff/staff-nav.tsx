'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { STAFF_NAV, activeStaffNav, isStaffArea, type StaffNavKey } from './nav-items'

// Меню сотрудника: шесть пунктов в строку с переносом, зона касания не ниже --tap, без прокрутки вбок на 360 px.
// Активный пункт — по адресу (aria-current). Вне кабинета сотрудника (общий каркас на странице «Как это сделано») меню нет.
function NavView({ active, bare = false }: { active: StaffNavKey | null; bare?: boolean }) {
  return (
    <nav aria-label="Меню сотрудника" className={bare ? undefined : 'px-[var(--pad-x)] pt-[var(--sp-3)]'}>
      <ul className="flex flex-wrap gap-[var(--sp-2)]">
        {STAFF_NAV.map((item) => {
          const current = item.key === active
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-[var(--tap)] items-center rounded-pill border-2 px-[var(--sp-3)] text-[length:var(--fs-sm)] font-bold',
                  current ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-card text-text',
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function CurrentNav({ bare = false }: { bare?: boolean }) {
  const pathname = usePathname()
  const view = useSearchParams().get('view')
  if (!isStaffArea(pathname)) return null
  return <NavView active={activeStaffNav(pathname, view)} bare={bare} />
}

export { NavView as StaffNavView, CurrentNav as StaffNav }
