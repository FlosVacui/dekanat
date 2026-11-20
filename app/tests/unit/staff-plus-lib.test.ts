// 20.11, деканат: чистая логика — фильтры стипендий, исход пачки в адресе, пункты положения для ответа.
import { describe, expect, it } from 'vitest'
import { BULK_MAX, bulkOutcomeParams, describeBulkResult, isBulkTarget } from '../../src/components/staff/bulk-result'
import { HINTS_TOP, PHRASE_MAX, hintsForQuestion, pointPhrase, quotePoint } from '../../src/components/staff/regulation-hints'
import { filterScholarships, isRaisedCandidate, parseScholarshipFilter, scholarshipsHref } from '../../src/components/staff/scholarship-view'
import { REG_ITEMS, findItem } from '../../src/lib/regulations/data'
import type { ScholarshipStatus } from '../../src/lib/scholarship'

const status = (kind: 'academic' | 'none', excellent = false): ScholarshipStatus => ({
  kind,
  currentSemester: 5,
  sessionSemester: 4,
  blockers: kind === 'none' ? [{ kind: 'debt', items: [] }] : [],
  excellent,
})
const rows = [
  { fullName: 'Иванов Иван', status: status('academic', true) },
  { fullName: 'Петрова Анна', status: status('academic') },
  { fullName: 'Сидоров Пётр', status: status('none') },
]

describe('стипендии: фильтры и поиск', () => {
  it('параметр не из списка — «все»; массив — первое значение', () => {
    expect(parseScholarshipFilter(undefined)).toBe('all')
    expect(parseScholarshipFilter('мусор')).toBe('all')
    expect(parseScholarshipFilter('raised')).toBe('raised')
    expect(parseScholarshipFilter(['assigned', 'x'])).toBe('assigned')
    expect(parseScholarshipFilter({})).toBe('all')
  })

  it('назначена, не назначена и кандидаты на повышенную (назначена и все экзамены на «5»)', () => {
    expect(filterScholarships(rows, 'all', '')).toHaveLength(3)
    expect(filterScholarships(rows, 'assigned', '').map((r) => r.fullName)).toEqual(['Иванов Иван', 'Петрова Анна'])
    expect(filterScholarships(rows, 'not_assigned', '').map((r) => r.fullName)).toEqual(['Сидоров Пётр'])
    expect(filterScholarships(rows, 'raised', '').map((r) => r.fullName)).toEqual(['Иванов Иван'])
    // Не назначена — кандидатом быть не может, даже если все оценки «5».
    expect(isRaisedCandidate({ fullName: 'х', status: status('none', true) })).toBe(false)
  })

  it('поиск по части ФИО без учёта регистра, вместе с фильтром', () => {
    expect(filterScholarships(rows, 'all', 'ПЕТР').map((r) => r.fullName)).toEqual(['Петрова Анна'])
    expect(filterScholarships(rows, 'assigned', 'пётр')).toEqual([])
    expect(filterScholarships(rows, 'all', '  ').length).toBe(3)
  })

  it('адрес: значения по умолчанию в него не попадают; поиск кодируется', () => {
    expect(scholarshipsHref('all', '')).toBe('/staff/scholarships')
    expect(scholarshipsHref('raised', '')).toBe('/staff/scholarships?show=raised')
    expect(scholarshipsHref('all', 'а&б')).toBe('/staff/scholarships?q=%D0%B0%26%D0%B1')
  })
})

describe('заявки пачкой: исход в адресе', () => {
  it('целевые статусы — только три; отклонение пачкой не делается', () => {
    for (const t of ['in_progress', 'ready', 'issued']) expect(isBulkTarget(t)).toBe(true)
    for (const t of ['rejected', 'submitted', '', null, 3]) expect(isBulkTarget(t)).toBe(false)
    expect(BULK_MAX).toBe(50)
  })

  it('«изменено 7, пропущено 2: …» из параметров; чистая пачка — только «Изменено N»', () => {
    const p = bulkOutcomeParams({ changed: 7, skipped: { transition: 1, limit: 1, missing: 0 } })
    expect(p.toString()).toBe('done=7&skipped=2&why=transition%3A1%2Climit%3A1')
    const text = describeBulkResult(Object.fromEntries(p))!
    expect(text.text).toBe('Изменено 7, пропущено 2: в этот статус их нельзя перевести — 1; лимит смен статуса в минуту — 1')
    expect(text.ok).toBe(true)
    expect(describeBulkResult(Object.fromEntries(bulkOutcomeParams({ changed: 3, skipped: { transition: 0, limit: 0, missing: 0 } })))!.text).toBe('Изменено 3')
    expect(describeBulkResult({ done: '0', skipped: '2', why: 'transition:2' })!.ok).toBe(false)
  })

  it('отказы целиком; чужой текст и неверный формат из адреса на страницу не попадают', () => {
    expect(describeBulkResult({ bulk: 'none' })!.text).toContain('Отметьте')
    expect(describeBulkResult({ bulk: 'many' })!.text).toContain('50')
    expect(describeBulkResult({ bulk: '<b>x</b>' })).toBeNull()
    expect(describeBulkResult({ done: 'много', skipped: '1' })).toBeNull()
    expect(describeBulkResult({})).toBeNull()
    expect(describeBulkResult({ done: '1', skipped: '1', why: '<script>:5,transition:x' })!.text).toBe('Изменено 1, пропущено 1')
    expect(describeBulkResult({ bulk: 'constructor' })).toBeNull()
  })
})

describe('пункты положения по теме вопроса', () => {
  it('не больше трёх, пункты настоящие, у каждого фраза «Согласно п. N положения: …» и ссылка на якорь', () => {
    const hints = hintsForQuestion('Как оформить академический отпуск и что для этого нужно?')
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.length).toBeLessThanOrEqual(HINTS_TOP)
    for (const h of hints) {
      const item = findItem(h.num)!
      expect(item).toBeDefined()
      expect(h.phrase.startsWith(`Согласно п. ${h.num} положения: `)).toBe(true)
      expect(h.href).toBe(`/rules#p-${h.num.replace('.', '-')}`)
      expect(Array.from(h.phrase).length).toBeLessThanOrEqual(PHRASE_MAX + 40)
    }
    expect(hints.some((h) => h.num.startsWith('5.'))).toBe(true)
  })

  it('пустой вопрос и вопрос не по теме — пусто', () => {
    expect(hintsForQuestion('')).toEqual([])
    expect(hintsForQuestion('Какая завтра погода в Сочи?')).toEqual([])
    expect(hintsForQuestion(undefined as unknown as string)).toEqual([])
  })

  it('короткий пункт цитируется целиком, длинный — первыми предложениями без обрыва', () => {
    const short = REG_ITEMS.find((i) => Array.from(i.text).length <= PHRASE_MAX)!
    expect(quotePoint(short.text)).toBe(short.text.replace(/\s+/g, ' ').trim())
    const long = 'Первое предложение. '.repeat(40)
    const cut = quotePoint(long)
    expect(Array.from(cut).length).toBeLessThanOrEqual(PHRASE_MAX)
    expect(cut.endsWith('.')).toBe(true)
    expect(quotePoint('я'.repeat(1000), 50).endsWith('…')).toBe(true)
    // Каждая фраза пункта положения помещается в ответ студенту вместе с запасом на свои слова.
    for (const item of REG_ITEMS) expect(Array.from(pointPhrase(item)).length).toBeLessThanOrEqual(PHRASE_MAX + 40)
  })
})
