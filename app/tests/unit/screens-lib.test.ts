// Чистая логика экранов М0: сводка успеваемости, неделя, подписи, сроки текстов статусов.
import { describe, expect, it } from 'vitest'
import { endOfWeek, formatDayMonth, weekInfo } from '../../src/lib/dates'
import { formatAverage, summarizeGrades } from '../../src/lib/grades'
import { outcomeLabel } from '../../src/lib/labels'
import { REQUEST_KIND_INFO, computeDueDate, computePickupUntil, statusText } from '../../src/lib/requests'

describe('сводка «как у меня дела»', () => {
  it('считает сдано, долг и впереди; средний балл — по оценкам, зачёты не входят', () => {
    const s = summarizeGrades([
      { outcome: '5' },
      { outcome: '4' },
      { outcome: 'credit' },
      { outcome: 'no_credit' },
      { outcome: '2' },
      { outcome: 'pending' },
    ])
    expect(s).toEqual({ passed: 3, debt: 2, ahead: 1, average: (5 + 4 + 2) / 3 })
  })

  it('без оценок среднего нет', () => {
    expect(summarizeGrades([{ outcome: 'credit' }, { outcome: 'pending' }]).average).toBeNull()
    expect(formatAverage(null)).toBe('—')
    expect(formatAverage(4)).toBe('4,0')
  })

  it('итог по дисциплине: оценка, зачтено, не зачтено, впереди', () => {
    expect(outcomeLabel('4')).toBe('Оценка 4')
    expect(outcomeLabel('credit')).toBe('Зачтено')
    expect(outcomeLabel('no_credit')).toBe('Не зачтено')
    expect(outcomeLabel('pending')).toBe('Впереди')
  })
})

describe('даты экрана', () => {
  it('учебная неделя: нечётные верхние, чётные нижние', () => {
    expect(weekInfo('2026-09-01')).toEqual({ number: 1, kind: 'верхняя' })
    expect(weekInfo('2026-09-07')).toEqual({ number: 2, kind: 'нижняя' })
    expect(weekInfo('2026-11-11')).toEqual({ number: 11, kind: 'верхняя' })
    expect(weekInfo('2026-08-20')).toBeNull()
  })

  it('конец недели — воскресенье', () => {
    expect(endOfWeek('2026-11-11')).toBe('2026-11-15')
    expect(endOfWeek('2026-11-15')).toBe('2026-11-15')
    expect(endOfWeek('2026-11-09')).toBe('2026-11-15')
  })

  it('«12 ноября»', () => {
    expect(formatDayMonth('2026-11-12')).toBe('12 ноября')
  })
})

describe('сроки в текстах статусов — только из раздела 5 сценариев', () => {
  it('срок изготовления: 2 рабочих дня, 10 рабочих дней, 10 дней', () => {
    // 2026-11-11 — среда.
    expect(computeDueDate('dean_certificate', '2026-11-11')).toBe('2026-11-13')
    expect(computeDueDate('tuition_certificate', '2026-11-11')).toBe('2026-11-25')
    expect(computeDueDate('financial_aid', '2026-11-11')).toBe('2026-11-21')
  })

  it('«5 рабочих дней» нигде не стоит: дата «Готова» берётся от срока вида заявки', () => {
    expect(computePickupUntil('dean_certificate', '2026-11-11')).toBe('2026-11-13')
    for (const info of Object.values(REQUEST_KIND_INFO)) {
      expect(`${info.productionTime} ${info.pickup}`).not.toContain('5 рабочих')
    }
  })

  it('«Выдана» с датой', () => {
    const text = statusText({
      kind: 'dean_certificate',
      status: 'issued',
      dueDate: null,
      pickupUntil: null,
      issuedOn: '2026-11-12',
      rejectReason: null,
    })
    expect(text).toBe('Вы получили документ 12.11.2026')
  })
})
