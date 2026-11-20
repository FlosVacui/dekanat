// 20.11, блиц: правила фото профиля. Чистые функции, база не нужна.
import { describe, expect, it } from 'vitest'
import { AVATAR_MAX_BYTES, AVATAR_NOTICES, checkAvatar, detectAvatarMime, isAvatarNoticeKey } from '../../src/app/profile/avatar-rules'

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20])
const text = (s: string) => new TextEncoder().encode(s)

function padded(head: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  out.set(head)
  return out
}

describe('сигнатура файла', () => {
  it('JPEG, PNG и WebP узнаются по первым байтам', () => {
    expect(detectAvatarMime(JPEG)).toBe('image/jpeg')
    expect(detectAvatarMime(PNG)).toBe('image/png')
    expect(detectAvatarMime(WEBP)).toBe('image/webp')
  })

  it('не картинки не узнаются: текст, SVG, HTML, GIF, пусто, обрезанные начала', () => {
    expect(detectAvatarMime(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(detectAvatarMime(text('<html><script>alert(1)</script>'))).toBeNull()
    expect(detectAvatarMime(text('GIF89a\u0001\u0000'))).toBeNull()
    expect(detectAvatarMime(new Uint8Array())).toBeNull()
    expect(detectAvatarMime(Uint8Array.from([0xff, 0xd8]))).toBeNull()
    expect(detectAvatarMime(PNG.slice(0, 7))).toBeNull()
    // RIFF без WEBP — например, звук WAVE.
    expect(detectAvatarMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull()
  })
})

describe('проверка файла', () => {
  it('верный файл проходит; в ответе тип по сигнатуре', () => {
    expect(checkAvatar(JPEG, 'image/jpeg')).toEqual({ ok: true, mime: 'image/jpeg' })
    expect(checkAvatar(PNG, 'image/png')).toEqual({ ok: true, mime: 'image/png' })
    expect(checkAvatar(WEBP, 'image/webp')).toEqual({ ok: true, mime: 'image/webp' })
    // Заявленный тип в списке, но не тот: в ответе всё равно настоящий.
    expect(checkAvatar(PNG, 'image/jpeg')).toEqual({ ok: true, mime: 'image/png' })
  })

  it('пустой файл — отказ «empty»', () => {
    expect(checkAvatar(new Uint8Array(), 'image/jpeg')).toEqual({ ok: false, reason: 'empty' })
  })

  it('предел 150 КБ: ровно предел проходит, на байт больше — отказ «size»', () => {
    expect(AVATAR_MAX_BYTES).toBe(150 * 1024)
    expect(checkAvatar(padded(JPEG, AVATAR_MAX_BYTES), 'image/jpeg').ok).toBe(true)
    expect(checkAvatar(padded(JPEG, AVATAR_MAX_BYTES + 1), 'image/jpeg')).toEqual({ ok: false, reason: 'size' })
  })

  it('чужая сигнатура или тип не из списка — отказ «type»', () => {
    expect(checkAvatar(text('<svg></svg>'), 'image/jpeg')).toEqual({ ok: false, reason: 'type' })
    expect(checkAvatar(JPEG, 'image/svg+xml')).toEqual({ ok: false, reason: 'type' })
    expect(checkAvatar(JPEG, 'image/gif')).toEqual({ ok: false, reason: 'type' })
    expect(checkAvatar(JPEG, '')).toEqual({ ok: false, reason: 'type' })
    expect(checkAvatar(JPEG, 'IMAGE/JPEG')).toEqual({ ok: false, reason: 'type' })
  })
})

describe('тексты на экране', () => {
  it('ключ из адреса берётся только из списка', () => {
    for (const key of Object.keys(AVATAR_NOTICES)) expect(isAvatarNoticeKey(key)).toBe(true)
    for (const bad of ['', 'toString', '__proto__', 'constructor', undefined, ['saved'], '<b>']) expect(isAvatarNoticeKey(bad)).toBe(false)
  })
})
