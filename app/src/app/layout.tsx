import type { Metadata, Viewport } from 'next'
// Шрифт Golos Text: файлы лежат в пакете npm и отдаются своим сервером, внешних адресов нет (D-2.2-system, раздел 3).
// Пакет объявляет семейство «Golos Text Variable»; браузер грузит файл набора знаков только когда в тексте есть такие знаки.
import '@fontsource-variable/golos-text'
import './globals.css'

export const metadata: Metadata = {
  title: 'Деканат в кармане',
  description: 'Концепт личного кабинета студента для конкурса. Не официальный сервис вуза.',
  // Значок вкладки: два размера из папки public (знак «сова», D-2.2-system, раздел 7).
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        {/* Нижняя панель вкладок не перекрывает подвал: у страницы с панелью внизу оставлен отступ высотой с панель. */}
        <div className="flex min-h-dvh flex-col has-[[data-tabbar]]:pb-[var(--nav-h)] lg:has-[[data-tabbar]]:pb-0">
          <div className="flex-1">{children}</div>
          <footer className="flex items-start justify-center gap-1.5 px-[var(--pad-x)] pb-[var(--sp-4)] pt-[var(--sp-3)] text-center text-[length:var(--fs-xs)] leading-[1.4] text-muted">
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              className="mt-px flex-none"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 7.8v.1" />
            </svg>
            <span>Концепт для конкурса, не официальный сервис вуза</span>
          </footer>
        </div>
      </body>
    </html>
  )
}
