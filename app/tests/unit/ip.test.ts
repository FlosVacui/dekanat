import { describe, expect, it } from 'vitest'
import { normalizeIp } from '@/server/auth/ip'

describe('адрес посетителя: IPv6 по сети /64 одной функцией (ADR-0003)', () => {
  it('IPv4 и не-адреса остаются как есть', () => {
    expect(normalizeIp('203.0.113.5')).toBe('203.0.113.5')
    expect(normalizeIp('unknown')).toBe('unknown')
    expect(normalizeIp('test')).toBe('test')
    expect(normalizeIp('')).toBe('unknown')
    expect(normalizeIp('x'.repeat(200))).toHaveLength(64)
  })

  it('два адреса одной сети /64 дают один ключ, адреса разных сетей — разные', () => {
    const a = normalizeIp('2001:db8:1:2::1')
    const b = normalizeIp('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd')
    const c = normalizeIp('2001:db8:1:3::1')
    expect(a).toBe('2001:db8:1:2::')
    expect(b).toBe(a)
    expect(c).not.toBe(a)
  })

  it('сжатая запись, запись с нулями и зона разбираются одинаково', () => {
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8:0:0::')
    expect(normalizeIp('2001:db8:0:0:0:0:0:1')).toBe('2001:db8:0:0::')
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80:0:0:0::')
    expect(normalizeIp('::1')).toBe('0:0:0:0::')
  })

  it('IPv4 внутри IPv6 — обычный IPv4', () => {
    expect(normalizeIp('::ffff:203.0.113.5')).toBe('203.0.113.5')
    expect(normalizeIp('::ffff:cb00:7105')).toBe('203.0.113.5')
  })

  it('повторное приведение ничего не меняет', () => {
    for (const ip of ['2001:db8:1:2::1', '203.0.113.5', 'unknown', '::ffff:203.0.113.5', '2001:db8::1']) {
      const once = normalizeIp(ip)
      expect(normalizeIp(once)).toBe(once)
    }
  })
})
