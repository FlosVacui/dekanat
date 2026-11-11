'use client'

import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/button'

/** Кнопка отправки формы: пока действие идёт, она недоступна, чтобы заявка не ушла дважды. */
export function SubmitButton({ children, ...props }: Omit<ButtonProps, 'type'>) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {children}
    </Button>
  )
}
