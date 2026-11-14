// Адреса экрана «Расписание»: день и вид — параметры адреса. Группы и студента в адресе нет: владелец данных берётся из сессии.

/** Вид «День» на выбранный день; без дня — сегодня. */
export function dayHref(date?: string): string {
  return date ? `/schedule?day=${date}` : '/schedule'
}

/** Вид «Неделя». */
export const WEEK_HREF = '/schedule?view=week'
