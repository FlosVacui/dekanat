import { Card } from '@/components/card'
import { GradeIcon } from './icons'

// Пустое состояние (D-2.2-system, 5.5): что пусто, одна фраза зачем и что появится. Делать нечего — кнопки нет.
// Не ошибка: значок и слова не красные. Уровень заголовка задаёт место на странице: без пропуска уровней.
export function EmptyState({ title, text, level = 2 }: { title: string; text: string; level?: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <Card className="flex flex-col items-center gap-[var(--sp-2)] px-[var(--card-pad)] py-[var(--sp-5)] text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <GradeIcon name="inbox" className="size-7" />
      </span>
      <Heading className="text-[length:var(--fs-md)] font-extrabold">{title}</Heading>
      <p className="max-w-[28ch] text-[length:var(--fs-sm)] text-muted">{text}</p>
    </Card>
  )
}
