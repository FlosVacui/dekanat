'use client'

// Сбой самого корневого макета: этот файл заменяет макет и обязан сам задать html и body, стили и шрифт.
// Карточка та же, что в error.tsx. Каркас без данных, вкладки не отмечены. Текста ошибки на экране нет.
// Подвал с пометкой «Концепт для конкурса, не официальный сервис вуза» — та же разметка, что в app/layout.tsx: макет заменён этим файлом,
// и без своего подвала пометка на экране ошибки пропала бы (R-3.7-15, пункт а).
import '@fontsource-variable/golos-text'
import './globals.css'
import { ErrorCard } from '@/components/states/error-card'
import { StudentFrame } from '@/components/states/shell-parts'

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="ru">
      <body>
        {/* Нижняя панель вкладок не перекрывает подвал: у страницы с панелью внизу оставлен отступ высотой с панель. */}
        <div className="flex min-h-dvh flex-col has-[[data-tabbar]]:pb-[var(--nav-h)]">
          <div className="flex-1">
            <StudentFrame data={null} active={null}>
              <ErrorCard title="Не удалось загрузить страницу" onRetry={retry} />
            </StudentFrame>
          </div>
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
