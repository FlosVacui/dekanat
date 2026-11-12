import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-lg border border-neutral-300 bg-white p-4', className)}>{children}</section>
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-base font-semibold">{children}</h2>
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="mb-3 text-xl font-semibold">{children}</h1>
}
