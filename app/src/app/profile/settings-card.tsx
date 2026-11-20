import { Card, CardTitle } from '@/components/card'
import { SubmitButton } from '@/components/submit-button'
import { saveUiSettingsAction } from './actions'
import { SIZE_LABELS, TEXT_SIZES, THEMES, THEME_LABELS, type UiSettings } from './ui-settings'

function Choice({ name, value, label, checked }: { name: string; value: string; label: string; checked: boolean }) {
  return (
    <label className="flex min-h-[var(--tap)] cursor-pointer items-center gap-[var(--sp-3)] text-[length:var(--fs-md)]">
      <input type="radio" name={name} value={value} defaultChecked={checked} className="size-6 flex-none accent-[var(--primary)]" />
      <span>{label}</span>
    </label>
  )
}

/** Настройки отображения: тема и размер текста. Форма работает без скриптов; выбор хранится в куке `ui` (actions.ts). */
export function SettingsCard({ current }: { current: UiSettings }) {
  return (
    <Card>
      <CardTitle>Отображение</CardTitle>
      <form action={saveUiSettingsAction} className="flex flex-col gap-[var(--sp-3)]">
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-1 text-[length:var(--fs-sm)] font-bold">Тема</legend>
          {THEMES.map((theme) => (
            <Choice key={theme} name="theme" value={theme} label={THEME_LABELS[theme]} checked={current.theme === theme} />
          ))}
        </fieldset>
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-1 text-[length:var(--fs-sm)] font-bold">Размер текста</legend>
          {TEXT_SIZES.map((size) => (
            <Choice key={size} name="size" value={size} label={SIZE_LABELS[size]} checked={current.size === size} />
          ))}
        </fieldset>
        <SubmitButton className="w-full">Сохранить</SubmitButton>
      </form>
    </Card>
  )
}
