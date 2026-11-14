import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

// Кнопка по дизайн-системе (docs/design/D-2.2-system.md, 5.1). Высота не меньше --control-h (52 px), зона касания не ниже 44 (ЗД-5, ADR-0001).
// Выключенная: заливка и текст из системы, без прозрачности. Вид secondary выглядит как ghost из системы; переименование — отдельный шаг IMP-020.
export const buttonVariants = cva(
  'inline-flex min-h-[var(--control-h)] min-w-11 items-center justify-center rounded-pill border-2 border-transparent px-7 text-[length:var(--fs-md)] font-bold leading-[1.2] focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus active:translate-y-px active:shadow-[inset_0_0_0_999px_var(--press)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-border disabled:text-muted disabled:shadow-none disabled:translate-y-0',
  {
    variants: {
      variant: {
        primary: 'bg-btn-main-bg text-btn-main-fg',
        secondary: 'border-primary bg-transparent text-primary',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />
}
