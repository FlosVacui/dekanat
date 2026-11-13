// Поля заявки (пакет 3.4): «Куда справка» (17 значений, R-1.6, таблица 3.2) и «Год оплаты» (с 2024 года).
import { describe, expect, it } from 'vitest'
import {
  DEAN_PURPOSES,
  DEAN_PURPOSE_KEYS,
  DEFAULT_PURPOSE,
  PAYMENT_YEAR_MIN,
  currentYearIn,
  defaultFields,
  defaultPaymentYear,
  isDeanPurpose,
  isPaymentYear,
  normalizeFields,
  parsePaymentYear,
  paymentYears,
  requestFieldLine,
  requestFieldView,
  reuseFields,
} from '@/lib/requests'

describe('«Куда справка»', () => {
  it('17 значений, порядок и слова — как в таблице 3.2 отчёта R-1.6, первая буква прописная', () => {
    expect(DEAN_PURPOSES.map((p) => p.label)).toEqual([
      'В Пенсионный фонд РФ',
      'В паспортный стол',
      'По месту работы родителей',
      'По месту работы студента',
      'В налоговую инспекцию',
      'В отдел социального обеспечения',
      'В страховую компанию',
      'В библиотеку',
      'В вуз',
      'В посольство',
      'В Мосгортранс',
      'В ГИБДД',
      'По месту требования',
      'По месту жительства',
      'В кассы РЖД',
      'Вызов в РГУ Нефти и газа',
      'О периоде обучения (с оценками, на основании заявления в деканате)',
    ])
  })

  it('в базе — ключи латиницей, без повторов', () => {
    expect(DEAN_PURPOSE_KEYS).toHaveLength(17)
    expect(new Set(DEAN_PURPOSE_KEYS).size).toBe(17)
    for (const key of DEAN_PURPOSE_KEYS) expect(key).toMatch(/^[a-z_]+$/)
  })

  it('по умолчанию — «По месту требования»', () => {
    expect(DEFAULT_PURPOSE).toBe('on_demand')
    expect(DEAN_PURPOSES.find((p) => p.key === DEFAULT_PURPOSE)?.label).toBe('По месту требования')
    expect(defaultFields('dean_certificate', 2026)).toEqual({ purpose: 'on_demand', paymentYear: null })
  })

  it('проверка значения: ключ из списка — да; подпись, пустое, число, чужое — нет', () => {
    expect(isDeanPurpose('tax_office')).toBe(true)
    expect(isDeanPurpose('В налоговую инспекцию')).toBe(false)
    expect(isDeanPurpose('')).toBe(false)
    expect(isDeanPurpose(null)).toBe(false)
    expect(isDeanPurpose(5)).toBe(false)
    expect(isDeanPurpose('tax_office; drop table requests')).toBe(false)
    expect(isDeanPurpose('constructor')).toBe(false)
  })
})

describe('«Год оплаты»', () => {
  it('годы — от 2024 до текущего включительно', () => {
    expect(PAYMENT_YEAR_MIN).toBe(2024)
    expect(paymentYears(2026)).toEqual([2024, 2025, 2026])
    expect(paymentYears(2024)).toEqual([2024])
  })

  it('по умолчанию — прошлый год, но не раньше 2024', () => {
    expect(defaultPaymentYear(2026)).toBe(2025)
    expect(defaultPaymentYear(2025)).toBe(2024)
    expect(defaultPaymentYear(2024)).toBe(2024)
    expect(defaultFields('tuition_certificate', 2026)).toEqual({ purpose: null, paymentYear: 2025 })
  })

  it('проверка: в диапазоне — да; раньше 2024, позже текущего, дробное, не число — нет', () => {
    expect(isPaymentYear(2024, 2026)).toBe(true)
    expect(isPaymentYear(2026, 2026)).toBe(true)
    expect(isPaymentYear(2023, 2026)).toBe(false)
    expect(isPaymentYear(2027, 2026)).toBe(false)
    expect(isPaymentYear(2025.5, 2026)).toBe(false)
    expect(isPaymentYear('2025', 2026)).toBe(false)
    expect(isPaymentYear(null, 2026)).toBe(false)
  })

  it('из формы год приходит строкой из четырёх цифр', () => {
    expect(parsePaymentYear('2025')).toBe(2025)
    expect(parsePaymentYear(2025)).toBe(2025)
    expect(parsePaymentYear('2025 ')).toBeNull()
    expect(parsePaymentYear('20255')).toBeNull()
    expect(parsePaymentYear('')).toBeNull()
    expect(parsePaymentYear('0x7e9')).toBeNull()
    expect(parsePaymentYear(undefined)).toBeNull()
  })

  it('текущий год — по часовому поясу вуза, а не по UTC', () => {
    const newYearEveUtc = new Date('2026-12-31T22:30:00Z')
    expect(currentYearIn('UTC', newYearEveUtc)).toBe(2026)
    expect(currentYearIn('Europe/Moscow', newYearEveUtc)).toBe(2027)
  })
})

describe('поля по виду заявки', () => {
  it('материальная помощь: полей нет, присланные значения отбрасываются', () => {
    expect(defaultFields('financial_aid', 2026)).toEqual({ purpose: null, paymentYear: null })
    expect(normalizeFields('financial_aid', { purpose: 'tax_office', paymentYear: 2025 }, 2026)).toEqual({ purpose: null, paymentYear: null })
    expect(normalizeFields('financial_aid', { purpose: 'мусор', paymentYear: 1 }, 2026)).toEqual({ purpose: null, paymentYear: null })
  })

  it('справка из деканата: не прислано — по умолчанию; из списка — принимается; не из списка — отказ; год отбрасывается', () => {
    expect(normalizeFields('dean_certificate', {}, 2026)).toEqual({ purpose: 'on_demand', paymentYear: null })
    expect(normalizeFields('dean_certificate', { purpose: null }, 2026)).toEqual({ purpose: 'on_demand', paymentYear: null })
    expect(normalizeFields('dean_certificate', { purpose: 'tax_office' }, 2026)).toEqual({ purpose: 'tax_office', paymentYear: null })
    expect(normalizeFields('dean_certificate', { purpose: 'tax_office', paymentYear: 2025 }, 2026)).toEqual({
      purpose: 'tax_office',
      paymentYear: null,
    })
    expect(normalizeFields('dean_certificate', { paymentYear: 1999 }, 2026)).toEqual({ purpose: 'on_demand', paymentYear: null })
    expect(normalizeFields('dean_certificate', { purpose: 'выдуманное' }, 2026)).toBeNull()
    expect(normalizeFields('dean_certificate', { purpose: '' }, 2026)).toBeNull()
  })

  it('справка об оплате: не прислано — прошлый год; в диапазоне — принимается; вне диапазона — отказ; назначение отбрасывается', () => {
    expect(normalizeFields('tuition_certificate', {}, 2026)).toEqual({ purpose: null, paymentYear: 2025 })
    expect(normalizeFields('tuition_certificate', { paymentYear: '2024' }, 2026)).toEqual({ purpose: null, paymentYear: 2024 })
    expect(normalizeFields('tuition_certificate', { paymentYear: 2026 }, 2026)).toEqual({ purpose: null, paymentYear: 2026 })
    expect(normalizeFields('tuition_certificate', { paymentYear: 2023 }, 2026)).toBeNull()
    expect(normalizeFields('tuition_certificate', { paymentYear: 2027 }, 2026)).toBeNull()
    expect(normalizeFields('tuition_certificate', { paymentYear: 'abc' }, 2026)).toBeNull()
    expect(normalizeFields('tuition_certificate', { paymentYear: '' }, 2026)).toBeNull()
    expect(normalizeFields('tuition_certificate', { purpose: 'tax_office' }, 2026)).toEqual({ purpose: null, paymentYear: 2025 })
  })

  it('«Подать снова»: прежнее значение подставляется; не подходит — значение по умолчанию', () => {
    expect(reuseFields('dean_certificate', { purpose: 'embassy', paymentYear: null }, 2026)).toEqual({ purpose: 'embassy', paymentYear: null })
    expect(reuseFields('dean_certificate', { purpose: 'устарело', paymentYear: null }, 2026)).toEqual({ purpose: 'on_demand', paymentYear: null })
    expect(reuseFields('tuition_certificate', { purpose: null, paymentYear: 2024 }, 2026)).toEqual({ purpose: null, paymentYear: 2024 })
    // Год вне нынешнего диапазона — по умолчанию.
    expect(reuseFields('tuition_certificate', { purpose: null, paymentYear: 2026 }, 2025)).toEqual({ purpose: null, paymentYear: 2024 })
    expect(reuseFields('tuition_certificate', { purpose: null, paymentYear: null }, 2026)).toEqual({ purpose: null, paymentYear: 2025 })
    expect(reuseFields('financial_aid', { purpose: 'embassy', paymentYear: 2025 }, 2026)).toEqual({ purpose: null, paymentYear: null })
  })
})

describe('показ поля', () => {
  it('«Куда: …» и «Год оплаты: …»; у материальной помощи строки нет', () => {
    expect(requestFieldLine('dean_certificate', { purpose: 'tax_office', paymentYear: null })).toBe('Куда: В налоговую инспекцию')
    expect(requestFieldLine('tuition_certificate', { purpose: null, paymentYear: 2025 })).toBe('Год оплаты: 2025')
    expect(requestFieldLine('financial_aid', { purpose: null, paymentYear: null })).toBeNull()
    expect(requestFieldLine('dean_certificate', { purpose: null, paymentYear: null })).toBeNull()
  })

  it('подписи поля: «Куда справка» и «Год оплаты»', () => {
    expect(requestFieldView('dean_certificate', { purpose: 'on_demand', paymentYear: null })?.title).toBe('Куда справка')
    expect(requestFieldView('tuition_certificate', { purpose: null, paymentYear: 2025 })?.title).toBe('Год оплаты')
  })
})
