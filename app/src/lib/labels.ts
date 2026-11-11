// Русские подписи для значений из базы. Значения в базе — английские коды; в интерфейс идут только подписи отсюда.

const LESSON_KINDS: Record<string, string> = { lecture: 'Лекция', seminar: 'Семинар', lab: 'Лабораторная' }
export function lessonKindLabel(kind: string): string {
  return LESSON_KINDS[kind] ?? kind
}

const CHANGE_KINDS: Record<string, string> = {
  cancelled: 'Пара отменена',
  moved: 'Пара перенесена',
  room_changed: 'Сменилась аудитория',
  teacher_changed: 'Сменился преподаватель',
}
export function changeKindLabel(kind: string): string {
  return CHANGE_KINDS[kind] ?? kind
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
