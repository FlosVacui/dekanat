import { CRISIS_HOURS_NOTE, CRISIS_NUMBERS, CRISIS_SOURCE, EMERGENCY_NUMBER, type CrisisNumber } from '@/lib/support/data'

// Номера помощи: общий блок для страницы «Поддержка» и карточки в помощнике. Тексты и ссылки — из `lib/support/data.ts`,
// других номеров здесь нет. Это обычные ссылки `tel:`: без скриптов и без записи куда-либо.

function NumberRow({ item }: { item: CrisisNumber }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-[var(--sp-2)]">
      <a
        href={item.tel}
        data-crisis-number={item.label}
        className="inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-lg)] font-extrabold text-primary"
      >
        {item.label}
      </a>
      <span className="text-[length:var(--fs-md)] leading-[1.4]">— {item.note}</span>
    </li>
  )
}

/** Список номеров, строка о круглосуточной работе и источник со ссылкой. */
export function CrisisNumbers() {
  return (
    <div data-testid="crisis-numbers" className="flex flex-col gap-[var(--sp-1)]">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {CRISIS_NUMBERS.map((item) => (
          <NumberRow key={item.tel} item={item} />
        ))}
      </ul>
      <p className="m-0 text-[length:var(--fs-md)] font-bold leading-[1.4]">{CRISIS_HOURS_NOTE}</p>
      <ul className="m-0 mt-[var(--sp-1)] flex list-none flex-col gap-0.5 p-0">
        <NumberRow item={EMERGENCY_NUMBER} />
      </ul>
      <p className="m-0 mt-[var(--sp-1)] text-[length:var(--fs-xs)] leading-[1.35] text-muted">
        <a href={CRISIS_SOURCE.href} rel="noopener noreferrer" target="_blank" className="inline-flex min-h-[var(--tap)] items-center font-semibold text-primary underline">
          {CRISIS_SOURCE.text}
        </a>
      </p>
    </div>
  )
}
