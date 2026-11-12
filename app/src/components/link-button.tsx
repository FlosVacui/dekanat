import Link from 'next/link'
import type { ComponentProps } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Ссылка, выглядящая как кнопка: зона касания не ниже 44 пикселей. */
export function LinkButton({
  className,
  variant,
  ...props
}: ComponentProps<typeof Link> & { variant?: 'primary' | 'secondary' }) {
  return <Link className={cn(buttonVariants({ variant }), 'text-center', className)} {...props} />
}
