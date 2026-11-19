'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import {
  JURY_STEPS,
  JURY_STORAGE_KEY,
  JURY_WIDE_MIN_PX,
  currentJuryStep,
  parseStoredChoice,
  resolvePanelState,
  type JuryPanelState,
} from './steps'

// Плавающая панель «Сценарий для жюри» (идея №89): шесть шагов-ссылок, текущий подсвечен по адресу.
// Внизу справа; на телефоне и планшете (до 1024 px) стоит над нижней панелью вкладок и её не закрывает.
// По умолчанию панель открыта от 1024 px и свёрнута в кнопку уже: на телефоне она занимала бы около 380 px над вкладками.
// «Скрыть» и кнопка меняют состояние; выбор лежит в localStorage и главнее ширины (в try/catch: в закрытом режиме браузера он
// недоступен — тогда выбор живёт до перезагрузки страницы). Паролей и входа под чужим именем здесь нет: шаги — обычные ссылки.
// Пока открыта панель или кнопка, к полю прокрутки у страницы добавлен отступ снизу, чтобы элемент в фокусе не оказывался под ней.

const HIDE_ID = 'jury-panel-hide'
const CHIP_ID = 'jury-panel-chip'

// Хранилище для useSyncExternalStore: на сервере и при гидрации состояния нет (null, панель не рисуется), в браузере читается из localStorage.
const listeners = new Set<() => void>()
let chosen: JuryPanelState | null = null
const WIDE_QUERY = `(min-width: ${JURY_WIDE_MIN_PX}px)`

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== JURY_STORAGE_KEY) return
    // Другая вкладка сменила выбор: её значение главнее нашего.
    chosen = null
    onChange()
  }
  const wide = window.matchMedia(WIDE_QUERY)
  listeners.add(onChange)
  window.addEventListener('storage', onStorage)
  wide.addEventListener('change', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
    wide.removeEventListener('change', onChange)
  }
}

function readState(): JuryPanelState {
  if (chosen) return chosen
  let stored: JuryPanelState | null = null
  try {
    stored = parseStoredChoice(window.localStorage.getItem(JURY_STORAGE_KEY))
  } catch {
    // Хранилище закрыто настройками браузера — остаётся значение по умолчанию по ширине окна.
  }
  return resolvePanelState(stored, window.matchMedia(WIDE_QUERY).matches ? JURY_WIDE_MIN_PX : 0)
}

function writeState(next: JuryPanelState): void {
  chosen = next
  try {
    window.localStorage.setItem(JURY_STORAGE_KEY, next)
  } catch {
    // Запись не удалась — выбор остаётся в памяти страницы.
  }
  listeners.forEach((listener) => listener())
}

const serverState = (): JuryPanelState | null => null

/**
 * @param withTabBar внизу экрана есть панель вкладок студента (до 1024 px): панель сценария встаёт над ней.
 */
export function JuryPanel({ withTabBar = false }: { withTabBar?: boolean }) {
  const state = useSyncExternalStore(subscribe, readState, serverState)
  const pathname = usePathname()
  const box = useRef<HTMLDivElement>(null)
  const refocus = useRef<string | null>(null)

  // Отступ прокрутки: элемент в фокусе не прячется под панелью. На закрытии и размонтировании возвращается значение из таблицы стилей.
  useEffect(() => {
    const el = box.current
    if (state === null || !el) return
    const root = document.documentElement
    const apply = () => {
      root.style.scrollPaddingBottom = `${Math.ceil(window.innerHeight - el.getBoundingClientRect().top + 8)}px`
    }
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      root.style.removeProperty('scroll-padding-bottom')
    }
  }, [state])

  // Кнопка, на которой стоял фокус, исчезает при переключении: фокус переходит на парную кнопку.
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    refocus.current = null
    document.getElementById(id)?.focus()
  }, [state])

  if (state === null) return null

  const current = currentJuryStep(pathname)
  const position = cn(
    'fixed right-2 z-20 lg:right-4',
    withTabBar ? 'bottom-[calc(var(--nav-h)+var(--sp-2))] lg:bottom-4' : 'bottom-2 lg:bottom-4',
  )

  if (state === 'closed') {
    return (
      <div ref={box} className={position}>
        <button
          id={CHIP_ID}
          type="button"
          aria-expanded={false}
          onClick={() => {
            refocus.current = HIDE_ID
            writeState('open')
          }}
          className="inline-flex min-h-[var(--tap)] items-center rounded-pill border-2 border-primary bg-card px-[var(--sp-4)] text-[length:var(--fs-sm)] font-bold text-primary"
        >
          Сценарий для жюри
        </button>
      </div>
    )
  }

  const hide = () => {
    refocus.current = CHIP_ID
    writeState('closed')
  }

  return (
    <div ref={box} className={position}>
      <aside
        aria-label="Сценарий для жюри"
        data-jury-panel
        onKeyDown={(event) => {
          if (event.key === 'Escape') hide()
        }}
        className="max-h-[calc(100dvh-var(--nav-h)-var(--sp-5))] w-[min(21rem,calc(100vw-1rem))] overflow-y-auto rounded-surface border-2 border-border-strong bg-card p-[var(--sp-3)]"
      >
        <div className="flex items-center gap-[var(--sp-2)]">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[length:var(--fs-md)] font-extrabold leading-tight">Сценарий для жюри</h2>
            <p className="m-0 text-[length:var(--fs-xs)] text-muted">60 секунд, шесть шагов</p>
          </div>
          <button
            id={HIDE_ID}
            type="button"
            aria-expanded
            onClick={hide}
            className="inline-flex min-h-[var(--tap)] flex-none items-center rounded-pill bg-primary-soft px-[var(--sp-3)] text-[length:var(--fs-sm)] font-bold text-primary"
          >
            Скрыть
          </button>
        </div>
        <ol role="list" className="m-0 mt-[var(--sp-1)] flex list-none flex-col gap-0.5 p-0">
          {JURY_STEPS.map((step, index) => {
            const active = index === current
            return (
              <li key={step.href}>
                <Link
                  href={step.href}
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'flex min-h-[var(--tap)] items-center gap-[var(--sp-2)] rounded-control px-[var(--sp-2)] text-[length:var(--fs-sm)] leading-[1.25]',
                    active ? 'bg-nav-active-bg font-extrabold text-nav-active' : 'font-semibold text-text hover:bg-nav-active-bg/60',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-6 flex-none place-items-center rounded-full bg-primary-soft text-[length:var(--fs-xs)] font-extrabold text-primary"
                  >
                    {step.n}
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{step.label}</span>
                </Link>
              </li>
            )
          })}
        </ol>
        <p className="m-0 mt-[var(--sp-1)] text-[length:var(--fs-xs)] leading-[1.35] text-muted">
          Шаги 1–4 — под студентом, шаг 5 — под сотрудником. Логины — в README.
        </p>
      </aside>
    </div>
  )
}
