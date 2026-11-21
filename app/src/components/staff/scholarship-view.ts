// Список стипендий для сотрудника (20.11, деканат): фильтры и поиск. Чистая логика, без базы и React.
// Статус считает `evaluateScholarship` в слое доступа; здесь только отбор из уже посчитанного списка набора.

import type { ScholarshipStatus } from '@/lib/scholarship'

export const SCHOLARSHIP_FILTERS = ['all', 'assigned', 'not_assigned', 'raised'] as const
export type ScholarshipFilter = (typeof SCHOLARSHIP_FILTERS)[number]

export const SCHOLARSHIP_FILTER_LABELS: Record<ScholarshipFilter, string> = {
  all: 'Все',
  assigned: 'Назначена',
  not_assigned: 'Не назначена',
  raised: 'Кандидаты на повышенную',
}

export interface FilterableScholarship {
  fullName: string
  status: ScholarshipStatus
}

/** Значение параметра `?show=`: не из списка (мусор, массив, пусто) — «все». */
export function parseScholarshipFilter(value: unknown): ScholarshipFilter {
  const one = Array.isArray(value) ? value[0] : value
  return typeof one === 'string' && (SCHOLARSHIP_FILTERS as readonly string[]).includes(one) ? (one as ScholarshipFilter) : 'all'
}

/** Условие по оценкам для повышенной выполнено: стипендия назначена и все экзамены прошлой сессии на «5» (п. 3.3). Решение — за комиссией. */
export function isRaisedCandidate(row: FilterableScholarship): boolean {
  return row.status.kind === 'academic' && row.status.excellent
}

export function matchesScholarshipFilter(row: FilterableScholarship, filter: ScholarshipFilter): boolean {
  if (filter === 'assigned') return row.status.kind === 'academic'
  if (filter === 'not_assigned') return row.status.kind === 'none'
  if (filter === 'raised') return isRaisedCandidate(row)
  return true
}

/** Поиск по части ФИО без учёта регистра; пустой запрос — всё. Порядок строк не меняется. */
export function filterScholarships<T extends FilterableScholarship>(rows: readonly T[], filter: ScholarshipFilter, query: string): T[] {
  const needle = query.trim().toLocaleLowerCase('ru')
  return rows.filter((r) => matchesScholarshipFilter(r, filter) && (!needle || r.fullName.toLocaleLowerCase('ru').includes(needle)))
}

/** Адрес списка с фильтром и поиском; значения по умолчанию в адрес не попадают. */
export function scholarshipsHref(filter: ScholarshipFilter, query: string): string {
  const params = new URLSearchParams()
  if (filter !== 'all') params.set('show', filter)
  if (query) params.set('q', query)
  const text = params.toString()
  return text ? `/staff/scholarships?${text}` : '/staff/scholarships'
}
