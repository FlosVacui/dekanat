import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Деканат в кармане',
  description: 'Концепт личного кабинета студента для конкурса. Не официальный сервис вуза.',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <div className="flex min-h-dvh flex-col">
          <div className="flex-1">{children}</div>
          <footer className="px-4 py-4 text-center text-xs text-neutral-600">
            Концепт для конкурса, не официальный сервис вуза
          </footer>
        </div>
      </body>
    </html>
  )
}
