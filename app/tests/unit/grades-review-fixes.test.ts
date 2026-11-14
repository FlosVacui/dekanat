// Правки пакета 3.3 по ревью RV-3.3-1: замечания R-3.3-1, R-3.3-4, R-3.3-5, R-3.3-6.
// Каждый тест сначала написан так, чтобы показать ошибку, и только потом исправлено.
// Даты передаются аргументами: день запуска не важен.
import { describe, expect, it } from 'vitest'
import {
  describeDiscipline,
  displayPoints,
  examPointsForGrades,
  examTargetLine,
  examTargetsForDiscipline,
  firstActionText,
  pickFirstAction,
  sessionWhenLine,
  summaryPhrase,
  type DisciplineStateInput,
  type FirstActionInput,
} from '../../src/lib/grades'

const TODAY = '2026-11-14'

function exam(patch: Partial<DisciplineStateInput> = {}): DisciplineStateInput {
  return { controlKind: 'exam', outcome: 'pending', points: 45, admitted: true, ...patch }
}

function row(name: string, patch: Partial<FirstActionInput> = {}): FirstActionInput {
  return { disciplineId: `id-${name}`, name, controlKind: 'exam', outcome: 'pending', points: 41, admitted: true, examDate: null, ...patch }
}

describe('R-3.3-1: «что нужно на экзамене» при признаке допуска «нет»', () => {
  it('экзамен без итога, 45 баллов, признак «нет»: все три строки — «сначала нужен допуск», числа баллов нет', () => {
    const d = exam({ points: 45, admitted: false })
    // Строка состояния говорит «нет допуска»: блок берёт тот же ответ.
    expect(describeDiscipline(d).kind).toBe('ahead_no_admission')
    const targets = examTargetsForDiscipline(d)
    expect(targets.map((t) => t.grade)).toEqual([3, 4, 5])
    expect(targets.every((t) => t.status === 'no_admission')).toBe(true)
    for (const t of targets) {
      const line = examTargetLine(t)
      expect(line).toContain('сначала нужен допуск')
      expect(line).not.toMatch(/не хватает/)
      expect(line).not.toMatch(/из 40/)
      expect(line).not.toMatch(/\d/)
    }
  })

  it('текст без числа — точные слова', () => {
    const [three] = examTargetsForDiscipline(exam({ points: 45, admitted: false }))
    expect(examTargetLine(three!)).toBe('сначала нужен допуск, его пока нет')
  })

  it('баллов не хватает: работает как раньше — «не хватает N баллов»', () => {
    const d = exam({ points: 22, admitted: false })
    expect(examTargetsForDiscipline(d)).toEqual(examPointsForGrades(22))
    expect(examTargetLine(examTargetsForDiscipline(d)[0]!)).toBe('сначала нужен допуск: не хватает 8 баллов за семестр')
    // Признак «да», но баллов мало: строка состояния тоже говорит «не хватает 8» — блок согласен.
    const admittedButFew = exam({ points: 22, admitted: true })
    expect(describeDiscipline(admittedButFew).missing).toBe(8)
    expect(examTargetsForDiscipline(admittedButFew)).toEqual(examPointsForGrades(22))
  })

  it('баллов нет совсем (пусто): допуска нет, не хватает 30', () => {
    const t = examTargetsForDiscipline(exam({ points: null, admitted: false }))
    expect(examTargetLine(t[0]!)).toBe('сначала нужен допуск: не хватает 30 баллов за семестр')
  })

  it('допуск есть и баллов хватает: числа для оценок, как у examPointsForGrades', () => {
    const d = exam({ points: 45, admitted: true })
    expect(describeDiscipline(d).kind).toBe('ahead_admitted')
    expect(examTargetsForDiscipline(d)).toEqual(examPointsForGrades(45))
    expect(examTargetsForDiscipline(d).map(examTargetLine)).toEqual([
      'на экзамене нужно 20 из 40 баллов',
      'на экзамене нужно 25 из 40 баллов',
      'на экзамене нужно 40 из 40 баллов',
    ])
  })

  it('недостижимая оценка названа словами, как раньше', () => {
    const t = examTargetsForDiscipline(exam({ points: 41, admitted: true }))
    expect(examTargetLine(t[2]!)).toBe('недостижимо: даже 40 из 40 на экзамене не хватит')
  })

  it('источник допуска один: блок говорит «нужен допуск» ровно тогда, когда describeDiscipline — «нет допуска»', () => {
    for (const points of [null, 0, 29, 30, 45, 60, 70]) {
      for (const admitted of [true, false]) {
        const d = exam({ points, admitted })
        const noAdmission = describeDiscipline(d).kind === 'ahead_no_admission'
        const targets = examTargetsForDiscipline(d)
        expect(targets.every((t) => t.status === 'no_admission'), `${points}/${admitted}`).toBe(noAdmission)
      }
    }
  })

  it('блок нужен только экзамену без итога: у зачёта и у закрытой дисциплины записей нет', () => {
    expect(examTargetsForDiscipline(exam({ controlKind: 'credit' }))).toEqual([])
    expect(examTargetsForDiscipline(exam({ outcome: '4' }))).toEqual([])
    expect(examTargetsForDiscipline(exam({ outcome: '2' }))).toEqual([])
  })
})

describe('R-3.3-4: подпись даты у закрытой дисциплины в «Сессии»', () => {
  const base = { examTime: null as string | null }

  it('закрытая дисциплина без даты: строки с датой нет', () => {
    expect(sessionWhenLine({ ...row('Статистика', { outcome: '4', points: 79 }), ...base })).toBeNull()
    expect(sessionWhenLine({ ...row('Маркетинг', { controlKind: 'credit', outcome: 'credit', points: 72 }), ...base })).toBeNull()
  })

  it('дисциплина без итога и без даты: «Дата не назначена» остаётся', () => {
    expect(sessionWhenLine({ ...row('Физика'), ...base })).toBe('Дата не назначена')
  })

  it('долг без даты пересдачи: «Дата не назначена» остаётся — дисциплина не закрыта', () => {
    expect(sessionWhenLine({ ...row('Право', { outcome: '2' }), ...base })).toBe('Дата не назначена')
  })

  it('с датой: день, день недели и время', () => {
    expect(sessionWhenLine({ ...row('Физика', { examDate: '2026-12-20' }), examTime: '10:00' })).toBe('20 декабря, вс, 10:00')
    expect(sessionWhenLine({ ...row('Физика', { examDate: '2026-12-20' }), ...base })).toBe('20 декабря, вс')
  })

  it('сданная дисциплина с датой: дата остаётся', () => {
    expect(sessionWhenLine({ ...row('Сдан', { outcome: '5', examDate: '2026-11-10' }), ...base })).toBe('10 ноября, вт')
  })
})

describe('R-3.3-5: долг с прошедшей датой пересдачи', () => {
  const OLD_DEBT = row('Эконометрика', { outcome: '2', points: 41, examDate: '2026-11-10' })

  it('строка «что сделать первым»: «пересдача была 10 ноября, новая дата не назначена»', () => {
    const first = pickFirstAction([OLD_DEBT], TODAY)!
    expect(first.kind).toBe('debt')
    expect(firstActionText(first, undefined, TODAY)).toEqual({
      lead: 'Пересдать',
      detail: 'Эконометрика, пересдача была 10 ноября, новая дата не назначена',
    })
  })

  it('пересдача сегодня ещё предстоит: прежний текст', () => {
    const today = row('Эконометрика', { outcome: '2', examDate: TODAY })
    expect(firstActionText(pickFirstAction([today], TODAY)!, undefined, TODAY).detail).toBe('Эконометрика, пересдача 14 ноября')
  })

  it('пересдача завтра и позже: прежний текст', () => {
    const later = row('Эконометрика', { outcome: '2', examDate: '2026-11-18' })
    expect(firstActionText(pickFirstAction([later], TODAY)!, undefined, TODAY).detail).toBe('Эконометрика, пересдача 18 ноября')
  })

  it('долг без даты: как раньше', () => {
    const none = row('Право', { outcome: '2' })
    expect(firstActionText(pickFirstAction([none], TODAY)!, undefined, TODAY).detail).toBe('Право, дата пересдачи не назначена')
  })

  it('фраза-итог не называет прошедшую пересдачу ближайшей и называет долг', () => {
    const phrase = summaryPhrase([OLD_DEBT], TODAY)
    expect(phrase).toBe('Сдано 0 из 1. Есть долг. Экзаменов и зачётов впереди нет.')
    expect(phrase).not.toContain('10 ноября')
    expect(phrase).not.toContain('Ближайшая пересдача')
  })

  it('с датой, равной сегодняшней, фраза называет пересдачу ближайшей', () => {
    const today = row('Эконометрика', { outcome: '2', examDate: TODAY })
    expect(summaryPhrase([today], TODAY)).toBe('Сдано 0 из 1. Есть долг. Ближайшая пересдача — 14 ноября.')
  })

  it('«сегодня» берётся из аргумента: тот же долг на 10 ноября ещё предстоит', () => {
    const first = pickFirstAction([OLD_DEBT], '2026-11-10')!
    expect(firstActionText(first, undefined, '2026-11-10').detail).toBe('Эконометрика, пересдача 10 ноября')
  })
})

describe('R-3.3-6: баллы больше шкалы', () => {
  it('70 при шкале 60 — «60»', () => {
    expect(displayPoints(70, 60)).toBe(60)
  })

  it('−5 — «0»', () => {
    expect(displayPoints(-5, 60)).toBe(0)
  })

  it('пусто остаётся пустым, не нулём', () => {
    expect(displayPoints(null, 60)).toBeNull()
  })

  it('в пределах шкалы число не меняется; границы 0 и max', () => {
    expect(displayPoints(41, 60)).toBe(41)
    expect(displayPoints(0, 60)).toBe(0)
    expect(displayPoints(60, 60)).toBe(60)
    expect(displayPoints(100, 100)).toBe(100)
    expect(displayPoints(101, 100)).toBe(100)
  })

  it('подпись «N из max» из показанного числа: «60 из 60», а не «70 из 60»', () => {
    const shown = displayPoints(70, 60)
    expect(`${shown} из 60 баллов`).toBe('60 из 60 баллов')
  })
})
