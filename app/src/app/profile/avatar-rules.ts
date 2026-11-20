// Правила фото профиля (20.11, блиц). Чистые функции: без базы и без окружения, их читают и слой доступа, и действие, и тесты.
// Тип по имени файла и по заявленному `Content-Type` не доверяется: решает сигнатура (первые байты файла).

/** Предел размера файла: 150 КБ. Совпадает с проверкой size_check в таблице user_avatars. */
export const AVATAR_MAX_BYTES = 150 * 1024

export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AvatarMime = (typeof AVATAR_MIME_TYPES)[number]

/** Тип по сигнатуре: JPEG — FF D8 FF; PNG — 89 50 4E 47 0D 0A 1A 0A; WebP — «RIFF», четыре байта длины, «WEBP». Иначе null. */
export function detectAvatarMime(bytes: Uint8Array): AvatarMime | null {
  const at = (i: number) => bytes[i] ?? -1
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) return 'image/png'
  if (
    bytes.length >= 12 &&
    [0x52, 0x49, 0x46, 0x46].every((b, i) => at(i) === b) &&
    [0x57, 0x45, 0x42, 0x50].every((b, i) => at(8 + i) === b)
  ) {
    return 'image/webp'
  }
  return null
}

export function isAvatarMime(value: unknown): value is AvatarMime {
  return typeof value === 'string' && (AVATAR_MIME_TYPES as readonly string[]).includes(value)
}

export type AvatarCheck = { ok: true; mime: AvatarMime } | { ok: false; reason: 'empty' | 'size' | 'type' }

/**
 * Файл годится, если он не пуст, не больше 150 КБ, заявленный тип входит в список и сигнатура — одна из трёх.
 * В базу идёт тип, найденный по сигнатуре, а не заявленный.
 */
export function checkAvatar(bytes: Uint8Array, declaredType: string): AvatarCheck {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > AVATAR_MAX_BYTES) return { ok: false, reason: 'size' }
  const mime = detectAvatarMime(bytes)
  if (!mime || !isAvatarMime(declaredType)) return { ok: false, reason: 'type' }
  return { ok: true, mime }
}

/** Тексты отказов и подтверждений на экране профиля: ключ приходит в адресе, выбирается только из этого списка. */
export const AVATAR_NOTICES = {
  saved: { text: 'Фото сохранено.', tone: 'ok' },
  deleted: { text: 'Фото удалено.', tone: 'ok' },
  empty: { text: 'Файл не выбран или пуст.', tone: 'error' },
  size: { text: 'Файл больше 150 КБ. Выберите фото поменьше.', tone: 'error' },
  type: { text: 'Подходят только JPEG, PNG и WebP.', tone: 'error' },
  fail: { text: 'Не удалось сохранить фото. Попробуйте позже.', tone: 'error' },
} as const
export type AvatarNoticeKey = keyof typeof AVATAR_NOTICES

export function isAvatarNoticeKey(value: unknown): value is AvatarNoticeKey {
  return typeof value === 'string' && Object.hasOwn(AVATAR_NOTICES, value)
}
