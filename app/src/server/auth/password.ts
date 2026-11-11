import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// Хеш пароля: scrypt из стандартной библиотеки Node.js (ADR-0003, раздел «Пароль»).
// Параметры заданы явно: умолчания crypto.scrypt ниже порога OWASP. Снижать N, чтобы вызов прошёл, нельзя.
// Вызов только асинхронный: scryptSync останавливал бы весь сервер на время счёта.
// Модуль без клиента базы и без чтения окружения.

export const SCRYPT_N = 2 ** 16
export const SCRYPT_R = 8
export const SCRYPT_P = 2
export const SCRYPT_KEYLEN = 64
/** Предел памяти — 128 МиБ с запасом к нужным 64 МиБ (128 · N · r байт). */
export const SCRYPT_MAXMEM = 128 * 1024 * 1024
/** Поле пароля на входе — не длиннее 256 символов: длиннее — отказ до счёта хеша. */
export const MAX_PASSWORD_LENGTH = 256

const ALGORITHM = 'scrypt'

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  })
}

function prepare(password: string): string {
  return password.normalize('NFKC')
}

/** Строка хеша: `scrypt$N=65536,r=8,p=2,l=64$<соль>$<хеш>`. Алгоритм и параметры записаны в ней, соль своя у каждого пароля. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) throw new Error('Недопустимая длина пароля')
  const salt = randomBytes(16)
  const derived = await scryptAsync(prepare(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
  return [
    ALGORITHM,
    `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P},l=${SCRYPT_KEYLEN}`,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

interface ParsedHash {
  N: number
  r: number
  p: number
  keylen: number
  salt: Buffer
  hash: Buffer
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return null
  const params = new Map<string, number>()
  for (const pair of (parts[1] ?? '').split(',')) {
    const [key, value] = pair.split('=')
    if (!key || !value || !/^\d+$/.test(value)) return null
    params.set(key, Number(value))
  }
  const N = params.get('N')
  const r = params.get('r')
  const p = params.get('p')
  const keylen = params.get('l')
  if (!N || !r || !p || !keylen) return null
  // Пределы от испорченной строки в базе: степень двойки, разумные размеры.
  if ((N & (N - 1)) !== 0 || N < 2 ** 14 || N > 2 ** 20 || r < 1 || r > 16 || p < 1 || p > 4 || keylen < 16 || keylen > 128) {
    return null
  }
  const salt = Buffer.from(parts[2] ?? '', 'base64url')
  const hash = Buffer.from(parts[3] ?? '', 'base64url')
  if (salt.length < 8 || hash.length !== keylen) return null
  return { N, r, p, keylen, salt, hash }
}

/** Сверка с постоянным временем. Неверный пароль, слишком длинный пароль и испорченная строка хеша — false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false
  const parsed = parseHash(stored)
  if (!parsed) return false
  const maxmem = Math.max(SCRYPT_MAXMEM, 256 * parsed.N * parsed.r)
  const derived = await scryptAsync(prepare(password), parsed.salt, parsed.keylen, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem,
  })
  return timingSafeEqual(derived, parsed.hash)
}

/** Разбор параметров строки хеша: для тестов и для будущей перехеширации при усилении параметров. */
export function describeHash(stored: string): { N: number; r: number; p: number; keylen: number } | null {
  const parsed = parseHash(stored)
  return parsed ? { N: parsed.N, r: parsed.r, p: parsed.p, keylen: parsed.keylen } : null
}
