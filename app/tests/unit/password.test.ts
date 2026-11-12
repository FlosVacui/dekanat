import { scryptSync } from 'node:crypto'
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

  // R-2.6-4: нижняя граница параметров по таблице F13 (R-1.5). Хеши настоящие: верный пароль не должен спасать слабую строку.
  it('строка хеша с параметрами ниже таблицы F13 отклоняется, строка проекта принимается', async () => {
    const make = (N: number, r: number, p: number): string => {
      const salt = Buffer.from('0123456789abcdef')
      const derived = scryptSync('пароль-границы', salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 })
      return ['scrypt', `N=${N},r=${r},p=${p},l=64`, salt.toString('base64url'), derived.toString('base64url')].join('$')
    }
    const weak = make(2 ** 14, 8, 1)
    expect(describeHash(weak)).toBeNull()
    expect(await verifyPassword('пароль-границы', weak)).toBe(false)
    // Ниже по r при достаточных N и p.
    const lowR = make(2 ** 16, 4, 2)
    expect(describeHash(lowR)).toBeNull()
    expect(await verifyPassword('пароль-границы', lowR)).toBe(false)
    // Набор проекта и другая строка таблицы проходят.
    const project = make(2 ** 16, 8, 2)
    expect(describeHash(project)).toEqual({ N: 65536, r: 8, p: 2, keylen: 64 })
    expect(await verifyPassword('пароль-границы', project)).toBe(true)
    expect(describeHash(make(2 ** 15, 8, 3))).not.toBeNull()
  })

  it('в коде нет синхронного scrypt и сравнения хешей обычным равенством', () => {
    const source = readFileSync(new URL('../../src/server/auth/password.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/scryptSync\s*\(/)
    expect(source).not.toMatch(/import[^\n]*scryptSync/)
    expect(source).toMatch(/timingSafeEqual/)
  })
})
