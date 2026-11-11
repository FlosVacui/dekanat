import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { authenticate, normalizeLogin } from '@/server/auth/login'
import { SESSION_TTL_MS, destroySession, isActor, resolveActor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { STUDENT_A } from './fixtures'
import { withOwner } from './helpers'

afterAll(closeDb)

describe('вход', () => {
  it('верная пара даёт сессию, и действующее лицо берётся из неё', async () => {
    const outcome = await authenticate(STUDENT_A.login, STUDENT_A.password, 'test')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const actor = await resolveActor(outcome.token)
    expect(isActor(actor)).toBe(true)
    expect(actor?.role).toBe('student')
    expect(actor?.cohort).toBe('main')
    expect(actor?.groupId).toBeTruthy()
  })

  it('неверный пароль и несуществующий логин — один и тот же ответ', async () => {
    const wrongPassword = await authenticate(STUDENT_A.login, 'неверный-пароль', 'test')
    const unknownLogin = await authenticate('нет-такого-логина', 'неверный-пароль', 'test')
    expect(wrongPassword).toEqual({ ok: false, reason: 'invalid' })
    expect(unknownLogin).toEqual(wrongPassword)
  })

  it('логин приводится к одному виду: пробелы по краям и регистр', async () => {
    expect(normalizeLogin('  BeloZerov ')).toBe('belozerov')
    const outcome = await authenticate(`  ${STUDENT_A.login.toUpperCase()} `, STUDENT_A.password, 'test')
    expect(outcome.ok).toBe(true)
  })

  it('пустые и слишком длинные поля отклоняются до счёта хеша', async () => {
    expect(await authenticate('', 'x', 'test')).toEqual({ ok: false, reason: 'invalid' })
    expect(await authenticate(STUDENT_A.login, '', 'test')).toEqual({ ok: false, reason: 'invalid' })
    const started = Date.now()
    expect(await authenticate(STUDENT_A.login, 'я'.repeat(257), 'test')).toEqual({ ok: false, reason: 'invalid' })
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('сессия в базе', () => {
  it('токена в базе нет, только его хеш SHA-256; пароля и его хеша в сессии нет', async () => {
    const outcome = await authenticate(STUDENT_A.login, STUDENT_A.password, '203.0.113.5')
    if (!outcome.ok) throw new Error('вход не удался')
    const rows = await withOwner((c) => c.query('select * from sessions where token_hash = $1', [createHash('sha256').update(outcome.token).digest('hex')]))
    expect(rows.rowCount).toBe(1)
    const row = rows.rows[0]
    expect(Object.values(row).map(String).join('|')).not.toContain(outcome.token)
    expect(row.ip).toBe('203.0.113.5')
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    const ttl = new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()
    expect(Math.abs(ttl - SESSION_TTL_MS)).toBeLessThan(5_000)
  })

  it('токен — 32 байта случайных данных, каждый вход даёт новый', async () => {
    const a = await authenticate(STUDENT_A.login, STUDENT_A.password, 'test')
    const b = await authenticate(STUDENT_A.login, STUDENT_A.password, 'test')
    if (!a.ok || !b.ok) throw new Error('вход не удался')
    expect(a.token).not.toBe(b.token)
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32)
  })

  it('выход удаляет строку сессии: по старому токену больше не войти', async () => {
    const outcome = await authenticate(STUDENT_A.login, STUDENT_A.password, 'test')
    if (!outcome.ok) throw new Error('вход не удался')
    expect(await resolveActor(outcome.token)).not.toBeNull()
    await destroySession(outcome.token)
    expect(await resolveActor(outcome.token)).toBeNull()
    const rows = await withOwner((c) => c.query('select 1 from sessions where token_hash = $1', [createHash('sha256').update(outcome.token).digest('hex')]))
    expect(rows.rowCount).toBe(0)
  })

  it('просроченная сессия не принимается', async () => {
    const outcome = await authenticate(STUDENT_A.login, STUDENT_A.password, 'test')
    if (!outcome.ok) throw new Error('вход не удался')
    await withOwner((c) =>
      c.query(`update sessions set expires_at = now() - interval '1 second' where token_hash = $1`, [createHash('sha256').update(outcome.token).digest('hex')]),
    )
    expect(await resolveActor(outcome.token)).toBeNull()
  })

  it('неизвестный и выдуманный токен — не действующее лицо', async () => {
    expect(await resolveActor('выдуманный-токен')).toBeNull()
    expect(await resolveActor(undefined)).toBeNull()
    expect(await resolveActor('a'.repeat(500))).toBeNull()
  })

  it('пароль в базе — только хеш (В-01)', async () => {
    const rows = await withOwner((c) => c.query('select login, password_hash from users'))
    expect(rows.rowCount).toBeGreaterThanOrEqual(5)
    for (const row of rows.rows) {
      expect(row.password_hash).toMatch(/^scrypt\$N=65536,r=8,p=2,l=64\$/)
      expect(row.password_hash).not.toContain(STUDENT_A.password)
    }
  })
})
