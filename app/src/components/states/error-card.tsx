'use client'

import { useEffect, useRef, useTransition } from 'react'
import { Button } from '@/components/ui/button'

// Состояние «ошибка» (D-2.2-system, 5.6): карточка в `role="alert"`; значок в круге 44 px и заголовок красные, пояснение и кнопка нет.
// Что не получилось, чья это сторона, что данные не потеряны, «Повторить» — R-1.3, Н7.4. Технического текста нет: ни сообщения ошибки,
// ни кода, ни служебного номера; в журнал сервера Next.js пишет сам. Заголовок — единственный на экране, поэтому `h1`.
// `role="alert"` без `aria-live="assertive"`: иначе VoiceOver читает дважды (Н8.3).
//
// «Повторить» после нажатия ждёт ответа (5.1, строка «Ждёт ответа»; R-3.7-11): `aria-disabled="true"`, `aria-busy="true"`, текст «Загружаем…».
// Не `disabled`: фокус с кнопки не уходит. Пока `retry` из Next.js ждёт ответа сервера, переход (`useTransition`) не закончен и `pending` истинно;
// повторное нажатие в это время ничего не делает. Ответ пришёл — содержимое заменяет карточку; ответ с ошибкой — карточка снова с «Повторить».
// Значка-вращения `.spin` из 5.1 в продукте нет: остаётся значок-стрелка.
//
// Фокус после ответа с ошибкой (R-3.7-18). Ответ пришёл с ошибкой — граница ошибок показывает карточку заново, уже новым экземпляром:
// старая кнопка убрана из страницы, и фокус уходит на `body`. Состояние внутри компонента такую замену не переживает, поэтому о нажатии
// помнит переменная модуля `refocusAfterRetry`. Новый экземпляр при монтировании читает её и, если фокус стоит на `body`, ставит его на свою
// кнопку «Повторить». Фокус на другом элементе — посетитель перешёл сам — не отбирается. При первом показе карточки переменная пуста
// и фокус не переносится. Ответ без ошибки заменяет карточку содержимым: новой карточки нет, и размонтирование сбрасывает переменную по таймеру,
// чтобы она не дожила до чужой ошибки.

export const ERROR_TEXT = 'Ошибка на нашей стороне. Ваши данные не потеряны.'

/** Нажали «Повторить», ответа ещё нет или он пришёл с ошибкой, а новая карточка не показана. */
let refocusAfterRetry = false
let refocusReset: ReturnType<typeof setTimeout> | undefined
/** Сколько после размонтирования карточки новая карточка ещё считается ответом на то же нажатие. */
const REFOCUS_WINDOW_MS = 1000

function cancelRefocusReset(): void {
  if (refocusReset !== undefined) clearTimeout(refocusReset)
  refocusReset = undefined
}

export function ErrorCard({ title, onRetry }: { title: string; onRetry: () => void }) {
  const [pending, startTransition] = useTransition()
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    cancelRefocusReset()
    if (refocusAfterRetry) {
      refocusAfterRetry = false
      const active = document.activeElement
      if (!active || active === document.body) section.current?.querySelector('button')?.focus()
    }
    return () => {
      if (!refocusAfterRetry) return
      cancelRefocusReset()
      refocusReset = setTimeout(() => {
        refocusAfterRetry = false
        refocusReset = undefined
      }, REFOCUS_WINDOW_MS)
    }
  }, [])
  return (
    <section ref={section} role="alert" className="flex flex-col gap-[var(--sp-3)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card">
      <div className="flex items-start gap-[var(--sp-3)]">
        <span className="grid size-11 flex-none place-items-center rounded-full bg-error-bg text-error">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5V13M12 16.2v.1" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[length:var(--fs-md)] font-extrabold leading-[1.3] text-error">{title}</h1>
          <p className="mt-1 text-[length:var(--fs-sm)] text-muted">{ERROR_TEXT}</p>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        aria-disabled={pending ? 'true' : undefined}
        aria-busy={pending ? 'true' : undefined}
        onClick={() => {
          if (pending) return
          cancelRefocusReset()
          refocusAfterRetry = true
          startTransition(() => onRetry())
        }}
        className={pending ? 'pointer-events-none w-full gap-[var(--sp-2)]' : 'w-full gap-[var(--sp-2)]'}
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12a8 8 0 1 1-2.6-5.9" />
          <path d="M20 4v5h-5" />
        </svg>
        {pending ? 'Загружаем…' : 'Повторить'}
      </Button>
    </section>
  )
}
