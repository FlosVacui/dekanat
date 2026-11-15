import type { ReactNode } from 'react'
import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'
import { RequestIcon } from './icons'

// Страницы «не найдено» и «нет доступа»: вид по 5.6 дизайн-системы (D-2.2-system) — карточка с круглым значком
// «внимание» 44 px на --error-bg, пояснение --fs-sm цветом --muted, кнопка с рамкой под ним. Заголовок экрана — h1 как на
// остальных экранах (раздел 6). Страница не отвечает на действие, поэтому role="alert" не ставится. Отступы — переменные
// системы: поле экрана --pad-x, верх --sp-4. Шапки и нижней панели у этих страниц нет, подвал стоит в layout.tsx.
export function NotFoundView({ title, children, href, action }: { title: string; children: ReactNode; href: string; action: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-[var(--pad-x)] py-[var(--sp-4)]">
      <PageTitle>{title}</PageTitle>
      <Card className="flex flex-col gap-[var(--sp-3)]">
        <div className="flex items-start gap-[var(--sp-3)]">
          <span className="grid size-11 flex-none place-items-center rounded-full bg-error-bg text-error">
            <RequestIcon name="alert" className="size-6" strokeWidth={2} />
          </span>
          <p className="min-w-0 pt-[var(--sp-2)] text-[length:var(--fs-sm)] text-muted">{children}</p>
        </div>
        <LinkButton href={href} variant="ghost">
          {action}
        </LinkButton>
      </Card>
    </main>
  )
}
