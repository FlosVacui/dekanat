// Вопрос к помощнику по положениям: границы и подсказки. Чистая логика, без React и сервера.

/** Длина вопроса, в знаках. */
export const ASSISTANT_QUESTION_MAX = 300

/** Четыре примера под полем вопроса. */
export const ASSISTANT_EXAMPLES: readonly string[] = [
  'Можно ли пересдать экзамен дважды?',
  'Как получить справку в военкомат?',
  'Когда назначают повышенную стипендию?',
  'Как оформить академический отпуск?',
]

/** Вопрос из адреса или формы: только строка, пробелы схлопнуты, не длиннее 300 знаков. Не строка — пустая строка. */
export function cleanQuestion(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const text = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(text).slice(0, ASSISTANT_QUESTION_MAX).join('').trim()
}

/** Текст для формы вопроса в деканат, если ответ помощника не помог. Не длиннее 1000 знаков (предел вопроса). */
export function escalationText(question: string): string {
  const q = cleanQuestion(question)
  return `${q}\n\nЯ спросил(а) помощника по положению, ответ мне не помог.`
}

/** Адрес формы «Вопрос в деканат» с подставленным текстом. */
export function escalationHref(question: string): string {
  return `/questions/new?text=${encodeURIComponent(escalationText(question))}`
}

/** Адрес помощника с вопросом: для примеров и «Спросить». */
export function assistantHref(question: string): string {
  return `/assistant?q=${encodeURIComponent(cleanQuestion(question))}`
}

/** Начало текста пункта для списка «Вот что нашлось»: до `max` знаков, обрыв по границе слова, многоточие. */
export function excerpt(text: string, max = 170): string {
  const chars = Array.from(text.trim())
  if (chars.length <= max) return text.trim()
  const cut = chars.slice(0, max)
  const lastSpace = cut.findLastIndex((c) => c === ' ')
  if (lastSpace > max / 2) cut.length = lastSpace
  return `${cut.join('').replace(/[\s,;:.\-–—]+$/u, '')}…`
}
