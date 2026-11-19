// Заявка одной фразой: разбор по ключевым словам. «Сегодня» в тестах — четверг, 19.11.2026.
import { describe, expect, it } from 'vitest'
import { intentExtras, parseIntent } from '@/lib/intent'

const TODAY = '2026-11-19'

describe('parseIntent', () => {
  it('справка в налоговую к пятнице, 2 экземпляра', () => {
    const r = parseIntent('Нужна справка в налоговую к пятнице, 2 экземпляра', TODAY)
    expect(r).toMatchObject({ kind: 'dean_certificate', purpose: 'tax_office', dueDate: '2026-11-20', copies: 2, recognized: true })
    expect(r.paymentYear).toBeNull()
  })

  it('военкомат: ближайшее назначение — «по месту требования»', () => {
    const r = parseIntent('справка для военкомата', TODAY)
    expect(r).toMatchObject({ kind: 'dean_certificate', purpose: 'on_demand', recognized: true })
  })

  it('по месту требования, срок «до 25 ноября»', () => {
    const r = parseIntent('справка по месту требования до 25 ноября', TODAY)
    expect(r).toMatchObject({ kind: 'dean_certificate', purpose: 'on_demand', dueDate: '2026-11-25' })
  })

  it('об оплате для вычета за 2025 год, завтра', () => {
    const r = parseIntent('Справка об оплате обучения для налогового вычета за 2025 год, нужна завтра', TODAY)
    expect(r).toMatchObject({ kind: 'tuition_certificate', paymentYear: 2025, dueDate: '2026-11-20', purpose: null })
  })

  it('вычет за прошлый год', () => {
    const r = parseIntent('нужна справка для налогового вычета за прошлый год', TODAY)
    expect(r).toMatchObject({ kind: 'tuition_certificate', paymentYear: 2025 })
  })

  it('год раньше 2024 не принимается', () => {
    const r = parseIntent('справка об оплате за 2019 год', TODAY)
    expect(r).toMatchObject({ kind: 'tuition_certificate', paymentYear: null })
  })

  it('материальная помощь', () => {
    expect(parseIntent('хочу подать на материальную помощь', TODAY)).toMatchObject({ kind: 'financial_aid', purpose: null, recognized: true })
  })

  it('числовая дата с годом и экземпляры словом', () => {
    const r = parseIntent('справка в пенсионный фонд до 05.12.2026 в двух экземплярах', TODAY)
    expect(r).toMatchObject({ purpose: 'pension_fund', dueDate: '2026-12-05', copies: 2 })
  })

  it('дата без года, уже прошедшая, переносится на следующий год', () => {
    expect(parseIntent('справка в библиотеку к 10.03', TODAY)).toMatchObject({ purpose: 'library', dueDate: '2027-03-10' })
  })

  it('«послезавтра» и «через неделю»', () => {
    expect(parseIntent('справка в посольство послезавтра', TODAY)).toMatchObject({ purpose: 'embassy', dueDate: '2026-11-21' })
    expect(parseIntent('справка в страховую через неделю', TODAY)).toMatchObject({ purpose: 'insurance', dueDate: '2026-11-26' })
  })

  it('день недели, совпавший с сегодняшним, — следующий', () => {
    expect(parseIntent('справка в ГИБДД до четверга', TODAY)).toMatchObject({ purpose: 'traffic_police', dueDate: '2026-11-26' })
  })

  it('«по месту работы родителей» раньше «по месту работы»', () => {
    expect(parseIntent('справка по месту работы родителей', TODAY).purpose).toBe('parents_workplace')
    expect(parseIntent('справка по месту работы', TODAY).purpose).toBe('student_workplace')
  })

  it('«ё» и регистр не мешают', () => {
    expect(parseIntent('СПРАВКА В СОЦЗАЩИТУ, 3 КОПИИ', TODAY)).toMatchObject({ purpose: 'social_security', copies: 3 })
  })

  it('число в дате не принимается за число экземпляров и за год', () => {
    const r = parseIntent('справка об оплате до 25 ноября 2026', TODAY)
    expect(r).toMatchObject({ kind: 'tuition_certificate', dueDate: '2026-11-25', copies: null, paymentYear: null })
  })

  it('просто «справка» — вид без назначения', () => {
    expect(parseIntent('нужна справка', TODAY)).toMatchObject({ kind: 'dean_certificate', purpose: null, recognized: true })
  })

  it('не распознано: вид null, recognized false', () => {
    const r = parseIntent('хочу пересдать экзамен по физике', TODAY)
    expect(r).toMatchObject({ kind: null, purpose: null, paymentYear: null, recognized: false })
  })

  it('пустая строка, пробелы, не строка и неверный «сегодня»', () => {
    expect(parseIntent('', TODAY).recognized).toBe(false)
    expect(parseIntent('   ', TODAY).recognized).toBe(false)
    expect(parseIntent(42 as unknown as string, TODAY).recognized).toBe(false)
    expect(parseIntent('справка', 'вчера').recognized).toBe(false)
  })

  it('невозможная дата игнорируется', () => {
    expect(parseIntent('справка в налоговую до 31.02', TODAY).dueDate).toBeNull()
  })
})

describe('intentExtras', () => {
  it('срок и экземпляры — отдельными строками', () => {
    const r = parseIntent('справка в налоговую к пятнице, 2 экземпляра', TODAY)
    expect(intentExtras(r)).toEqual(['Срок: до 20.11.2026', 'Экземпляров: 2'])
  })
  it('нечего показать — пусто', () => {
    expect(intentExtras(parseIntent('нужна справка', TODAY))).toEqual([])
  })
})
