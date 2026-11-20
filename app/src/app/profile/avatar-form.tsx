'use client'

import { useRef, useState, type ReactNode } from 'react'
import { SubmitButton } from '@/components/submit-button'
import { uploadAvatarAction } from './actions'

const SIDE = 256

/**
 * Уменьшает фото до квадрата 256×256 (по центру, JPEG, качество 0,85). Холст и `createImageBitmap` не требуют адреса
 * картинки, поэтому политика содержимого (`img-src 'self'`) не мешает. Не вышло — null: уйдёт исходный файл.
 */
async function shrink(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const side = Math.min(bitmap.width, bitmap.height)
    if (side === 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = SIDE
    canvas.height = SIDE
    const context = canvas.getContext('2d')
    if (!context) return null
    // Белый фон: у PNG и WebP с прозрачностью в JPEG иначе получился бы чёрный.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, SIDE, SIDE)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob ? new File([blob], 'avatar.jpg', { type: 'image/jpeg' }) : null
  } catch {
    return null
  }
}

/**
 * Кнопки фото рядом с аватаром. «Сменить фото» («Загрузить фото», если фото нет) — подпись над скрытым полем файла: свой русский
 * текст вместо «Choose File». Поле остаётся в порядке обхода клавиатурой, рамку фокуса рисует подпись. Кнопка «Сохранить фото»
 * показывается, когда файл выбран (`peer-valid`: поле обязательное, чистый CSS, скрипты не нужны). Без скриптов это обычная форма
 * с файлом без уменьшения (тот же предел 150 КБ проверяет сервер). Со скриптами выбранный файл заменяется уменьшенной копией.
 * `children` — рядом с кнопками (кнопка «Удалить фото» — своя форма).
 */
export function AvatarForm({ hasAvatar, children }: { hasAvatar: boolean; children?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  // Пока файл уменьшается, кнопка недоступна: иначе быстрое нажатие отправило бы исходный файл.
  const [shrinking, setShrinking] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  async function onChange() {
    const field = input.current
    const file = field?.files?.[0]
    setFileName(file?.name ?? null)
    if (!field || !file) return
    setShrinking(true)
    try {
      const small = await shrink(file)
      if (!small) return
      const transfer = new DataTransfer()
      transfer.items.add(small)
      field.files = transfer.files
    } finally {
      setShrinking(false)
    }
  }

  return (
    <div className="flex flex-col gap-[var(--sp-2)]">
      <div className="flex flex-wrap items-center gap-[var(--sp-2)]">
        <form action={uploadAvatarAction} className="contents">
          <input
            ref={input}
            id="avatar-file"
            name="avatar"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            aria-describedby="avatar-hint"
            onChange={onChange}
            className="peer sr-only"
          />
          <label
            htmlFor="avatar-file"
            className="inline-flex min-h-[var(--tap)] min-w-11 cursor-pointer items-center justify-center rounded-pill border-2 border-transparent bg-primary-soft px-[var(--sp-4)] text-[length:var(--fs-sm)] font-bold leading-[1.2] text-primary active:translate-y-px peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
          >
            {hasAvatar ? 'Сменить фото' : 'Загрузить фото'}
          </label>
          <SubmitButton className="hidden min-h-[var(--tap)] px-[var(--sp-4)] text-[length:var(--fs-sm)] peer-valid:inline-flex" disabled={shrinking}>
            Сохранить фото
          </SubmitButton>
        </form>
        {children}
      </div>
      {fileName ? (
        <p data-testid="avatar-file-name" className="min-w-0 text-[length:var(--fs-sm)] [overflow-wrap:anywhere]">
          Выбран файл: {fileName}
        </p>
      ) : null}
      <p id="avatar-hint" className="text-[length:var(--fs-sm)] text-muted">
        JPEG, PNG или WebP, до 150 КБ
      </p>
    </div>
  )
}
