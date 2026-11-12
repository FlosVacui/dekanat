import type { NextConfig } from 'next'

// ADR-0001, ADR-0004: рабочая сборка без карт кода для браузера, без заголовка X-Powered-By,
// ключа `env` нет, порт наружу не публикуется. Заголовки защиты ставятся здесь, через headers().
// Политика содержимого без одноразовой метки: Next.js вставляет свои скрипты, поэтому у скриптов 'unsafe-inline'.
// Политика с меткой — отложена, IMP-017. Режиму разработки нужен 'unsafe-eval'; в рабочей сборке его нет.

const isProduction = process.env.NODE_ENV === 'production'

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  // forbidden() даёт ответ 403 для сотрудника на адресах студента и наоборот.
  experimental: { authInterrupts: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
