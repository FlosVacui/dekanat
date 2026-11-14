// Полоса баллов. Число всегда написано рядом словами (его ставит вызывающий): полоса его дублирует, а не заменяет.
// Для экранного чтеца полоса — role="meter" с названием и значением. Отметка порога допуска — тонкая вертикальная черта.
// Баллов нет (null) — полосы нет: пустое не ноль.
export function PointsBar({ points, max, threshold }: { points: number | null; max: number; threshold: number | null }) {
  if (points === null) return null
  const share = Math.min(1, Math.max(0, points / max))
  return (
    <div
      role="meter"
      aria-label="Набрано баллов"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(max, Math.max(0, points))}
      aria-valuetext={`${points} из ${max}`}
      className="relative h-3 rounded-pill border border-border-strong bg-bg"
    >
      <div className="h-full rounded-pill bg-primary" style={{ width: `${share * 100}%` }} />
      {threshold !== null ? (
        <span
          aria-hidden="true"
          data-testid="threshold-mark"
          className="absolute -bottom-1 -top-1 w-0.5 bg-text"
          style={{ left: `${(threshold / max) * 100}%` }}
        />
      ) : null}
    </div>
  )
}
