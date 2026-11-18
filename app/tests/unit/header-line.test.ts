// Строка под названием в шапке (макет М5): все сочетания частей. База не нужна.
import { describe, expect, it } from 'vitest'
import { headerLine } from '../../src/lib/header-line'

const WEEK = { number: 11, kind: 'верхняя' }

describe('строка шапки: группа · неделя · семестр', () => {
  it('есть всё', () => {
    expect(headerLine({ groupName: 'ИТ-23-04', week: WEEK, semester: 3 })).toBe('ИТ-23-04 · 11 неделя, верхняя · 3 семестр')
  })

  it('нет недели: без её части и без лишнего разделителя', () => {
    expect(headerLine({ groupName: 'ИТ-23-04', week: null, semester: 3 })).toBe('ИТ-23-04 · 3 семестр')
  })

  it('нет семестра: без его части и без лишнего разделителя', () => {
    expect(headerLine({ groupName: 'ИТ-23-04', week: WEEK, semester: null })).toBe('ИТ-23-04 · 11 неделя, верхняя')
  })

  it('нет ни недели, ни семестра: одна группа', () => {
    expect(headerLine({ groupName: 'ИТ-23-04', week: null, semester: null })).toBe('ИТ-23-04')
  })

  it('нижняя неделя и другой семестр', () => {
    expect(headerLine({ groupName: 'ЭК-22-01', week: { number: 12, kind: 'нижняя' }, semester: 5 })).toBe('ЭК-22-01 · 12 неделя, нижняя · 5 семестр')
  })

  it('нет группы: разделителя в начале нет', () => {
    expect(headerLine({ groupName: '', week: WEEK, semester: 3 })).toBe('11 неделя, верхняя · 3 семестр')
    expect(headerLine({ groupName: '', week: null, semester: null })).toBe('')
  })
})
