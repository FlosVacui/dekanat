'use client'

import { useRef, useState } from 'react'
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
 * Форма загрузки фото. Без скриптов — обычная форма с файлом, без уменьшения (тот же предел 150 КБ проверяет сервер).
 * Со скриптами выбранный файл заменяется уменьшенной копией до отправки.
 */
export function AvatarForm() {
  const input = useRef<HTMLInputElement>(null)
  // Пока файл уменьшается, кнопка недоступна: иначе быстрое нажатие отправило бы исходный файл.
  const [shrinking, setShrinking] = useState(false)

  async function onChange() {
    const field = input.current
    const file = field?.files?.[0]
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
    <form action={uploadAvatarAction} className="flex flex-col gap-[var(--sp-2)]">
      <label htmlFor="avatar-file" className="text-[length:var(--fs-sm)] font-bold">
        Новое фото (JPEG, PNG или WebP, до 150 КБ)
      </label>
      <input
        ref={input}
        id="avatar-file"
        name="avatar"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        onChange={onChange}
        className="block min-h-[var(--tap)] w-full min-w-0 rounded-control border-2 border-border-strong bg-card p-[var(--sp-2)] text-[length:var(--fs-sm)] text-text file:mr-[var(--sp-2)] file:min-h-9 file:rounded-pill file:border-0 file:bg-primary-soft file:px-[var(--sp-3)] file:font-bold file:text-primary"
      />
      <SubmitButton variant="soft" className="w-full" disabled={shrinking}>
        Загрузить фото
      </SubmitButton>
    </form>
  )
}
