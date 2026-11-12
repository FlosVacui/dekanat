// Заготовка хеша для несуществующего логина (R-3.1-10): если счёт один раз упал, отклонённый промис не остаётся
// навсегда — при следующем обращении заготовка считается заново. Иначе вход по выдуманному логину бросал бы исключение,
// а по настоящему — нет, и «ошибка или неверно» выдавало бы, есть ли такой логин.
import { afterAll, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ hash: 0 }))

vi.mock('@/server/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/password')>()
  return {
    ...actual,
    hashPassword: vi.fn(async (value: string) => {
      calls.hash += 1
      // Первый счёт (при загрузке модуля входа) падает, как при нехватке памяти.
      if (calls.hash === 1) throw new Error('имитация: нехватка памяти при счёте хеша')
      return actual.hashPassword(value)
    }),
  }
})

import { authenticate } from '@/server/auth/login'
import { closeDb } from '@/server/dal/client'
import { freshIp } from './helpers'

afterAll(closeDb)

describe('заготовка хеша для выдуманного логина', () => {
  it('упавший счёт при загрузке не ломает выдуманные логины: заготовка считается заново и вход отвечает «неверно»', async () => {
    expect(calls.hash, 'счёт при загрузке модуля уже был и упал').toBe(1)
    const first = await authenticate('нет-такого-логина-заготовка', 'пароль', freshIp())
    expect(first).toEqual({ ok: false, reason: 'invalid' })
    expect(calls.hash, 'при обращении заготовка посчитана заново').toBe(2)
    // Удавшаяся заготовка запоминается: третьего счёта нет.
    expect(await authenticate('нет-такого-логина-заготовка-2', 'пароль', freshIp())).toEqual({ ok: false, reason: 'invalid' })
    expect(calls.hash).toBe(2)
  })
})
