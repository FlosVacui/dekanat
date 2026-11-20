// «Вам положено» на «Сегодня» (20.11): правила из положения, срок подачи, условия показа. Выдуманные оценки, «сегодня» — аргумент: базы нет.
import { describe, expect, it } from 'vitest'
import { buildEntitlements } from '../../src/lib/entitlements'
import { findItem } from '../../src/lib/regulations/data'
import { raisedWindow, type ScholarshipGrade } from '../../src/lib/scholarship'

const TODAY = '2026-11-20' // пятница

function grade(name: string, outcome: string, patch: Partial<ScholarshipGrade> = {}): ScholarshipGrade {
  return {
    disciplineId: `id-${name}`,
    name,
    controlKind: 'exam',
    outcome,
    points: 70,
    admitted: true,
    examDate: null,
    semester: 4,
    ...patch,
  }
}

/** Текущий семестр 5, сессия до 13 января; прошлый семестр 4 — то, что передали. */
function withCurrent(previous: ScholarshipGrade[]): ScholarshipGrade[] {
  return [
    grade('Микроэкономика', 'pending', { semester: 5, examDate: '2026-12-29' }),
    grade('Корпоративные финансы', 'pending', { semester: 5, examDate: '2027-01-13' }),
    ...previous,
  ]
}

const NO_REQUESTS: { kind: string; status: string }[] = []

describe('«Вам положено»: повышенная стипендия (п. 3.3)', () => {
  it('все экзамены прошлой сессии «отлично»: строка со сроком подачи из scholarship.ts и ссылкой на пункт', () => {
    const grades = withCurrent([grade('Статистика', '5'), grade('Право', '5')])
    const rows = buildEntitlements({ grades, requests: NO_REQUESTS, today: TODAY })
    expect(rows.map((r) => r.kind)).toEqual(['raised_scholarship'])
    const deadline = raisedWindow('2027-01-13', TODAY)!.deadline
    expect(deadline).toBe('2027-01-27')
    expect(rows[0]!.title).toBe('Можно подать на повышенную стипендию до 27 января')
    expect(rows[0]).toMatchObject({ point: '3.3', pointHref: '/rules#p-3-3', href: '/scholarship' })
    expect(rows[0]!.pointLabel).toBe(`п. 3.3. ${findItem('3.3')!.title}`)
  })

  it('есть четвёрка — «отлично» не по всем, строки нет', () => {
    expect(buildEntitlements({ grades: withCurrent([grade('Статистика', '5'), grade('Право', '4')]), requests: NO_REQUESTS, today: TODAY })).toEqual([])
  })

  it('срок подачи вышел (сессия кончилась давно): строки нет, а не «можно» без срока', () => {
    const grades = [
      grade('Микроэкономика', 'pending', { semester: 5, examDate: '2026-11-02' }),
      grade('Статистика', '5'),
    ]
    expect(raisedWindow('2026-11-02', TODAY)).toBeNull()
    expect(buildEntitlements({ grades, requests: NO_REQUESTS, today: TODAY })).toEqual([])
  })

  it('дат экзаменов в текущем семестре нет: строка без числа', () => {
    const grades = [grade('Микроэкономика', 'pending', { semester: 5 }), grade('Статистика', '5')]
    const rows = buildEntitlements({ grades, requests: NO_REQUESTS, today: TODAY })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.title).toBe('Можно подать на повышенную стипендию')
  })
})

describe('«Вам положено»: долг (п. 2.2) и материальная помощь (п. 3.5)', () => {
  const withDebt = withCurrent([grade('Статистика', '4'), grade('Эконометрика', '2', { examDate: '2026-11-24' })])

  it('долг: строка о неявке по уважительной причине со ссылкой на п. 2.2 и кнопкой на дисциплину', () => {
    const rows = buildEntitlements({ grades: withDebt, requests: NO_REQUESTS, today: TODAY })
    const debt = rows.find((r) => r.kind === 'debt_valid_reason')!
    expect(debt.title).toBe('Можно сдать долг по уважительной причине')
    expect(debt.point).toBe('2.2')
    expect(debt.pointHref).toBe('/rules#p-2-2')
    expect(debt.detail).toContain('«Эконометрика»')
    expect(debt.href).toBe('/grades/id-Эконометрика')
  })

  it('несколько долгов: кнопка ведёт на «Успеваемость»', () => {
    const grades = withCurrent([grade('А', '2'), grade('Б', '2')])
    const debt = buildEntitlements({ grades, requests: NO_REQUESTS, today: TODAY }).find((r) => r.kind === 'debt_valid_reason')!
    expect(debt.href).toBe('/grades')
  })

  it('стипендии нет из-за долга: после строки о долге — материальная помощь, кнопка ведёт на форму заявки', () => {
    const rows = buildEntitlements({ grades: withDebt, requests: NO_REQUESTS, today: TODAY })
    expect(rows.map((r) => r.kind)).toEqual(['debt_valid_reason', 'financial_aid'])
    expect(rows[1]).toMatchObject({ point: '3.5', href: '/requests/new?type=financial_aid', pointHref: '/rules#p-3-5' })
  })

  it('стипендии нет из-за тройки: материальная помощь есть, строки о долге нет', () => {
    const rows = buildEntitlements({ grades: withCurrent([grade('Статистика', '3'), grade('Право', '5')]), requests: NO_REQUESTS, today: TODAY })
    expect(rows.map((r) => r.kind)).toEqual(['financial_aid'])
  })

  it('открытая заявка на помощь (подана, в работе, готова) — второй строки нет; выданная и отклонённая не мешают', () => {
    for (const status of ['submitted', 'in_progress', 'ready']) {
      const rows = buildEntitlements({ grades: withDebt, requests: [{ kind: 'financial_aid', status }], today: TODAY })
      expect(rows.map((r) => r.kind), status).toEqual(['debt_valid_reason'])
    }
    for (const status of ['issued', 'rejected']) {
      const rows = buildEntitlements({ grades: withDebt, requests: [{ kind: 'financial_aid', status }], today: TODAY })
      expect(rows.map((r) => r.kind), status).toEqual(['debt_valid_reason', 'financial_aid'])
    }
    // Справка из деканата в работе помощи не заменяет.
    expect(buildEntitlements({ grades: withDebt, requests: [{ kind: 'dean_certificate', status: 'submitted' }], today: TODAY })).toHaveLength(2)
  })

  it('четвёрки и пятёрки без долгов и «отлично» не по всем: блока нет (пустой список)', () => {
    expect(buildEntitlements({ grades: withCurrent([grade('Статистика', '4'), grade('Право', '5')]), requests: NO_REQUESTS, today: TODAY })).toEqual([])
  })

  it('нет итогов прошлой сессии и нет дисциплин: строк нет', () => {
    expect(buildEntitlements({ grades: [], requests: NO_REQUESTS, today: TODAY })).toEqual([])
    expect(buildEntitlements({ grades: [grade('Микроэкономика', 'pending', { semester: 5 })], requests: NO_REQUESTS, today: TODAY })).toEqual([])
  })
})

describe('«Вам положено»: каждая строка ссылается на пункт, который есть в положении', () => {
  it('номер пункта и подпись берутся из положения', () => {
    const grades = withCurrent([grade('Эконометрика', '2')])
    for (const row of buildEntitlements({ grades, requests: NO_REQUESTS, today: TODAY })) {
      const item = findItem(row.point)
      expect(item, row.point).toBeDefined()
      expect(row.pointLabel).toContain(item!.title)
    }
  })
})
