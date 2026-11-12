import 'server-only'
import { isIPv4, isIPv6 } from 'node:net'

// Приведение адреса посетителя к ключу счётчика (ADR-0003). Одна функция на весь сервер: IPv6 считается по сети /64,
// потому что у одной машины их целая сеть. Всё, что не адрес («unknown», строки тестов), остаётся как есть:
// «unknown» — тоже адрес, все посетители без заголовка делят один счётчик.

const MAX_LENGTH = 64

/** Разворачивает запись IPv6 в восемь групп по 16 бит. Хвост в виде IPv4 (`::ffff:1.2.3.4`) переводится в две группы. */
function expandV6(address: string): number[] | null {
  let text = address
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted?.[1]) {
    const octets = dotted[1].split('.').map(Number)
    if (octets.some((n) => n > 255)) return null
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16)
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16)
    text = text.slice(0, text.length - dotted[1].length) + `${hi}:${lo}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  const parsed = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? Number.parseInt(g, 16) : Number.NaN))
  return parsed.length === 8 && parsed.every((n) => Number.isInteger(n)) ? parsed : null
}

/**
 * IPv4 — как есть. IPv6 — первые 64 бита, записанные одним образом: `2001:db8:0:1::`. IPv6 вида «IPv4 в IPv6»
 * (`::ffff:203.0.113.5`) — обычный IPv4. Повторный вызов на результате ничего не меняет.
 */
export function normalizeIp(ip: string): string {
  const value = ip.trim().replace(/%.*$/, '')
  if (isIPv4(value)) return value
  if (isIPv6(value)) {
    const groups = expandV6(value)
    if (groups) {
      const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff
      if (mapped) return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`
      return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::`
    }
  }
  return ip.trim().slice(0, MAX_LENGTH) || 'unknown'
}
