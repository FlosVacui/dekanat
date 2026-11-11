import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MAX_PASSWORD_LENGTH,
  SCRYPT_MAXMEM,
  describeHash,
  hashPassword,
  verifyPassword,
} from '@/server/auth/password'

// В-01: хеш пароля со всеми правилами раздела «Пароль» ADR-0003.
describe('хеш пароля', () => {
  it('верный пароль проходит, неверный — нет', async () => {
    const stored = await hashPassword('верный-пароль-1')
    expect(await verifyPassword('верный-пароль-1', stored)).toBe(true)
    expect(await verifyPassword('неверный-пароль', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
  })

  it('параметры из ADR-0003 записаны в строке хеша: scrypt, N = 2^16, r = 8, p = 2', async () => {
    const stored = await hashPassword('любой-пароль')
    expect(stored.startsWith('scrypt$N=65536,r=8,p=2,l=64$')).toBe(true)
    expect(describeHash(stored)).toEqual({ N: 65536, r: 8, p: 2, keylen: 64 })
  })

  it('пароль в строке хеша не содержится, соль своя у каждого пароля', async () => {
    const first = await hashPassword('одинаковый-пароль')
    const second = await hashPassword('одинаковый-пароль')
    expect(first).not.toContain('одинаковый-пароль')
    expect(first).not.toBe(second)
    expect(first.split('$')[2]).not.toBe(second.split('$')[2])
    expect(await verifyPassword('одинаковый-пароль', second)).toBe(true)
  })

  it('предел памяти maxmem — 128 МиБ, умолчание Node.js (32 МиБ) не используется', () => {
    expect(SCRYPT_MAXMEM).toBe(128 * 1024 * 1024)
  })

  it('пароль длиннее 256 символов — отказ до счёта хеша', async () => {
    const tooLong = 'а'.repeat(MAX_PASSWORD_LENGTH + 1)
    await expect(hashPassword(tooLong)).rejects.toThrow()
    const stored = await hashPassword('а'.repeat(MAX_PASSWORD_LENGTH))
    const started = Date.now()
    expect(await verifyPassword(tooLong, stored)).toBe(false)
    expect(Date.now() - started).toBeLessThan(50)
  })

  it('испорченная строка хеша не проходит и не роняет проверку', async () => {
    expect(await verifyPassword('x', 'не-хеш')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$N=3,r=8,p=2,l=64$AAAAAAAAAAAAAAAA$AAAA')).toBe(false)
    expect(await verifyPassword('x', 'md5$N=65536,r=8,p=2,l=64$AAAAAAAAAAAAAAAA$AAAA')).toBe(false)
  })

  it('в коде нет синхронного scrypt и сравнения хешей обычным равенством', () => {
    const source = readFileSync(new URL('../../src/server/auth/password.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/scryptSync\s*\(/)
    expect(source).not.toMatch(/import[^\n]*scryptSync/)
    expect(source).toMatch(/timingSafeEqual/)
  })
})
