import Link from 'next/link'

// Ссылка «Как это сделано» внизу оболочки (идея №90): под содержимым, над общим подвалом с пометкой «Концепт…».
export function ProcessLink() {
  return (
    <div className="flex justify-center pb-[var(--sp-2)]">
      <Link
        href="/process"
        className="inline-flex min-h-[var(--tap)] items-center justify-center rounded-pill px-[var(--sp-3)] text-[length:var(--fs-sm)] font-bold text-primary"
      >
        Как это сделано
      </Link>
    </div>
  )
}
