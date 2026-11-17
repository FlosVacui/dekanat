// Фильтр ленты уведомлений и проверка адреса перехода (пакет 3.5). Без обращений к базе и к сессии.

export type NotificationsFilter = 'news' | 'reminders'

/** Фильтр принимается только из списка; всё остальное, в том числе повторённый параметр, — без фильтра (null, то есть «Все»). */
export function parseFilter(value: unknown): NotificationsFilter | null {
  return value === 'news' || value === 'reminders' ? value : null
}

/** Адрес экрана уведомлений с фильтром или без него. */
export function notificationsHref(filter: NotificationsFilter | null): string {
  return filter ? `/notifications?filter=${filter}` : '/notifications'
}

/**
 * Ссылка годится для перехода, только если это внутренний путь: начинается с одной косой черты, без `//` и без
 * обратной черты в начале. Управляющие символы и пробелы тоже не годятся: браузер выкидывает табуляцию и перевод строки,
 * и `/\t/evil.example` превратился бы во внешний адрес.
 */
export function safeInternalPath(link: string | null | undefined): string | null {
  if (typeof link !== 'string' || link === '') return null
  if (!link.startsWith('/') || link.startsWith('//') || link.startsWith('/\\')) return null
  // Годятся только видимые знаки ASCII без обратной черты. Знаки выше U+007F — тоже нет: U+2028 и похожие
  // ломали redirect() ответом 500 (R-3.5-4). Ссылки уведомлений в продукте — пути из латиницы, цифр и знаков URL.
  if (/[^\u0021-\u007e]|\\/.test(link)) return null
  return link
}
