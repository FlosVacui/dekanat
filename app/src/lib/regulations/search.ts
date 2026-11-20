import { REG_ITEMS, type RegItem } from './data'

// Поиск пунктов положения по вопросу студента (20.11, помощник по положениям). Чистые функции, без зависимостей.
// Слова приводятся к основе: нижний регистр, «ё» → «е», отрезаются окончания, основа — не длиннее 5 букв (короткие слова не режутся).
// Совпадение основы с заголовком пункта весит 2, с текстом — 1; сумма по разным основам вопроса. Берутся пять лучших выше порога.

/** Сколько пунктов отдаёт поиск. */
export const SEARCH_TOP = 5
/** Меньше этого счёта пункт не отдаётся: одно случайное слово из текста — не ответ. */
export const SEARCH_MIN_SCORE = 2
const STEM_MAX = 5
const STEM_MIN = 4

const WEIGHT_TITLE = 2
const WEIGHT_TEXT = 1

// Слова вопроса, которые ничего не говорят о теме. Сравниваются после приведения к нижнему регистру и замены «ё».
const STOP_WORDS = new Set([
  'как', 'что', 'чем', 'когда', 'где', 'куда', 'откуда', 'какой', 'какая', 'какие', 'какое', 'каких', 'какому', 'сколько', 'почему', 'зачем', 'кто', 'кого',
  'можно', 'нужно', 'надо', 'ли', 'мне', 'мой', 'моя', 'мои', 'моей', 'меня', 'нам', 'вам', 'вас', 'если', 'чтобы', 'есть', 'быть', 'будет', 'или', 'для', 'при',
  'про', 'над', 'под', 'без', 'это', 'эти', 'этот', 'эта', 'так', 'уже', 'еще', 'ещё', 'хочу', 'хотел', 'хотела', 'можете', 'подскажите', 'скажите', 'пожалуйста',
  'узнать', 'вообще', 'очень', 'тоже', 'также', 'после', 'перед', 'через', 'между', 'они', 'она', 'оно', 'его', 'них', 'нее', 'вот', 'тут', 'там',
  'делать', 'сделать', 'скольки', 'дают', 'дадут', 'получить', 'получают', 'получил', 'получила', 'получит', 'получение',
])

// Разговорные слова и сокращения → слово из положения. Ключи — уже в нижнем регистре и без «ё».
const SYNONYMS: Record<string, string> = {
  общага: 'общежитие',
  общаге: 'общежитие',
  общагу: 'общежитие',
  общаги: 'общежитие',
  стипуха: 'стипендия',
  стипуху: 'стипендия',
  стипухи: 'стипендия',
  стипа: 'стипендия',
  академ: 'академический',
  академа: 'академический',
  хвост: 'задолженность',
  хвосты: 'задолженность',
  хвостов: 'задолженность',
  долг: 'задолженность',
  долги: 'задолженность',
  долгов: 'задолженность',
  допуск: 'допуск',
  допса: 'пересдача',
  комиссия: 'комиссия',
  матпомощь: 'материальная помощь',
  матпомощи: 'материальная помощь',
  вылететь: 'отчисление',
  вылетят: 'отчисление',
  выгнать: 'отчисление',
  выгонят: 'отчисление',
  списать: 'списывание',
  шпаргалка: 'списывание',
  шпаргалки: 'списывание',
  шпору: 'списывание',
  физра: 'занятия',
  заболел: 'болезнь',
  заболела: 'болезнь',
  болею: 'болезнь',
  болен: 'болезнь',
  больничный: 'болезнь',
  выйти: 'выход',
  выйду: 'выход',
  вернуться: 'выход',
  пара: 'занятие',
  пары: 'занятие',
  пар: 'занятие',
}

// Окончания, от длинных к коротким. Отрезается первое подошедшее, если после него остаётся не меньше четырёх букв.
const ENDINGS = [
  'ировать', 'ования', 'ование', 'ениями', 'ениях', 'ением', 'ению', 'ения', 'ение', 'ости', 'остью', 'ость',
  'ующий', 'ующая', 'ующее', 'ующие', 'ющий', 'ющая', 'ющее', 'ющие', 'ешься', 'ишься', 'ется', 'ится', 'ются', 'ятся',
  'ому', 'ему', 'ого', 'его', 'ыми', 'ими', 'ами', 'ями', 'ать', 'ять', 'ить', 'еть', 'ыть', 'уть', 'ть',
  'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий', 'ой', 'ей', 'ую', 'юю', 'ою', 'ею', 'ом', 'ем', 'ов', 'ев', 'ам', 'ям', 'ах', 'ях', 'ых', 'их',
  'ет', 'ут', 'ют', 'ит', 'ат', 'ят', 'ла', 'ли', 'ло', 'ся', 'сь',
  'а', 'я', 'у', 'ю', 'ы', 'и', 'е', 'о', 'ь', 'й',
]

/** Нижний регистр и «ё» → «е». */
export function lowerRu(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е')
}

/** Основа слова: без окончания, не длиннее пяти букв. Слово из четырёх букв и короче остаётся как есть. */
export function stem(word: string): string {
  let w = lowerRu(word)
  if (w.length > STEM_MIN) {
    for (const ending of ENDINGS) {
      if (w.endsWith(ending) && w.length - ending.length >= STEM_MIN) {
        w = w.slice(0, w.length - ending.length)
        break
      }
    }
  }
  return w.length > STEM_MAX ? w.slice(0, STEM_MAX) : w
}

/** Слова текста: буквы и цифры, нижний регистр, «ё» → «е». */
function words(text: string): string[] {
  return lowerRu(text).split(/[^а-яa-z0-9]+/).filter(Boolean)
}

/** Слово не короче трёх знаков; латинская пара букв («QR») тоже слово. */
function isWordLong(w: string): boolean {
  return w.length >= 3 || /^[a-z]{2}$/.test(w)
}

/** Основы слов вопроса: без стоп-слов и слов короче трёх знаков, с заменой разговорных слов, без повторов. */
export function queryStems(question: string): string[] {
  const out = new Set<string>()
  for (const raw of words(question)) {
    if (STOP_WORDS.has(raw)) continue
    const mapped = SYNONYMS[raw]
    for (const w of mapped ? words(mapped) : [raw]) {
      if (!isWordLong(w) || STOP_WORDS.has(w)) continue
      out.add(stem(w))
    }
  }
  return [...out]
}

/** Основы слов любого текста — для заголовков и текстов пунктов. Стоп-слова не выбрасываются: они не совпадут с основами вопроса. */
function textStems(text: string): Set<string> {
  return new Set(words(text).filter(isWordLong).map(stem))
}

function matches(queryStem: string, stems: Set<string>): boolean {
  if (stems.has(queryStem)) return true
  // Основа в четыре буквы совпадает с пятибуквенной, если та с неё начинается: «воен» и «военк».
  for (const s of stems) {
    const [short, long] = queryStem.length <= s.length ? [queryStem, s] : [s, queryStem]
    if (short.length >= STEM_MIN && long.startsWith(short)) return true
  }
  return false
}

interface Indexed {
  item: RegItem
  title: Set<string>
  text: Set<string>
}

const INDEX: readonly Indexed[] = REG_ITEMS.map((item) => ({ item, title: textStems(item.title), text: textStems(item.text) }))

export interface Found {
  item: RegItem
  score: number
}

/**
 * Пункты положения, подходящие к вопросу: до пяти, по убыванию счёта, при равном счёте — в порядке положения.
 * Порог — не меньше двух баллов и не меньше 40 % счёта лучшего пункта. Пустой вопрос или вопрос из одних стоп-слов — пусто.
 */
export function searchRegulations(question: string): Found[] {
  const stems = queryStems(typeof question === 'string' ? question : '')
  if (stems.length === 0) return []
  const scored: Found[] = []
  for (const entry of INDEX) {
    let score = 0
    for (const q of stems) {
      if (matches(q, entry.title)) score += WEIGHT_TITLE
      if (matches(q, entry.text)) score += WEIGHT_TEXT
    }
    if (score >= SEARCH_MIN_SCORE) scored.push({ item: entry.item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored[0]?.score ?? 0
  const floor = Math.max(SEARCH_MIN_SCORE, Math.ceil(top * 0.4))
  return scored.filter((f) => f.score >= floor).slice(0, SEARCH_TOP)
}
