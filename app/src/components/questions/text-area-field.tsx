import { QUESTION_MAX_LENGTH } from '@/lib/questions'

// Многострочное поле по разделу 5.3 дизайн-системы (D-2.2-system): подпись над полем, рамка 2 px --border-strong,
// скругление --radius-ctl, текст --fs-md, высота не меньше --control-h. Подсказка под полем связана с ним (aria-describedby).
// Предел `maxlength` — удобство для человека; настоящую проверку длины делают слой доступа и база.
export function TextAreaField({
  id,
  name,
  label,
  hint,
}: {
  id: string
  name: string
  label: string
  hint?: string
}) {
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[length:var(--fs-sm)] font-bold">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        required
        rows={6}
        maxLength={QUESTION_MAX_LENGTH}
        aria-describedby={hintId}
        className="block min-h-[var(--control-h)] w-full resize-y rounded-control border-2 border-border-strong bg-card px-[var(--sp-4)] py-3 text-[length:var(--fs-md)] leading-[1.4] text-text focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      {hint ? (
        <p id={hintId} className="text-[length:var(--fs-sm)] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
