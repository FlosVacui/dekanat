// Состояние «загрузка» (D-2.2-system, 5.7): карточка в `role="status"` и `aria-busy="true"`, видимая подпись, полосы скелета скрыты от чтеца.
// Время — R-1.3, Н7.1 и Н7.2: первую секунду карточки не видно (`.skel-card`), до десятой секунды не видно строки и ссылки «Обновить страницу»
// (`.skel-slow`); пульс полос — только без запрета на движение (`.skel-bar`). Правила — в globals.css, скриптов в браузере нет.
// По умолчанию всё видно, скрывает только анимация: если анимации у посетителя выключены, карточка видна сразу (R-3.7-12).
// Карточку ставят страницы в границу ожидания `<Suspense>` ниже проверки входа, а не в файл `loading.tsx` (пакет 3.7, D-2.2-system, 5.7).
// Ссылка с пустым адресом ведёт на тот же адрес, на котором стоит страница, вместе с параметрами.

const ROWS = [
  ['70%', '45%'],
  ['60%', '35%'],
  ['75%', '50%'],
] as const

export function LoadingCard({ label }: { label: string }) {
  return (
    <section role="status" aria-busy="true" className="skel-card flex flex-col gap-[var(--sp-3)] rounded-surface border border-border bg-card p-[var(--card-pad)] shadow-card">
      <p className="text-[length:var(--fs-sm)] text-muted">{label}</p>
      {ROWS.map(([first, second], index) => (
        <div key={index} aria-hidden="true" className="flex items-center gap-[var(--sp-3)]">
          <span data-skeleton className="skel-bar size-11 flex-none rounded-control bg-border" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span data-skeleton className="skel-bar block h-3.5 rounded-[7px] bg-border" style={{ width: first }} />
            <span data-skeleton className="skel-bar block h-3.5 rounded-[7px] bg-border" style={{ width: second }} />
          </span>
        </div>
      ))}
      <div className="skel-slow flex flex-col items-start gap-1 text-[length:var(--fs-sm)]">
        <p className="text-muted">Загрузка идёт дольше обычного</p>
        {/* Пустой адрес — этот же адрес: перезагрузка страницы, а не переход внутри приложения, поэтому `a`, а не `Link`. */}
        <a href="" className="inline-flex min-h-11 items-center font-bold text-primary underline">
          Обновить страницу
        </a>
      </div>
    </section>
  )
}
