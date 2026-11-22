// Код проверки справки: HMAC от номера заявки. Секрет в тесте — метка, не настоящее значение.
import { describe, expect, it } from 'vitest'
import { baseUrlFrom, certificateCode, qrPath, shortName, siteBaseUrl, studentTicketCode, verifyCertificateCode, verifyStudentTicketCode } from '@/lib/certificate'

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

  it('другое написание того же кода — биты заполнения в последнем знаке — не проходит', () => {
    // Последний знак 16 байт в base64url: 2 бита данных и 4 бита заполнения. Знак с тем же значением данных
    // и другим заполнением декодируется в те же байты: A и B, Q и R. Принимается только каноническое написание.
    const neighbour = (c: string) => String.fromCharCode(c.charCodeAt(0) + 1)
    const [idPart, macPart] = certificateCode(ID, SECRET).split('.') as [string, string]
    const macAlt = `${macPart.slice(0, -1)}${neighbour(macPart.slice(-1))}`
    const idAlt = `${idPart.slice(0, -1)}${neighbour(idPart.slice(-1))}`
    expect(Buffer.from(macAlt, 'base64url')).toEqual(Buffer.from(macPart, 'base64url'))
    expect(Buffer.from(idAlt, 'base64url')).toEqual(Buffer.from(idPart, 'base64url'))
    expect(verifyCertificateCode(`${idPart}.${macAlt}`, SECRET)).toBeNull()
    expect(verifyCertificateCode(`${idAlt}.${macPart}`, SECRET)).toBeNull()
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

// 20.11, блиц: код студенческого билета — тот же вид, другая метка назначения.
describe('studentTicketCode', () => {
  it('свой код проходит и возвращает номер студента', () => {
    expect(verifyStudentTicketCode(studentTicketCode(ID, SECRET), SECRET)).toBe(ID)
  })

  it('код справки не проходит как код билета, а код билета — как код справки (разделение назначения)', () => {
    expect(studentTicketCode(ID, SECRET)).not.toBe(certificateCode(ID, SECRET))
    expect(verifyStudentTicketCode(certificateCode(ID, SECRET), SECRET)).toBeNull()
    expect(verifyCertificateCode(studentTicketCode(ID, SECRET), SECRET)).toBeNull()
  })

  it('другой секрет, изменённая подпись, подмена номера и мусор не проходят', () => {
    const code = studentTicketCode(ID, SECRET)
    expect(verifyStudentTicketCode(code, 'other-secret-label-not-real')).toBeNull()
    const [idPart, macPart] = code.split('.') as [string, string]
    const flipped = `${macPart.startsWith('A') ? 'B' : 'A'}${macPart.slice(1)}`
    expect(verifyStudentTicketCode(`${idPart}.${flipped}`, SECRET)).toBeNull()
    const other = studentTicketCode('3f2b8c1e-9a47-4d6b-b1f0-5c8e2a7d9e11', SECRET)
    expect(verifyStudentTicketCode(`${other.split('.')[0]}.${macPart}`, SECRET)).toBeNull()
    for (const bad of [undefined, null, 42, '', '.', 'a.b', `${code}.x`, `${code}!`]) expect(verifyStudentTicketCode(bad, SECRET)).toBeNull()
    expect(verifyStudentTicketCode(code, '')).toBeNull()
  })

  it('номер не UUID — ошибка при выпуске кода', () => {
    expect(() => studentTicketCode('1; drop table students', SECRET)).toThrow()
    expect(() => studentTicketCode(ID, '')).toThrow()
  })
})

describe('siteBaseUrl', () => {
  // 22.11.2026: SITE_ADDRESS с двумя именами отвергался целиком, QR справки вёл на https://localhost:3000.
  it('одно имя — https://имя', () => {
    expect(siteBaseUrl('moy-dekanat.ru')).toBe('https://moy-dekanat.ru')
  })
  it('несколько имён через запятую или пробел — первое', () => {
    expect(siteBaseUrl('moy-dekanat.ru, www.moy-dekanat.ru')).toBe('https://moy-dekanat.ru')
    expect(siteBaseUrl('Moy-Dekanat.ru www.moy-dekanat.ru')).toBe('https://moy-dekanat.ru')
  })
  it('схема, порт 443 и косая черта отбрасываются', () => {
    expect(siteBaseUrl('https://moy-dekanat.ru:443/')).toBe('https://moy-dekanat.ru')
  })
  it('пусто, localhost и мусор — null', () => {
    expect(siteBaseUrl('')).toBeNull()
    expect(siteBaseUrl(undefined)).toBeNull()
    expect(siteBaseUrl('localhost')).toBeNull()
    expect(siteBaseUrl('moy-dekanat.ru:8080')).toBeNull()
    expect(siteBaseUrl('<script>.ru')).toBeNull()
  })
})

describe('baseUrlFrom: X-Forwarded-Host со списком', () => {
  // Страницы QR берут X-Forwarded-Host от Caddy раньше Host: за прокси Host приходил как localhost:3000.
  it('из списка имён берётся первое', () => {
    expect(baseUrlFrom('moy-dekanat.ru, localhost:3000', 'https')).toBe('https://moy-dekanat.ru')
  })
})
