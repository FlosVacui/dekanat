// Код проверки справки и QR. Чистые функции: секрет передаётся аргументом, сам файл ничего не читает из окружения
// и не ходит в базу. Откуда берётся секрет и как находится заявка по коду — решает вызывающий (серверный слой).
import { createHmac, timingSafeEqual } from 'node:crypto'
import QRCode from 'qrcode'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Длина подписи в байтах: 16 из 32 — 128 бит, перебор невозможен. */
const MAC_BYTES = 16

/**
 * Подпись с меткой назначения: код справки и код студенческого билета подписаны одним секретом, но разными метками,
 * поэтому код одного назначения не проходит проверку другого (20.11, блиц).
 */
function mac(id: string, secret: string, purpose: string): Buffer {
  return createHmac('sha256', secret).update(`${purpose}:${id.toLowerCase()}`).digest().subarray(0, MAC_BYTES)
}

/**
 * Код проверки: «<номер заявки, 16 байт, base64url>.<подпись HMAC-SHA-256, 16 байт, base64url>». Номер нужен, чтобы
 * найти заявку; подделать подпись без секрета нельзя. Страница проверки номер не показывает.
 */
export function certificateCode(requestId: string, secret: string): string {
  return signedCode(requestId, secret, 'certificate')
}

function signedCode(id: string, secret: string, purpose: string): string {
  if (!UUID.test(id)) throw new Error('Номер не похож на UUID')
  if (!secret) throw new Error('Секрет пуст')
  const idPart = Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url')
  return `${idPart}.${mac(id, secret, purpose).toString('base64url')}`
}

/**
 * Номер заявки из верного кода; неверный, изменённый и мусор — null. Подписи сравниваются за постоянное время.
 * Принимается только каноническое написание base64url. Последний знак 16 байт несёт 2 бита данных и 4 бита
 * заполнения, а `Buffer.from` заполнение не проверяет. Без сверки один код имел бы четыре написания, и «изменённый»
 * последний знак иногда проходил бы проверку: 20.11.2026, смена 39.
 */
export function verifyCertificateCode(code: unknown, secret: string): string | null {
  return verifySignedCode(code, secret, 'certificate')
}

function verifySignedCode(code: unknown, secret: string, purpose: string): string | null {
  if (typeof code !== 'string' || !secret || code.length > 100) return null
  const parts = code.split('.')
  if (parts.length !== 2) return null
  const [idPart, macPart] = parts as [string, string]
  if (!/^[A-Za-z0-9_-]+$/.test(idPart) || !/^[A-Za-z0-9_-]+$/.test(macPart)) return null
  const idBytes = Buffer.from(idPart, 'base64url')
  if (idBytes.length !== 16 || idBytes.toString('base64url') !== idPart) return null
  if (Buffer.from(macPart, 'base64url').toString('base64url') !== macPart) return null
  const hex = idBytes.toString('hex')
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  const given = Buffer.from(macPart, 'base64url')
  const expected = mac(id, secret, purpose)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return id
}

/** Код проверки студенческого билета: тот же вид, что у справки, но другая метка назначения. Номер в коде — номер студента. */
export function studentTicketCode(studentId: string, secret: string): string {
  return signedCode(studentId, secret, 'student-ticket')
}

/** Номер студента из верного кода билета; код справки, изменённый код и мусор — null. */
export function verifyStudentTicketCode(code: unknown, secret: string): string | null {
  return verifySignedCode(code, secret, 'student-ticket')
}

/** «Иванов Иван Иванович» -> «Иванов И. И.»; без отчества — «Иванов И.». Пустое имя — пустая строка. */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  const [surname, ...rest] = parts
  if (!surname) return ''
  const initials = rest
    .slice(0, 2)
    .map((p) => `${Array.from(p)[0]?.toLocaleUpperCase('ru') ?? ''}.`)
    .join(' ')
  return initials ? `${surname} ${initials}` : surname
}

/**
 * QR-код со ссылкой для рисования SVG на сервере: сторона в модулях и путь `d` для одного элемента `<path>`
 * (тёмные модули — квадраты 1×1, `viewBox` — `0 0 size size` с полем по краям). Разметка собирается компонентом из этих чисел,
 * строкой HTML она не вставляется.
 */
export function qrPath(url: string, margin = 2): { size: number; d: string } {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const side = modules.size
  let d = ''
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      if (modules.get(row, col)) d += `M${col + margin} ${row + margin}h1v1h-1z`
    }
  }
  return { size: side + margin * 2, d }
}

/** Название справки на печатной странице и на странице проверки. */
export const CERTIFICATE_TITLE = 'Справка об обучении'

/**
 * Публичный адрес сайта для QR из переменной SITE_ADDRESS: `https://<первое имя>`. Caddy принимает в ней несколько адресов
 * через запятую или пробел («moy-dekanat.ru, www.moy-dekanat.ru») и адрес со схемой или портом 443 — берётся первое имя.
 * 22.11.2026: с двумя именами проверка отвергала всю строку, и QR справки вёл на https://localhost:3000. Не имя — null.
 */
export function siteBaseUrl(siteAddress: string | null | undefined): string | null {
  const first = (siteAddress ?? '').trim().toLowerCase().split(/[\s,]+/).find((s) => s !== '') ?? ''
  const site = first.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:443$/, '')
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(site) && site.includes('.') ? `https://${site}` : null
}

/**
 * Основа абсолютного адреса из заголовков запроса: `https://host`. Из списка через запятую берётся первое имя. Хост должен выглядеть как имя хоста с необязательным портом,
 * иначе — null. Протокол: из `x-forwarded-proto` (http или https), без него — http для localhost и https для остальных.
 */
export function baseUrlFrom(host: string | null, forwardedProto: string | null): string | null {
  const h = (host ?? '').split(',')[0]!.trim().toLowerCase()
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(h) && !/^\[[0-9a-f:]+\](:\d{1,5})?$/.test(h)) return null
  const proto = forwardedProto?.split(',')[0]?.trim().toLowerCase()
  const scheme = proto === 'http' || proto === 'https' ? proto : /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(h) ? 'http' : 'https'
  return `${scheme}://${h}`
}
