// Оценка выдачи (20.11): «Как прошло?» у заявки в статусе «Выдана». Одна оценка на заявку, её можно сменить.
// В базе `requests.rating`: 1 — «👍», -1 — «👎», пусто — не оценена. Чистый модуль, без базы.

export const RATING_UP = 1
export const RATING_DOWN = -1
export type Rating = typeof RATING_UP | typeof RATING_DOWN

/** Значение кнопки формы: только эти два слова, число студент не присылает. Всё другое — null. */
export function parseRatingChoice(raw: unknown): Rating | null {
  if (raw === 'up') return RATING_UP
  if (raw === 'down') return RATING_DOWN
  return null
}

/** Значение из базы: 1, -1 или null; любое другое число (его там быть не может) — null. */
export function ratingFromDb(value: unknown): Rating | null {
  return value === RATING_UP || value === RATING_DOWN ? value : null
}
