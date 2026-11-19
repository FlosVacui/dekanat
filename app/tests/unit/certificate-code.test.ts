// Код проверки справки: HMAC от номера заявки. Секрет в тесте — метка, не настоящее значение.
import { describe, expect, it } from 'vitest'
import { certificateCode, qrPath, shortName, verifyCertificateCode } from '@/lib/certificate'

const SECRET = 'test-secret-label-not-real'
const ID = '3f2b8c1e-9a47-4d6b-b1f0-5c8e2a7d9e10'

describe('certificateCode', () => {
  it('свой код проходит и возвращает номер заявки', () => {
    expect(verifyCertificateCode(certificateCode(ID, SECRET), SECRET)).toBe(ID)
  })

  it('номер в верхнем регистре даёт тот же код', () => {
    expect(certificateCode(ID.toUpperCase(), SECRET)).toBe(certificateCode(ID, SECRET))
  })

  it('изменённая подпись не проходит', () => {
    const [idPart, macPart] = certificateCode(ID, SECRET).split('.') as [string, string]
    const flipped = `${macPart.startsWith('A') ? 'B' : 'A'}${macPart.slice(1)}`
    expect(verifyCertificateCode(`${idPart}.${flipped}`, SECRET)).toBeNull()
  })

  it('подмена номера при прежней подписи не проходит', () => {
    const other = certificateCode('3f2b8c1e-9a47-4d6b-b1f0-5c8e2a7d9e11', SECRET)
    const mac = certificateCode(ID, SECRET).split('.')[1]
    expect(verifyCertificateCode(`${other.split('.')[0]}.${mac}`, SECRET)).toBeNull()
  })

  it('другой секрет не проходит', () => {
    expect(verifyCertificateCode(certificateCode(ID, SECRET), 'another-secret')).toBeNull()
  })

  it('мусор, пустое, не строка и слишком длинное — null', () => {
    for (const bad of ['', '.', 'abc', 'a.b.c', '%%%.%%%', 'AAAA.BBBB', undefined, null, 5, `${'a'.repeat(200)}.b`]) {
      expect(verifyCertificateCode(bad, SECRET)).toBeNull()
    }
  })

  it('код не содержит номер заявки открытым текстом', () => {
    expect(certificateCode(ID, SECRET)).not.toContain(ID.slice(0, 8))
  })

  it('пустой секрет и чужой формат номера отвергаются', () => {
    expect(() => certificateCode(ID, '')).toThrow()
    expect(() => certificateCode('не-uuid', SECRET)).toThrow()
    expect(verifyCertificateCode(certificateCode(ID, SECRET), '')).toBeNull()
  })
})

describe('shortName', () => {
  it('Фамилия И. О.', () => {
    expect(shortName('Иванов Иван Иванович')).toBe('Иванов И. И.')
    expect(shortName('  петрова   анна  сергеевна ')).toBe('петрова А. С.')
  })
  it('без отчества и одна фамилия', () => {
    expect(shortName('Иванов Иван')).toBe('Иванов И.')
    expect(shortName('Иванов')).toBe('Иванов')
    expect(shortName('')).toBe('')
  })
})

describe('qrPath', () => {
  it('даёт путь из квадратов и размер с полем', () => {
    const qr = qrPath('https://example.test/verify/abc')
    expect(qr.size).toBeGreaterThan(21)
    expect(qr.d).toMatch(/^M\d+ \d+h1v1h-1z/)
  })
  it('один и тот же адрес — один и тот же рисунок', () => {
    expect(qrPath('https://example.test/a').d).toBe(qrPath('https://example.test/a').d)
  })
})
