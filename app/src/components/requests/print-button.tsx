'use client'

import { Button } from '@/components/ui/button'

/** «Сохранить в PDF»: диалог печати браузера, в нём выбирается «Сохранить как PDF». Без скриптов кнопка не работает. */
export function PrintButton({ children }: { children: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      {children}
    </Button>
  )
}
