// 20.11, поддержка: признак тяжёлого вопроса, номера и пункты положения. Чистые функции, база не нужна.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findItem } from '@/lib/regulations/data'
import { isCrisisText, normalizeForCrisis } from '@/lib/support/crisis'
import { CRISIS_NUMBERS, CRISIS_SOURCE, EMERGENCY_NUMBER, HARDSHIP_POINTS } from '@/lib/support/data'

const POSITIVE = [
  'не хочу жить',
  'Я НЕ ХОЧУ ЖИТЬ',
  'не хочу больше жить',
  'мне кажется, я не хочу так жить',
  'жить не хочется',
  'устала жить',
  'нет смысла жить',
  'не вижу смысла в жизни',
  'жить незачем',
  'всё бессмысленно',
  'Все бессмысленно...',
  'ничто не имеет смысла',
  'хочу умереть',
  'хочется умереть, как сдать сессию вообще не думаю',
  'лучше бы умереть',
  'хочу покончить с собой',
  'думаю покончить с жизнью',
  'покончить со всем этим',
  'как убить себя',
  'мысли про суицид',
  'суицидальные мысли, что делать',
  'у друга суицидальные мысли',
  'самоубийство',
  'самоповреждение: куда обратиться',
  'порезать себя хочется',
  'хочу вскрыть вены',
  'хочу повеситься',
  'мысли спрыгнуть с крыши',
  'не хочу жить, и академ не поможет',
  'не хочу жить в общежитии, хочу умереть',
  'не хочу\nжить',
  'не хочу жить',
  'не хо​чу жить',
  'Не хочу жить.',
  'не хочу жить в этом мире',
]

const NEGATIVE = [
  'как пересдать экзамен',
  'нет смысла сдавать реферат?',
  'как покончить с долгами по физике',
  'покончить с задолженностью до конца сессии',
  'не хочу жить в общежитии',
  'не хочу жить в общаге с соседями',
  'не хочу жить с соседом, как поменять комнату',
  'надоело жить в общежитии',
  'хочу умереть со смеху от этого расписания',
  'можно ли отчислиться по собственному желанию',
  'как оформить академический отпуск',
  'нужна справка в военкомат',
  'когда стипендия',
  'как жить на стипендию',
  'можно ли жить в общежитии после отпуска',
  'это бессмысленное правило?',
  'все бессмысленные пункты положения',
  'пересдача для повышения оценки',
  'как убить время до пересдачи',
  'хочу сдать экзамен',
  'не хочу идти на пару, как отпроситься',
  'устал от сессии',
  'нет смысла в двух пересдачах?',
  'где найти положение о суммах',
  'срок вторая пересдача комиссия',
  'экзамен по микроэкономике',
  '',
  '   ',
  '?!',
]

describe('isCrisisText: признаки', () => {
  it.each(POSITIVE)('«%s» — да', (text) => {
    expect(isCrisisText(text)).toBe(true)
  })

  it.each(NEGATIVE)('«%s» — нет', (text) => {
    expect(isCrisisText(text)).toBe(false)
  })

  it('в наборах достаточно примеров', () => {
    expect(POSITIVE.length).toBeGreaterThanOrEqual(10)
    expect(NEGATIVE.length).toBeGreaterThanOrEqual(10)
  })

  it('не строка — нет, а не ошибка', () => {
    for (const value of [undefined, null, 5, {}, [], ['не хочу жить']]) expect(isCrisisText(value)).toBe(false)
  })

  it('ё и е, регистр, знаки препинания не важны', () => {
    expect(normalizeForCrisis('  ВСЁ,  бессмысленно!! ')).toBe('все бессмысленно')
    expect(isCrisisText('ВСЁ бессмысленно')).toBe(true)
    expect(isCrisisText('все бессмысленно')).toBe(true)
  })

  it('очень длинный текст не вешает проверку: учитывается начало', () => {
    const long = `${'пересдача экзамена '.repeat(5000)}не хочу жить`
    const started = Date.now()
    expect(isCrisisText(long)).toBe(false)
    expect(isCrisisText(`не хочу жить ${'а'.repeat(100_000)}`)).toBe(true)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('данные раздела «Поддержка»', () => {
  it('номера — ровно те, что в задании: 051, +7 495 051, 112', () => {
    expect(CRISIS_NUMBERS.map((n) => [n.label, n.tel, n.note])).toEqual([
      ['051', 'tel:051', 'с городского телефона, бесплатно'],
      ['+7 495 051', 'tel:+7495051', 'с мобильного, по тарифу оператора'],
    ])
    expect([EMERGENCY_NUMBER.label, EMERGENCY_NUMBER.tel, EMERGENCY_NUMBER.note]).toEqual(['112', 'tel:112', 'если есть угроза жизни'])
  })

  it('источник — mos.ru с датой сверки', () => {
    expect(CRISIS_SOURCE.text).toBe('Сверено с mos.ru 20.11.2026')
    expect(CRISIS_SOURCE.href).toBe('https://www.mos.ru/otvet-zdorovie/kak-poluchit-psihologicheskuyu-pomosch/')
  })

  it('пункты «Учёба в трудный период» есть в положении', () => {
    expect(HARDSHIP_POINTS.length).toBeGreaterThanOrEqual(3)
    expect(HARDSHIP_POINTS.length).toBeLessThanOrEqual(4)
    for (const num of HARDSHIP_POINTS) expect(findItem(num), `п. ${num}`).toBeDefined()
  })
})

const SRC = fileURLToPath(new URL('../../src', import.meta.url))

describe('охрана темы: номера и порядок вызовов в коде', () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), 'utf8')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(join(SRC, dir))) {
      const rel = `${dir}/${name}`
      if (statSync(join(SRC, rel)).isDirectory()) walk(rel)
      else if (/\.(ts|tsx)$/.test(name)) files.push(rel)
    }
  }
  walk('app')
  walk('components')
  walk('lib')
  walk('server')

  it('во всём коде приложения ссылки tel: только три: 051, +7 495 051, 112', () => {
    const found = new Set<string>()
    for (const rel of files) for (const m of src(rel).matchAll(/tel:[+\d]+/g)) found.add(m[0])
    expect([...found].sort()).toEqual(['tel:+7495051', 'tel:051', 'tel:112'])
  })

  it('помощник проверяет тяжёлый вопрос раньше, чем вызывает модель; в карточке нет «спросить деканат»', () => {
    const page = src('app/assistant/page.tsx')
    const check = page.indexOf('isCrisisText(')
    const call = page.indexOf('askRegulations(question')
    expect(check).toBeGreaterThan(0)
    expect(call).toBeGreaterThan(check)
    expect(page.indexOf("redirect('/assistant?help=1')")).toBeGreaterThan(check)
    expect(page.indexOf("redirect('/assistant?help=1')")).toBeLessThan(call)
    const card = page.slice(page.indexOf('function HelpCard'), page.indexOf('function Result'))
    expect(card).not.toMatch(/escalat|cleanQuestion|\bquestion\b/)
  })

  it('страница «Поддержка» без форм, без чтения базы и без записи', () => {
    for (const rel of ['app/support/page.tsx', 'app/support/crisis-numbers.tsx']) {
      const text = src(rel)
      expect(text, rel).not.toMatch(/<form|<input|<textarea|server\/dal|use server|use client/)
    }
  })
})
