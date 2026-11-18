// Русские подписи для значений из базы. Значения в базе — английские коды; в интерфейс идут только подписи отсюда.

const LESSON_KINDS: Record<string, string> = { lecture: 'Лекция', seminar: 'Семинар', lab: 'Лабораторная' }
export function lessonKindLabel(kind: string): string {
  return LESSON_KINDS[kind] ?? kind
}

/** Слово плашки изменения пары на экранах «Расписание» и «Сегодня»: одно-два слова, утверждены 17.11.2026 (смена 35). */
const CHANGE_BADGES: Record<string, string> = {
  cancelled: 'Отмена',
  moved: 'Перенос',
  room_changed: 'Другая аудитория',
  teacher_changed: 'Замена преподавателя',
}
export function changeBadgeLabel(kind: string): string {
  return CHANGE_BADGES[kind] ?? kind
}

export function controlKindLabel(kind: string): string {
  return kind === 'exam' ? 'Экзамен' : kind === 'credit' ? 'Зачёт' : kind
}

/** Итог по дисциплине: оценка, «зачтено», «не зачтено» или «впереди». */
export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case '5':
    case '4':
    case '3':
    case '2':
      return `Оценка ${outcome}`
    case 'credit':
      return 'Зачтено'
    case 'no_credit':
      return 'Не зачтено'
    default:
      return 'Впереди'
  }
}
