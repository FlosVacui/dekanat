// Голосовой ввод (20.11, идея №17): чистая логика вокруг Web Speech API. Без React и без браузера — проверяется модульным тестом.
// Типов SpeechRecognition в стандартных типах TypeScript нет, поэтому здесь описана только та часть, которой пользуется кнопка.

export interface RecognitionAlternative {
  transcript: string
}
export interface RecognitionResult {
  readonly length: number
  readonly isFinal?: boolean
  [index: number]: RecognitionAlternative | undefined
}
export interface RecognitionEvent {
  results: { readonly length: number; [index: number]: RecognitionResult | undefined }
}
export interface RecognitionErrorEvent {
  error?: string
}
export interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type RecognitionCtor = new () => RecognitionLike

export const RECOGNITION_LANG = 'ru-RU'

/** Конструктор распознавания в окне браузера: стандартный `SpeechRecognition`, затем `webkitSpeechRecognition`. Нет — null. */
export function pickRecognitionCtor(win: unknown): RecognitionCtor | null {
  if (typeof win !== 'object' || win === null) return null
  const w = win as Record<string, unknown>
  if (typeof w.SpeechRecognition === 'function') return w.SpeechRecognition as RecognitionCtor
  if (typeof w.webkitSpeechRecognition === 'function') return w.webkitSpeechRecognition as RecognitionCtor
  return null
}

/** Склеивает все полученные куски речи в одну строку. */
export function transcriptOf(event: RecognitionEvent): string {
  const parts: string[] = []
  for (let i = 0; i < event.results.length; i += 1) {
    const text = event.results[i]?.[0]?.transcript
    if (text) parts.push(text.trim())
  }
  return parts.join(' ').trim()
}

/** Текст поля после диктовки: то, что уже было в поле до нажатия, и сказанное через пробел; не длиннее `maxLength`. */
export function composeText(base: string, spoken: string, maxLength?: number): string {
  const head = base.trim()
  const text = head && spoken ? `${head} ${spoken}` : head || spoken
  return maxLength && maxLength > 0 ? text.slice(0, maxLength) : text
}

/** Короткая строка для ошибки распознавания. `aborted` (остановил сам человек) строки не даёт. */
export function recognitionErrorText(code: string | undefined): string | null {
  switch (code) {
    case 'aborted':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Нет доступа к микрофону. Разрешите его в настройках браузера'
    case 'no-speech':
      return 'Речи не слышно. Попробуйте ещё раз'
    case 'audio-capture':
      return 'Микрофон не найден'
    case 'network':
      return 'Нет связи с сервисом распознавания речи'
    default:
      return 'Не получилось распознать речь. Попробуйте ещё раз или наберите текст'
  }
}
