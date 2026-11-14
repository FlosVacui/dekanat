import { Card } from '@/components/card'
import { ScheduleIcon } from './icons'

// Пустое состояние дня (D-2.2-system, 5.5): что пусто, одна фраза зачем и что дальше. Делать нечего — кнопки нет.
// Не ошибка: значок и слова не красные.
export function EmptyDay({ isToday }: { isToday: boolean }) {
  return (
    <Card className="flex flex-col items-center gap-[var(--sp-2)] px-[var(--card-pad)] py-[var(--sp-5)] text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <ScheduleIcon name="inbox" className="size-7" />
      </span>
      <h2 className="text-[length:var(--fs-md)] font-extrabold">{isToday ? 'Сегодня пар нет' : 'В этот день пар нет'}</h2>
      <p className="max-w-[28ch] text-[length:var(--fs-sm)] text-muted">Загляните в другой день: пары и изменения лежат в полосе выше.</p>
    </Card>
  )
}
