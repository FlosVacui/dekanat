import Link from 'next/link'
import { RequestIcon } from './icons'

// Ссылка «назад» (D-2.2-system, 5.10): стрелка 24 px и слово --fs-sm, жирность 700, цвет --primary. Зона касания не ниже --tap.
// Одна на экран, первая в содержимом. Слово — название списка, к которому возвращает. Рамка фокуса — общая (globals.css).
// Верхний отступ −10 px (--sp-2) втягивает ссылку под верхний отступ содержимого; зона касания от этого не меньше.
export function BackLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="-mt-[var(--sp-2)] inline-flex min-h-[var(--tap)] items-center gap-1 self-start pr-[var(--sp-2)] text-[length:var(--fs-sm)] font-bold text-primary no-underline"
    >
      <RequestIcon name="back" className="size-6 flex-none" />
      {children}
    </Link>
  )
}
