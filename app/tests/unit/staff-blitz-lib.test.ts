// 20.11, блиц: чистая логика кабинета сотрудника — меню, фильтр студентов, краткая успеваемость. Базы не нужно.
import { describe, expect, it } from 'vitest'
import { briefGrades } from '../../src/components/staff/grades-brief'
import { STAFF_NAV, activeStaffNav, isStaffArea } from '../../src/components/staff/nav-items'
import { filterStudents, oneParam } from '../../src/components/staff/students-filter'

describe('меню сотрудника', () => {
  it('шесть пунктов в заданном порядке; адреса не повторяются', () => {
    // 20.11, деканат: добавлен пункт «Стипендии» (было пять пунктов).
    expect(STAFF_NAV.map((i) => i.label)).toEqual(['Сводка', 'Заявки', 'Вопросы', 'Студенты', 'Стипендии', 'Объявления'])
    expect(new Set(STAFF_NAV.map((i) => i.href)).size).toBe(6)
  })

  it.each([
    ['/staff', null, 'summary'],
    ['/staff/', null, 'summary'],
    ['/staff/requests', null, 'requests'],
    ['/staff/requests', 'questions', 'questions'],
    ['/staff/requests', 'мусор', 'requests'],
    ['/staff/requests/9f2c', null, 'requests'],
    ['/staff/questions/9f2c', null, 'questions'],
    ['/staff/students', null, 'students'],
    ['/staff/students/9f2c', null, 'students'],
    ['/staff/scholarships', null, 'scholarships'],
    ['/staff/scholarships/print', null, 'scholarships'],
    ['/staff/announcements', null, 'announcements'],
    ['/staff/announcements?result=ok', null, 'announcements'],
  ])('адрес %s, view=%s — пункт %s', (path, view, key) => {
    expect(activeStaffNav(path, view)).toBe(key)
  })

  it('чужие адреса пункта не подсвечивают; view влияет только на экране заявок', () => {
    for (const path of ['/', '/grades', '/staffing', '/stafford/requests', '/process', '', null, undefined]) {
      expect(activeStaffNav(path as string | null | undefined)).toBeNull()
    }
    expect(activeStaffNav('/staff/students', 'questions')).toBe('students')
    expect(activeStaffNav('/staff', 'questions')).toBe('summary')
  })

  it('меню нужно только внутри /staff', () => {
    expect(isStaffArea('/staff')).toBe(true)
    expect(isStaffArea('/staff/students/1')).toBe(true)
    expect(isStaffArea('/process')).toBe(false)
    expect(isStaffArea('/staffing')).toBe(false)
    expect(isStaffArea(null)).toBe(false)
  })
})

describe('фильтр списка студентов', () => {
  const items = [
    { fullName: 'Иванов Пётр Сергеевич', groupId: 'g1' },
    { fullName: 'Петрова Анна Ильинична', groupId: 'g2' },
    { fullName: 'Ёлкин Пётр Олегович', groupId: 'g2' },
  ]
  const known = ['g1', 'g2']

  it('поиск по части ФИО без учёта регистра, в том числе «ё»', () => {
    expect(filterStudents(items, 'пётр', '', known).map((s) => s.fullName)).toEqual(['Иванов Пётр Сергеевич', 'Ёлкин Пётр Олегович'])
    expect(filterStudents(items, 'ПЕТРОВА', '', known)).toHaveLength(1)
    expect(filterStudents(items, 'ёлкин', '', known)).toHaveLength(1)
  })

  it('группа и поиск вместе; пустое — весь список', () => {
    expect(filterStudents(items, '', 'g2', known)).toHaveLength(2)
    expect(filterStudents(items, 'пётр', 'g2', known).map((s) => s.fullName)).toEqual(['Ёлкин Пётр Олегович'])
    expect(filterStudents(items, '', '', known)).toHaveLength(3)
    expect(filterStudents(items, '  ', '', known)).toHaveLength(3)
  })

  it('группа не из списка набора игнорируется, а не даёт пустой список', () => {
    expect(filterStudents(items, '', 'чужая-группа', known)).toHaveLength(3)
  })

  it('oneParam: массив — первое значение, пусто — пустая строка', () => {
    expect(oneParam(['  а ', 'б'])).toBe('а')
    expect(oneParam(undefined)).toBe('')
    expect(oneParam('  ')).toBe('')
  })
})

describe('краткая успеваемость студента', () => {
  it('долг, нехватка до допуска, допуск по признаку и сданное считаются по правилам lib/grades', () => {
    const brief = briefGrades([
      { name: 'Эконометрика', controlKind: 'exam', points: 41, outcome: '2', admitted: true },
      { name: 'Корпоративные финансы', controlKind: 'exam', points: 22, outcome: 'pending', admitted: false },
      { name: 'Микроэкономика', controlKind: 'exam', points: 41, outcome: 'pending', admitted: true },
      { name: 'Маркетинг', controlKind: 'credit', points: 72, outcome: 'credit', admitted: true },
      { name: 'Логистика', controlKind: 'credit', points: null, outcome: 'pending', admitted: false },
    ])
    expect(brief.debts).toEqual(['Эконометрика'])
    expect(brief.admission).toEqual([
      { name: 'Корпоративные финансы', text: 'не хватает 8 баллов' },
      { name: 'Логистика', text: 'допуска нет' },
    ])
    expect(brief.summary).toMatchObject({ passed: 1, debt: 1, ahead: 3 })
  })

  it('нет дисциплин — пусто', () => {
    expect(briefGrades([])).toMatchObject({ debts: [], admission: [] })
  })
})
