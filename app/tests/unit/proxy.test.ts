import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { proxy } from '@/proxy'

// Посредник: R-3.10-1 — POST без Origin отклоняется; R-3.3-3 — битая кодировка ведёт на «не найдено».
const BASE = 'http://localhost:3000'

describe('proxy', () => {
  it('POST без заголовка Origin — 403', () => {
    const res = proxy(new NextRequest(`${BASE}/notifications`, { method: 'POST' }))
    expect(res.status).toBe(403)
  })

  it('R-3.10-9: POST с Origin, который не адрес http или https, — 403', () => {
    for (const origin of ['null', 'garbage', ' ', 'file://', 'javascript:alert(1)', 'data:text/html,x', 'http//localhost:3000']) {
      const res = proxy(new NextRequest(`${BASE}/login`, { method: 'POST', headers: { origin } }))
      expect(res.status, `Origin ${JSON.stringify(origin)}`).toBe(403)
    }
  })

  it('R-3.10-9: POST с чужим, но правильным адресом пропускается — хост сверяет Next.js', () => {
    const res = proxy(new NextRequest(`${BASE}/login`, { method: 'POST', headers: { origin: 'https://evil.example' } }))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('POST с Origin пропускается дальше', () => {
    const res = proxy(new NextRequest(`${BASE}/notifications`, { method: 'POST', headers: { origin: BASE } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('GET без Origin пропускается', () => {
    const res = proxy(new NextRequest(`${BASE}/grades`))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('битая процентная кодировка — переписывается на «не найдено»', () => {
    for (const path of ['/grades/%E0%A4%A', '/grades/%']) {
      const res = proxy(new NextRequest(`${BASE}${path}`))
      expect(res.headers.get('x-middleware-rewrite'), path).toContain('/__nf')
    }
  })

  it('правильная кодировка, в том числе кириллица, не переписывается', () => {
    const res = proxy(new NextRequest(`${BASE}/requests/%D0%B0`))
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
  })
})
