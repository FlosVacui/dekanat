import type { NextConfig } from 'next'

// ADR-0001, ADR-0004: рабочая сборка без карт кода для браузера, без заголовка X-Powered-By,
// ключа `env` нет, порт наружу не публикуется. Заголовки безопасности и CSP — пакет 2.6.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  // forbidden() даёт ответ 403 для сотрудника на адресах студента и наоборот.
  experimental: { authInterrupts: true },
}

export default nextConfig
