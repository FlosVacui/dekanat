import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Части каркаса студента, которым не нужны ни база, ни сессия: шапка, нижняя панель и рамка вокруг содержимого.
// Из них собран каркас с данными (student-shell.tsx) и каркас без данных для состояний «загрузка» и «ошибка»
// (loading.tsx и error.tsx: error.tsx — клиентский компонент, серверный код в него не тянется).
// Вид — раздел 6 дизайн-системы (D-2.2-system); знак — раздел 7.

// Раздел, на котором стоит студент. Нижняя панель знает четыре первых; «Уведомления» и «Идеи и планы» есть только в колонке
// на компьютере (на телефоне — колокольчик в шапке и ссылка внизу страницы), но «активными» могут быть оба.
export type StudentTab = 'today' | 'schedule' | 'grades' | 'requests' | 'notifications' | 'ideas'
type BarTab = 'today' | 'schedule' | 'grades' | 'requests'

// Значки вкладок — простые контуры 24×24 (штрих 2, скруглённые концы), по образцу макета V-AC; встроенные, без пакета значков.
const TAB_ICONS: Record<StudentTab, ReactNode> = {
  today: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M4 10h16" />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" />
    </>
  ),
  schedule: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  grades: <path d="M5 20v-9M12 20V5M19 20v-6" />,
  requests: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </>
  ),
  notifications: (
    <>
      <path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z" />
      <path d="M10 21.5h4" />
    </>
  ),
  ideas: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </>
  ),
}

// Все разделы в одном месте: и нижняя панель, и колонка берут подписи и адреса отсюда.
const ITEMS: Record<StudentTab, { label: string; href: string }> = {
  today: { label: 'Сегодня', href: '/' },
  schedule: { label: 'Расписание', href: '/schedule' },
  grades: { label: 'Успеваемость', href: '/grades' },
  requests: { label: 'Заявки', href: '/requests' },
  notifications: { label: 'Уведомления', href: '/notifications' },
  ideas: { label: 'Идеи и планы', href: '/ideas' },
}

// Нижняя панель на телефоне: четыре вкладки.
const BAR_TABS: BarTab[] = ['today', 'schedule', 'grades', 'requests']
const TABS = BAR_TABS.map((id) => ({ id, ...ITEMS[id] }))

// Колонка на компьютере: две группы с подписями, «Идеи и планы» внизу отдельно.
const SIDE_GROUPS: { caption: string; ids: StudentTab[] }[] = [
  { caption: 'Учёба', ids: ['today', 'schedule', 'grades'] },
  { caption: 'Деканат', ids: ['requests', 'notifications'] },
]

// Рамка фокуса в шапке: 3 px, цвет --on-header (раздел 5, общие правила).
const HEADER_FOCUS = 'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-on-header'

/** Что шапка знает о студенте. Нет данных — `null`: строки группы, недели и семестра нет, у колокольчика нет числа, у аватара нет инициалов. */
export interface HeaderData {
  /** Строка под названием, собрана `headerLine`: «ИТ-23-04 · 11 неделя, верхняя · 3 семестр»; части без данных пропущены. */
  line: string
  unread: number
  initials: string
}

export function StudentHeader({ data }: { data: HeaderData | null }) {
  const unread = data?.unread ?? 0
  return (
    <header className="flex items-center gap-1 bg-header-bg px-[var(--pad-x)] pb-[var(--sp-3)] pt-[var(--sp-4)] text-on-header">
      {/* Знак 40×40 внутри круга 44×44. Подложка круга — переменная системы: прозрачная в светлой теме. */}
      <div className="grid size-11 flex-none place-items-center rounded-full bg-logo-plate">
        <Image src="/owl-128.png" alt="" width={40} height={40} unoptimized />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[length:var(--fs-md)] font-bold leading-[1.2]">Деканат в кармане</div>
        {data?.line ? <div className="text-[length:var(--fs-xs)] leading-[1.3] text-header-muted">{data.line}</div> : null}
      </div>
      <Link
        href="/notifications"
        aria-label={data ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'}
        className={cn('relative grid size-11 flex-none place-items-center rounded-full text-on-header', HEADER_FOCUS)}
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z" />
          <path d="M10 21.5h4" />
        </svg>
        {unread > 0 ? (
          <span
            data-testid="bell-count"
            className="absolute right-px top-[3px] h-5 min-w-5 rounded-full bg-accent px-[5px] text-center text-[length:var(--fs-xs)] font-extrabold leading-5 text-on-accent"
          >
            {unread}
          </span>
        ) : null}
      </Link>
      <Link
        href="/profile"
        aria-label="Профиль"
        className={cn('grid size-11 flex-none place-items-center rounded-full', HEADER_FOCUS)}
      >
        <span className="grid size-9 place-items-center rounded-full bg-avatar-bg text-[length:var(--fs-sm)] font-extrabold text-avatar-fg">
          {data?.initials ?? ''}
        </span>
      </Link>
    </header>
  )
}

export function StudentTabBar({ active }: { active: StudentTab | null }) {
  return (
    <nav
      data-tabbar
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-10 rounded-t-nav-bar border-t border-border bg-nav-bg shadow-nav lg:hidden"
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-4">
        {TABS.map((tab) => {
          const isActive = tab.id === active
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                data-tab={tab.id}
                className={cn(
                  'flex min-h-[var(--nav-h)] flex-col items-center justify-center gap-0.5 px-0 py-1.5 text-[length:var(--fs-xs)] leading-[1.2] focus-visible:outline-[3px] focus-visible:-outline-offset-4 focus-visible:outline-nav-active',
                  isActive ? 'font-bold text-nav-active' : 'font-semibold text-nav-icon',
                )}
              >
                <span
                  className={cn('grid h-8 w-[60px] place-items-center rounded-[16px]', isActive ? 'bg-nav-active-bg' : 'bg-transparent')}
                  aria-hidden="true"
                >
                  <svg focusable="false" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {TAB_ICONS[tab.id]}
                  </svg>
                </span>
                <span data-tab-label className="block w-full overflow-hidden whitespace-nowrap px-0.5 text-center">
                  {tab.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function SideLink({ id, active, unread = 0 }: { id: StudentTab; active: StudentTab | null; unread?: number }) {
  const isActive = id === active
  const item = ITEMS[id]
  return (
    <li>
      <Link
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        data-tab={id}
        className={cn(
          'flex min-h-[var(--tap)] items-center gap-[var(--sp-3)] rounded-control px-[var(--sp-3)] text-[length:var(--fs-md)] leading-[1.2] focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-nav-active',
          isActive ? 'bg-nav-active-bg font-extrabold text-nav-active' : 'font-semibold text-text hover:bg-nav-active-bg/60',
        )}
      >
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('flex-none', isActive ? 'text-nav-active' : 'text-nav-icon')}
        >
          {TAB_ICONS[id]}
        </svg>
        <span>{item.label}</span>
        {id === 'notifications' && unread > 0 ? (
          // Тот же счёт, что у колокольчика, из одного запроса каркаса. `relative` — чтобы скрытая подпись не раздвигала страницу.
          <span
            data-testid="side-count"
            className="relative ml-auto h-6 min-w-6 rounded-full bg-accent px-[7px] text-center text-[length:var(--fs-xs)] font-extrabold leading-6 text-on-accent"
          >
            <span className="sr-only">Новых: </span>
            {unread}
          </span>
        ) : null}
      </Link>
    </li>
  )
}

/**
 * Колонка разделов на компьютере, от 1024 px (220 px, от 1280 px — 240 px): группы «Учёба» и «Деканат» с подписями,
 * внизу отдельно «Идеи и планы». Нижняя панель на этой ширине скрыта (`display: none`), так что в дереве доступности
 * одна навигация «Разделы» (решение 17.11.2026, DECISIONS «Смена ролей 17.11.2026»; шаг 2 JURY-3.10; макет М5).
 */
export function StudentSideNav({ active, unread = 0 }: { active: StudentTab | null; unread?: number }) {
  return (
    <nav data-sidenav aria-label="Разделы" className="hidden border-r border-border lg:block">
      <div className="sticky top-[var(--sp-4)] flex min-h-[560px] flex-col gap-[var(--sp-4)] py-[var(--sp-4)] pl-[var(--pad-x)] pr-[var(--sp-3)]">
        {SIDE_GROUPS.map((group) => (
          <div key={group.caption} className="flex flex-col gap-0.5">
            <p className="mb-[var(--sp-1)] ml-[var(--sp-3)] text-[length:var(--fs-sm)] font-extrabold text-muted">{group.caption}</p>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {group.ids.map((id) => (
                <SideLink key={id} id={id} active={active} unread={unread} />
              ))}
            </ul>
          </div>
        ))}
        <div className="mt-auto border-t border-border pt-[var(--sp-3)]">
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            <SideLink id="ideas" active={active} />
          </ul>
        </div>
      </div>
    </nav>
  )
}

/**
 * Рамка экрана студента: шапка, середина, нижняя панель; на компьютере от 1024 px — шапка, колонка разделов и середина.
 * `data` — то, что шапка знает о студенте; `null` — каркас без данных (состояния «загрузка» и «ошибка»).
 * Ниже 1024 px после середины стоит ссылка «Идеи и планы» (макет М6): она вне навигации «Разделы» и над общим подвалом.
 */
export function StudentFrame({
  data,
  active,
  children,
  footer,
}: {
  data: HeaderData | null
  active: StudentTab | null
  children: ReactNode
  /** Строка под содержимым и ссылкой «Идеи и планы» (ссылка «Как это сделано»). Стоит в разметке до нижней панели вкладок: порядок фокуса — содержимое, ссылки, вкладки. */
  footer?: ReactNode
}) {
  const ideasActive = active === 'ideas'
  return (
    <div className="mx-auto w-full max-w-3xl lg:grid lg:max-w-[1200px] lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
      <div className="lg:col-span-2">
        <StudentHeader data={data} />
      </div>
      <StudentSideNav active={active} unread={data?.unread ?? 0} />
      <main className="min-w-0 px-[var(--pad-x)] py-[var(--sp-4)]">{children}</main>
      <div className="flex justify-center pb-[var(--sp-2)] lg:hidden">
        <Link
          href={ITEMS.ideas.href}
          aria-current={ideasActive ? 'page' : undefined}
          data-ideas-link
          className={cn(
            'inline-flex min-h-[var(--tap)] items-center justify-center rounded-pill px-[var(--sp-3)] text-[length:var(--fs-sm)]',
            ideasActive ? 'bg-nav-active-bg font-extrabold text-nav-active' : 'font-bold text-primary',
          )}
        >
          {ITEMS.ideas.label}
        </Link>
      </div>
      {footer ? <div className="lg:col-span-2">{footer}</div> : null}
      <StudentTabBar active={active} />
    </div>
  )
}
