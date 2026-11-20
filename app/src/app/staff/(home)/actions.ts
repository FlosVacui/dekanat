'use server'

import { todayIn } from '@/lib/dates'
import { aiEnabled, summarizeWeek } from '@/server/ai'
import { requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import { getCohortWeekDigest } from '@/server/dal/staff'

/** Состояние кнопки «Сводка недели от ИИ»: строки сводки или код сообщения (текст выбирает карточка). */
export interface WeekSummaryState {
  lines: string[] | null
  /** `empty` — за неделю ничего не было; `failed` — не получилось (нет ключа, предел, сбой, ответ не прошёл проверку). */
  message: 'empty' | 'failed' | null
  /** Растёт с каждым нажатием: карточка понимает, что пришёл новый ответ. */
  version: number
}

/**
 * 20.11, сводка недели. Сотрудник и его набор — из сессии; из формы не берётся ничего. Числа собирает слой доступа (только счётчики
 * по виду, статусу и теме), модели уходят они одни. Ничего не сохраняется и не отправляется. Без ключа модели — отказ без вызова.
 */
export async function weekSummaryAction(previous: WeekSummaryState): Promise<WeekSummaryState> {
  const actor = await requireStaffActor()
  const version = (typeof previous?.version === 'number' ? previous.version : 0) + 1
  if (!aiEnabled()) return { lines: null, message: 'failed', version }
  const digest = await getCohortWeekDigest(actor, todayIn(getConfig().timezone))
  const result = await summarizeWeek(digest, actor.userId)
  if (result.kind === 'summary') return { lines: result.lines, message: null, version }
  return { lines: null, message: result.kind === 'empty' ? 'empty' : 'failed', version }
}
