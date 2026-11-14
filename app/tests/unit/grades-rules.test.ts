// Правила баллов пакета 3.3: чистые функции, без базы. Даты передаются аргументами — день запуска не важен.
import { describe, expect, it } from 'vitest'
import {
  ADMISSION_MIN_SEMESTER_POINTS,
  EXAM_MAX_POINTS,
  EXAM_MIN_POINTS,
  GRADE_3_MIN,
  GRADE_4_MIN,
  GRADE_5_MIN,
  SEMESTER_MAX_POINTS,
  TOTAL_MAX_POINTS,
  describeDiscipline,
  examPointsForGrades,
  gradeForTotal,
  pickFirstAction,
  pointsToAdmission,
  pointsWord,
  type FirstActionInput,
} from '../../src/lib/grades'

describe('постоянные правил', () => {
  it('числа правил — 60, 40, 100, 85, 70, 50, 30, 20', () => {
    expect([SEMESTER_MAX_POINTS, EXAM_MAX_POINTS, TOTAL_MAX_POINTS]).toEqual([60, 40, 100])
    expect([GRADE_5_MIN, GRADE_4_MIN, GRADE_3_MIN]).toEqual([85, 70, 50])
    expect([ADMISSION_MIN_SEMESTER_POINTS, EXAM_MIN_POINTS]).toEqual([30, 20])
  })
})

describe('оценка по сумме баллов: границы', () => {
  it.each([
    [0, '2'],
    [29, '2'],
    [30, '2'],
    [49, '2'],
    [50, '3'],
    [69, '3'],
    [70, '4'],
    [84, '4'],
    [85, '5'],
    [100, '5'],
  ] as const)('%i баллов — «%s»', (total, grade) => {
    expect(gradeForTotal(total)).toBe(grade)
  })

  it('сумма вне 0–100 обрезается', () => {
    expect(gradeForTotal(-5)).toBe('2')
    expect(gradeForTotal(140)).toBe('5')
    expect(gradeForTotal(Number.NaN)).toBe('2')
  })
})

describe('сколько не хватает до допуска', () => {
  it.each([
    [0, 30],
    [29, 1],
    [30, 0],
    [60, 0],
    [22, 8],
  ])('%i баллов за семестр — не хватает %i', (points, missing) => {
    expect(pointsToAdmission(points)).toBe(missing)
  })

  it('баллов нет — не ноль, но до допуска не хватает всех 30', () => {
    expect(pointsToAdmission(null)).toBe(30)
  })
})

describe('сколько нужно на экзамене для оценок 3, 4 и 5', () => {
  const needs = (points: number | null) => examPointsForGrades(points).map((t) => (t.status === 'needs' ? t.points : t.status))

  it('0 баллов за семестр и 29: допуска нет, оценку экзаменом пока не закрыть', () => {
    for (const p of [0, 29, null]) {
      const targets = examPointsForGrades(p)
      expect(targets.map((t) => t.grade)).toEqual([3, 4, 5])
      expect(targets.every((t) => t.status === 'no_admission')).toBe(true)
    }
    expect(examPointsForGrades(29)[0]).toEqual({ grade: 3, status: 'no_admission', missingToAdmission: 1 })
  })

  it('30 за семестр: тройка — на экзамене минимум 20, четвёрка — 40, пятёрка недостижима', () => {
    expect(needs(30)).toEqual([20, 40, 'unreachable'])
  })

  it('31 за семестр: четвёрка — 39; пятёрка всё ещё недостижима', () => {
    expect(needs(31)).toEqual([20, 39, 'unreachable'])
  })

  it('44 и 45 за семестр: пятёрка недостижима при 44 (нужно 41) и достижима при 45 (нужно 40)', () => {
    expect(needs(44)[2]).toBe('unreachable')
    expect(needs(45)[2]).toBe(40)
  })

  it('41 за семестр (Микроэкономика): 3 — 20, 4 — 29, 5 — 44 нельзя, значит недостижима', () => {
    expect(needs(41)).toEqual([20, 29, 'unreachable'])
  })

  it('50 и больше за семестр: меньше 20 на экзамене всё равно нельзя', () => {
    expect(needs(50)).toEqual([20, 20, 35])
    expect(needs(60)).toEqual([20, 20, 25])
  })

  it('сумма семестра и нужного экзамена даёт именно эту оценку, а на балл меньше — нет (кроме порога 20)', () => {
    for (let sem = ADMISSION_MIN_SEMESTER_POINTS; sem <= SEMESTER_MAX_POINTS; sem += 1) {
      for (const t of examPointsForGrades(sem)) {
        if (t.status !== 'needs') continue
        expect(Number(gradeForTotal(sem + t.points))).toBeGreaterThanOrEqual(t.grade)
        if (t.points > EXAM_MIN_POINTS) expect(Number(gradeForTotal(sem + t.points - 1))).toBeLessThan(t.grade)
      }
    }
  })
})

describe('итог по дисциплине словами', () => {
  const exam = { controlKind: 'exam', points: 41, admitted: true } as const

  it('сдано: оценка и «зачтено»', () => {
    for (const outcome of ['5', '4', '3', 'credit']) {
      expect(describeDiscipline({ ...exam, outcome })).toEqual({ kind: 'passed', text: 'сдано', missing: null })
    }
  })

  it('долг: оценка 2 и «не зачтено»', () => {
    for (const outcome of ['2', 'no_credit']) {
      expect(describeDiscipline({ ...exam, outcome })).toEqual({ kind: 'debt', text: 'долг', missing: null })
    }
  })

  it('экзамен впереди с допуском: ровно 30 баллов — допуск есть', () => {
    expect(describeDiscipline({ ...exam, outcome: 'pending', points: 30 }).text).toBe('впереди, допуск есть')
    expect(describeDiscipline({ ...exam, outcome: 'pending', points: 41 }).kind).toBe('ahead_admitted')
  })

  it('экзамен впереди без допуска: 29 баллов — не хватает 1 балла; 22 — не хватает 8 баллов', () => {
    expect(describeDiscipline({ ...exam, outcome: 'pending', points: 29, admitted: false })).toEqual({
      kind: 'ahead_no_admission',
      text: 'впереди, до допуска не хватает 1 балл',
      missing: 1,
    })
    expect(describeDiscipline({ ...exam, outcome: 'pending', points: 22, admitted: false })).toEqual({
      kind: 'ahead_no_admission',
      text: 'впереди, до допуска не хватает 8 баллов',
      missing: 8,
    })
  })

  it('баллы и признак допуска расходятся: верим меньшему, число не выдумываем', () => {
    // Признак в базе «нет допуска», а баллов хватает: сказано «допуска нет», числа нет.
    expect(describeDiscipline({ ...exam, outcome: 'pending', points: 40, admitted: false })).toEqual({
      kind: 'ahead_no_admission',
      text: 'впереди, допуска нет',
      missing: null,
    })
    // Признак «допуск есть», а баллов мало: считаем по баллам.
    expect(describeDiscipline({ ...exam, outcome: 'pending', points: 10, admitted: true }).missing).toBe(20)
  })

  it('экзамен без баллов: не ноль, но до допуска не хватает 30', () => {
    expect(describeDiscipline({ ...exam, outcome: 'pending', points: null, admitted: true }).missing).toBe(30)
  })

  it('зачёт: порога нет — просто «впереди», хоть 0 баллов, хоть 61, хоть пусто', () => {
    for (const points of [null, 0, 38, 61]) {
      expect(describeDiscipline({ controlKind: 'credit', outcome: 'pending', points, admitted: true })).toEqual({
        kind: 'ahead',
        text: 'впереди',
        missing: null,
      })
    }
  })

  it('зачёт с признаком «допуска нет» — так и сказано, без числа', () => {
    expect(describeDiscipline({ controlKind: 'credit', outcome: 'pending', points: 10, admitted: false })).toEqual({
      kind: 'ahead_no_admission',
      text: 'впереди, допуска нет',
      missing: null,
    })
  })

  it('слово «балл» склоняется', () => {
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25, 30].map(pointsWord)).toEqual([
      'балл',
      'балла',
      'балла',
      'баллов',
      'баллов',
      'баллов',
      'балл',
      'балла',
      'баллов',
      'баллов',
    ])
  })
})

describe('«что сделать первым»', () => {
  const base = { controlKind: 'exam', points: 41, admitted: true, outcome: 'pending' } as const
  const item = (over: Partial<FirstActionInput> & { disciplineId: string; name: string }): FirstActionInput => ({
    ...base,
    examDate: null,
    ...over,
  })
  const today = '2026-11-14'

  const debt = item({ disciplineId: 'd', name: 'Эконометрика', outcome: '2', examDate: '2026-11-27' })
  const noAdmission = item({ disciplineId: 'n', name: 'Корпоративные финансы', points: 22, admitted: false, examDate: '2027-01-13' })
  const soon = item({ disciplineId: 's', name: 'Логистика', controlKind: 'credit', examDate: '2026-12-23' })
  const later = item({ disciplineId: 'l', name: 'Микроэкономика', examDate: '2026-12-29' })
  const done = item({ disciplineId: 'p', name: 'Статистика', outcome: '4', examDate: null })

  it('долг идёт раньше недопуска, недопуск — раньше ближайшего экзамена', () => {
    expect(pickFirstAction([later, soon, noAdmission, debt, done], today)).toMatchObject({ kind: 'debt', disciplineId: 'd', date: '2026-11-27' })
    expect(pickFirstAction([later, soon, noAdmission, done], today)).toMatchObject({ kind: 'no_admission', disciplineId: 'n', missing: 8 })
    expect(pickFirstAction([later, soon, done], today)).toMatchObject({ kind: 'next_control', disciplineId: 's', date: '2026-12-23' })
  })

  it('порядок в выдаче не важен', () => {
    expect(pickFirstAction([done, debt, later, noAdmission, soon], today)?.kind).toBe('debt')
    expect(pickFirstAction([soon, later], today)?.disciplineId).toBe('s')
    expect(pickFirstAction([later, soon], today)?.disciplineId).toBe('s')
  })

  it('несколько долгов: сначала у кого пересдача раньше, без даты — в конце', () => {
    const noDate = item({ disciplineId: 'x', name: 'Алгебра', outcome: 'no_credit', examDate: null })
    const earlier = item({ disciplineId: 'e', name: 'Право', outcome: '2', examDate: '2026-11-20' })
    expect(pickFirstAction([noDate, debt, earlier], today)?.disciplineId).toBe('e')
    expect(pickFirstAction([noDate, debt], today)?.disciplineId).toBe('d')
  })

  it('экзамен «сегодня» ещё впереди, вчерашний — нет', () => {
    const t = item({ disciplineId: 't', name: 'Сегодня', examDate: today })
    const y = item({ disciplineId: 'y', name: 'Вчера', examDate: '2026-11-13' })
    expect(pickFirstAction([y, t], today)?.disciplineId).toBe('t')
    expect(pickFirstAction([y], today)).toBeNull()
  })

  it('делать нечего: всё сдано или дат нет — null', () => {
    expect(pickFirstAction([], today)).toBeNull()
    expect(pickFirstAction([done], today)).toBeNull()
    expect(pickFirstAction([item({ disciplineId: 'q', name: 'Без даты' })], today)).toBeNull()
  })

  it('результат не зависит от дня запуска: «сегодня» — аргумент', () => {
    expect(pickFirstAction([soon, later], '2026-12-24')?.disciplineId).toBe('l')
    expect(pickFirstAction([soon, later], '2027-01-01')).toBeNull()
  })
})
