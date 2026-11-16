'use client'

// Сбой самого корневого макета: этот файл заменяет макет и обязан сам задать html и body, стили и шрифт.
// Карточка та же, что в error.tsx. Каркас без данных, вкладки не отмечены. Текста ошибки на экране нет.
import '@fontsource-variable/nunito'
import './globals.css'
import { ErrorCard } from '@/components/states/error-card'
import { StudentFrame } from '@/components/states/shell-parts'

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="ru">
      <body>
        <StudentFrame data={null} active={null}>
          <ErrorCard title="Не удалось загрузить страницу" onRetry={retry} />
        </StudentFrame>
      </body>
    </html>
  )
}
