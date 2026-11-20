// Заявки пачкой (20.11, деканат): исход пачки в адресе и его текст. Чистая логика, без базы и React.
// Исход кладётся в параметры адреса (`?done=7&skipped=2&why=transition:1,limit:1`), форма без скриптов работает так же.
// Читаются только целые числа и коды из списка: произвольный текст из адреса на страницу не попадает.

/** За один раз — не больше стольких заявок. */
export const BULK_MAX = 50

/** Целевые статусы пачки: «В работу», «Готова», «Выдана». Отклонение (нужна причина) пачкой не делается. */
export const BULK_TARGETS = ['in_progress', 'ready', 'issued'] as const
export type BulkTarget = (typeof BULK_TARGETS)[number]

export const BULK_TARGET_LABELS: Record<BulkTarget, string> = {
  in_progress: 'В работу',
  ready: 'Готова',
  issued: 'Выдана',
}

export function isBulkTarget(value: unknown): value is BulkTarget {
  return typeof value === 'string' && (BULK_TARGETS as readonly string[]).includes(value)
}

export const LEFTOUT_REASONS = ['transition', 'limit', 'missing'] as const
export type LeftOutReason = (typeof LEFTOUT_REASONS)[number]

const LEFTOUT_TEXT: Record<LeftOutReason, string> = {
  transition: 'в этот статус их нельзя перевести',
  limit: 'лимит смен статуса в минуту',
  missing: 'заявок нет в вашем наборе',
}

/** Отказы пачки целиком: ничего не изменено. */
export const BULK_FAILURES = {
  none: 'Отметьте хотя бы одну заявку',
  many: `Отмечено больше ${BULK_MAX} заявок: уберите лишние. За один раз — не больше ${BULK_MAX}`,
  invalid: 'Выберите действие: «В работу», «Готова» или «Выдана»',
} as const
export type BulkFailure = keyof typeof BULK_FAILURES

export interface BulkOutcome {
  changed: number
  skipped: Record<LeftOutReason, number>
}

/** Параметры адреса для исхода. */
export function bulkOutcomeParams(outcome: BulkOutcome): URLSearchParams {
  const params = new URLSearchParams()
  const skipped = LEFTOUT_REASONS.reduce((sum, r) => sum + outcome.skipped[r], 0)
  params.set('done', String(outcome.changed))
  params.set('skipped', String(skipped))
  const why = LEFTOUT_REASONS.filter((r) => outcome.skipped[r] > 0).map((r) => `${r}:${outcome.skipped[r]}`)
  if (why.length > 0) params.set('why', why.join(','))
  return params
}

function oneParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

function count(value: string): number | null {
  return /^\d{1,4}$/.test(value) ? Number(value) : null
}

/** Текст исхода из параметров адреса; нет исхода или значения не по формату — null. */
export function describeBulkResult(params: { bulk?: string | string[]; done?: string | string[]; skipped?: string | string[]; why?: string | string[] }): { text: string; ok: boolean } | null {
  const failure = oneParam(params.bulk)
  if (failure !== '') return Object.hasOwn(BULK_FAILURES, failure) ? { text: BULK_FAILURES[failure as BulkFailure], ok: false } : null
  const done = count(oneParam(params.done))
  const skipped = count(oneParam(params.skipped))
  if (done === null || skipped === null) return null
  const reasons: string[] = []
  for (const part of oneParam(params.why).split(',')) {
    const [code, n] = part.split(':')
    const num = count(n ?? '')
    if ((LEFTOUT_REASONS as readonly string[]).includes(code ?? '') && num !== null) reasons.push(`${LEFTOUT_TEXT[code as LeftOutReason]} — ${num}`)
  }
  const text = skipped === 0 ? `Изменено ${done}` : `Изменено ${done}, пропущено ${skipped}${reasons.length > 0 ? `: ${reasons.join('; ')}` : ''}`
  return { text, ok: done > 0 }
}
