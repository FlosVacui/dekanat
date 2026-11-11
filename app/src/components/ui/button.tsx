import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

// Кнопка в духе shadcn/ui, написана заново. Зона касания не ниже 44 пикселей (ЗД-5, ADR-0001): min-h-11 = 44 px.
const buttonVariants = cva(
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-4 text-base font-medium disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-blue-700 text-white',
        secondary: 'border border-neutral-400 bg-white text-neutral-900',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />
}
