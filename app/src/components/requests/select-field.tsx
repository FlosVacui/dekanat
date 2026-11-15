import type { ReactNode } from 'react'
import { RequestIcon } from './icons'

// Поле выбора по разделу 5.3 дизайн-системы (D-2.2-system): подпись над полем, высота не меньше --control-h, рамка 2 px
// --border-strong, скругление --radius-ctl, текст --fs-md. Элемент остаётся настоящим <select> с <option>.
// Закрытый <select> по умолчанию показывает значение в одну строку и обрезает длинное («О периоде обучения (с оценками, на основании
// заявления в деканате)» — 66 знаков). Здесь у него снят вид системы (appearance none), разрешён перенос строк и высота по тексту,
// поэтому значение читается целиком. Стрелка — свой встроенный значок поверх поля (data: в политике содержимого запрещён);
// клики он пропускает. Меню выбора открывается родным.
export function SelectField({
  id,
  name,
  label,
  defaultValue,
  children,
}: {
  id: string
  name: string
  label: string
  defaultValue?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[length:var(--fs-sm)] font-bold">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          name={name}
          defaultValue={defaultValue}
          className="block h-auto min-h-[var(--control-h)] w-full appearance-none whitespace-normal rounded-control border-2 border-border-strong bg-card py-3 pl-[var(--sp-4)] pr-12 text-[length:var(--fs-md)] leading-[1.3] text-text"
        >
          {children}
        </select>
        <RequestIcon name="down" strokeWidth={2.4} className="pointer-events-none absolute right-[var(--sp-4)] top-1/2 size-5 -translate-y-1/2 text-text" />
      </div>
    </div>
  )
}
