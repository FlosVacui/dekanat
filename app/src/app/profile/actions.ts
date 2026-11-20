'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireStudentActor } from '@/server/auth/page-guards'
import { deleteMyAvatar, setMyAvatar } from '@/server/dal/student'
import { AVATAR_MAX_BYTES } from './avatar-rules'
import { UI_COOKIE, UI_COOKIE_MAX_AGE, isTextSize, isTheme, serializeUi } from './ui-settings'

// 20.11, блиц: фото профиля и настройки отображения. Студента определяет сессия; в форме нет ни номера, ни логина.
// Итог — переход на профиль с кодом результата в адресе: страница выбирает текст из готового списка (avatar-rules.ts).

/** Загрузка фото. Файл читается только после проверки размера по заголовку части; тип и сигнатуру проверяет слой доступа. */
export async function uploadAvatarAction(formData: FormData): Promise<void> {
  const actor = await requireStudentActor()
  const file = formData.get('avatar')
  if (!(file instanceof File) || file.size === 0) redirect('/profile?avatar=empty')
  if (file.size > AVATAR_MAX_BYTES) redirect('/profile?avatar=size')
  const result = await setMyAvatar(actor, new Uint8Array(await file.arrayBuffer()), file.type)
  redirect(`/profile?avatar=${result.ok ? 'saved' : result.reason}`)
}

export async function deleteAvatarAction(): Promise<void> {
  const actor = await requireStudentActor()
  await deleteMyAvatar(actor)
  redirect('/profile?avatar=deleted')
}

/** Тема и размер текста: из списка допустимых значений; иначе кука не меняется. Кука не секретная, httpOnly не нужен. */
export async function saveUiSettingsAction(formData: FormData): Promise<void> {
  await requireStudentActor()
  const theme = formData.get('theme')
  const size = formData.get('size')
  if (!isTheme(theme) || !isTextSize(size)) redirect('/profile?ui=bad')
  const store = await cookies()
  store.set(UI_COOKIE, serializeUi({ theme, size }), {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: UI_COOKIE_MAX_AGE,
  })
  redirect('/profile?ui=saved')
}
