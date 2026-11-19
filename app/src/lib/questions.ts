// Вопрос в деканат (пакет 4.1): темы, подписи, статусы и проверка текста. Чистые значения и функции: базы здесь нет.
// Список тем совпадает с проверкой `questions_topic_check` в server/dal/schema.ts; совпадение держит тест (dal-questions.test.ts).

/** Ключи пяти тем. Порядок — порядок в списке «Тема». */
export const QUESTION_TOPICS = ['schedule', 'resits', 'documents', 'stipend', 'other'] as const
export type QuestionTopic = (typeof QUESTION_TOPICS)[number]

export const QUESTION_TOPIC_LABELS: Record<QuestionTopic, string> = {
  schedule: 'Расписание и занятия',
  resits: 'Пересдачи и долги',
  documents: 'Справки и документы',
  stipend: 'Стипендия и оплата',
  other: 'Другое',
}

export function isQuestionTopic(value: unknown): value is QuestionTopic {
  return typeof value === 'string' && (QUESTION_TOPICS as readonly string[]).includes(value)
}

/** Подпись темы по ключу из базы; неизвестный ключ — общая тема «Другое». */
export function topicLabel(topic: string): string {
  return isQuestionTopic(topic) ? QUESTION_TOPIC_LABELS[topic] : QUESTION_TOPIC_LABELS.other
}

export const QUESTION_STATUSES = ['sent', 'answered'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  sent: 'Отправлен',
  answered: 'Есть ответ',
}

export function isQuestionStatus(value: unknown): value is QuestionStatus {
  return typeof value === 'string' && (QUESTION_STATUSES as readonly string[]).includes(value)
}

/** Самая длинная строка вопроса и ответа, в знаках (кодовых точках, как считает `char_length` в базе). */
export const QUESTION_MAX_LENGTH = 1000

/**
 * Текст вопроса или ответа: переводы строк приводятся к одному виду (форма браузера присылает CRLF), края обрезаются.
 * Пустой после обрезки, длиннее предела или с нулевым знаком (база его не принимает) — `null`.
 * Проверка здесь, в слое, а не только `maxlength` в форме.
 */
export function normalizeQuestionText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\r\n?/g, '\n').trim()
  if (text.length === 0 || text.includes('\u0000')) return null
  if (Array.from(text).length > QUESTION_MAX_LENGTH) return null
  return text
}
