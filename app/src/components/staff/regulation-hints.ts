// Пункты положения по теме вопроса (20.11, деканат). Чистая логика: поиск — тот же, что у помощника (`searchRegulations`), здесь только
// отбор трёх лучших и фраза для вставки в ответ. Без базы, часов и React.

import { itemHref, type RegItem } from '@/lib/regulations/data'
import { searchRegulations } from '@/lib/regulations/search'

/** Сколько пунктов показывать. */
export const HINTS_TOP = 3
/** Фраза для вставки не длиннее этого, в знаках: ответ студенту — до 1000 знаков, и место нужно ещё под свои слова. */
export const PHRASE_MAX = 420

export interface RegulationHint {
  num: string
  title: string
  href: string
  /** Готовая фраза: «Согласно п. 4.3 положения: …». */
  phrase: string
}

/** Текст пункта целиком, если помещается, иначе первые предложения до `PHRASE_MAX` знаков; обрыва посреди предложения нет. */
export function quotePoint(text: string, max = PHRASE_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (Array.from(clean).length <= max) return clean
  const sentences = clean.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [clean]
  let out = ''
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence.trim()}` : sentence.trim()
    if (Array.from(next).length > max) break
    out = next
  }
  // Первое предложение длиннее предела: обрезка по границе слова, с многоточием.
  if (!out) {
    const cut = Array.from(clean).slice(0, max - 1).join('')
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).replace(/[\s,;:.\-–—]+$/u, '')}…`
  }
  return out
}

/** «Согласно п. 4.3 положения: …». */
export function pointPhrase(item: Pick<RegItem, 'num' | 'text'>): string {
  return `Согласно п. ${item.num} положения: ${quotePoint(item.text)}`
}

/** Три лучших пункта по тексту вопроса; ничего не нашлось — пустой список. */
export function hintsForQuestion(body: string): RegulationHint[] {
  return searchRegulations(body)
    .slice(0, HINTS_TOP)
    .map(({ item }) => ({ num: item.num, title: item.title, href: itemHref(item.num), phrase: pointPhrase(item) }))
}
