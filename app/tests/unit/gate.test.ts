import { describe, expect, it } from 'vitest'
import { BusyError, HASH_QUEUE_LIMIT, createGate } from '@/server/auth/gate'

// ADR-0003: одновременно ждут счёта не больше восьми входов; девятый сразу получает отказ.
describe('предел очереди хеша', () => {
  it('в ADR-0003 число — восемь', () => {
    expect(HASH_QUEUE_LIMIT).toBe(8)
  })

  it('девятый вход получает отказ сразу, не дожидаясь остальных', async () => {
    const gate = createGate(8)
    const releases: (() => void)[] = []
    const running = Array.from({ length: 8 }, () =>
      gate.run(() => new Promise<void>((resolve) => releases.push(resolve))),
    )
    expect(gate.pending).toBe(8)
    await expect(gate.run(async () => 'лишний')).rejects.toBeInstanceOf(BusyError)
    releases.forEach((release) => release())
    await Promise.all(running)
    expect(gate.pending).toBe(0)
    await expect(gate.run(async () => 'снова можно')).resolves.toBe('снова можно')
  })

  it('место освобождается и после ошибки в задаче', async () => {
    const gate = createGate(1)
    await expect(gate.run(async () => Promise.reject(new Error('сбой')))).rejects.toThrow('сбой')
    expect(gate.pending).toBe(0)
  })
})
