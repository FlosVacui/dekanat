import type { MetadataRoute } from 'next'

// Установка на телефон (20.11, идея №81): Next.js отдаёт этот файл по адресу /manifest.webmanifest и сам ставит <link rel="manifest">.
// Цвета — из токенов светлой темы: --primary (#194CA6) и --bg (#F3F4F6). Сервис-воркера нет: приложение работает только при связи.
// Иконки лежат в public/: знак «сова» на белом фоне; maskable — со своими полями, чтобы Android не обрезал знак.
// Политика содержимого (default-src 'self') манифест и иконки со своего адреса не блокирует.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Деканат в кармане',
    short_name: 'Деканат',
    description: 'Концепт личного кабинета студента для конкурса. Не официальный сервис вуза.',
    lang: 'ru',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F3F4F6',
    theme_color: '#194CA6',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
