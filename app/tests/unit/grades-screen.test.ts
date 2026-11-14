// Пакет 3.3, этап Б: чистая логика экрана «Успеваемость» — порядок карточек, фраза-итог, строка о стипендии, раскладка «Сессии».
// Даты передаются аргументами: день запуска не важен.
import { describe, expect, it } from 'vitest'
import {
  STIPEND_DEBT_LINE,
  firstActionText,
  groupSession,
  nearestControl,
  pickFirstAction,
  pointsScale,
  sessionStatus,
  sortForSemester,
  splitWorks,
  stipendLine,
  summarizeGrades,
  summaryPhrase,
  type FirstActionInput,
} from '../../src/lib/grades'

const TODAY = '2026-11-14'

function row(name: string, patch: Partial<FirstActionInput> = {}): FirstActionInput {
  return {
    disciplineId: `id-${name}`,
    name,
    controlKind: 'exam',
    outcome: 'pending',
    points: 41,
    admitted: true,
    examDate: null,
    ...patch,
  }
}

// Набор, похожий на данные студента 1: сданное, зачёт, долг, недопуск, впереди.
const STAT = row('Статистика', { outcome: '4', points: 79 })
const MARKETING = row('Маркетинг', { controlKind: 'credit', outcome: 'credit', points: 72 })
const ECON = row('Эконометрика', { outcome: '2', points: 41, examDate: '2026-11-18' })
const CORP = row('Корпоративные финансы', { points: 22, admitted: false, examDate: '2026-12-05' })
const MICRO = row('Микроэкономика', { points: 41, examDate: '2026-12-20' })
const LOGISTICS = row('Логистика цепей поставок', { controlKind: 'credit', points: 38, examDate: '2026-12-14' })
const ENGLISH = row('Деловой английский', { controlKind: 'credit', points: 44, examDate: '2026-12-16' })
const ALL = [MICRO, CORP, LOGISTICS, ENGLISH, STAT, MARKETING, ECON]

describe('вид «Семестр»: порядок карточек', () => {
  it('долг, затем недопуск, затем «впереди» по дате, затем сданное', () => {
    expect(sortForSemester(ALL).map((r) => r.name)).toEqual([
      'Эконометрика',
      'Корпоративные финансы',
      'Логистика цепей поставок',
      'Деловой английский',
      'Микроэкономика',
      'Маркетинг',
      'Статистика',
    ])
  })

  it('ни одна дисциплина не пропадает и не двоится: фильтра по семестру нет', () => {
    const sorted = sortForSemester(ALL)
    expect(sorted).toHaveLength(ALL.length)
    expect(new Set(sorted.map((r) => r.disciplineId)).size).toBe(ALL.length)
  })

  it('входной список не меняется', () => {
    const copy = [...ALL]
    sortForSemester(ALL)
    expect(ALL).toEqual(copy)
  })

  it('при равенстве — по названию, а дисциплина без даты стоит после датированных', () => {
    const a = row('Алгебра', { examDate: '2026-12-01' })
    const b = row('Борьба', { examDate: '2026-12-01' })
    const c = row('Анализ')
    expect(sortForSemester([c, b, a]).map((r) => r.name)).toEqual(['Алгебра', 'Борьба', 'Анализ'])
  })

  it('недопуск у зачёта по признаку из базы тоже поднимается наверх', () => {
    const noAdmission = row('Зачёт без допуска', { controlKind: 'credit', admitted: false, examDate: '2026-12-30' })
    expect(sortForSemester([MICRO, noAdmission]).map((r) => r.name)).toEqual(['Зачёт без допуска', 'Микроэкономика'])
  })
})

describe('фраза-итог сверху сводки', () => {
  it('сдано 2 из 7, есть долг, ближайшая пересдача — по данным, не по дню недели', () => {
    expect(summaryPhrase(ALL, TODAY)).toBe('Сдано 2 из 7. Есть долг. Ближайшая пересдача — 18 ноября.')
  })

  it('долгов нет: «Долгов нет», ближайший экзамен называется экзаменом', () => {
    expect(summaryPhrase([STAT, MARKETING, MICRO, row('Физика', { examDate: '2027-01-14' })], TODAY)).toBe(
      'Сдано 2 из 4. Долгов нет. Ближайший экзамен — 20 декабря.',
    )
  })

  it('ближайший контроль — зачёт: так и сказано', () => {
    expect(summaryPhrase([STAT, LOGISTICS, MICRO], TODAY)).toBe('Сдано 1 из 3. Долгов нет. Ближайший зачёт — 14 декабря.')
  })

  it('несколько долгов — число', () => {
    const second = row('Право', { outcome: 'no_credit', controlKind: 'credit' })
    expect(summaryPhrase([ECON, second], TODAY)).toBe('Сдано 0 из 2. Долгов: 2. Ближайшая пересдача — 18 ноября.')
  })

  it('экзамены и зачёты позади или без даты: «впереди нет»', () => {
    expect(summaryPhrase([STAT, row('Физика', { examDate: '2026-11-01' }), row('Химия')], TODAY)).toBe(
      'Сдано 1 из 3. Долгов нет. Экзаменов и зачётов впереди нет.',
    )
  })

  it('дата сегодняшнего дня ещё «впереди»; вчерашняя — уже нет', () => {
    expect(summaryPhrase([row('Сегодня', { examDate: TODAY })], TODAY)).toContain('Ближайший экзамен — 14 ноября.')
    expect(summaryPhrase([row('Вчера', { examDate: '2026-11-13' })], TODAY)).toContain('впереди нет')
  })

  it('числа фразы и числа сводки — один источник', () => {
    const s = summarizeGrades(ALL)
    expect(summaryPhrase(ALL, TODAY)).toContain(`Сдано ${s.passed} из ${ALL.length}`)
  })
})

describe('ближайший контроль', () => {
  it('сданное не считается, даже если дата впереди', () => {
    const passedWithDate = row('Сдан досрочно', { outcome: '5', examDate: '2026-11-20' })
    expect(nearestControl([passedWithDate], TODAY)).toBeNull()
  })

  it('пересдача долга — ближайший контроль, если она раньше', () => {
    expect(nearestControl(ALL, TODAY)).toEqual({ kind: 'retake', disciplineId: 'id-Эконометрика', name: 'Эконометрика', date: '2026-11-18' })
  })

  it('пусто — null', () => {
    expect(nearestControl([], TODAY)).toBeNull()
  })
})

describe('строка о стипендии', () => {
  it('есть долг — строка из задания, слов «по правилам вуза» нет', () => {
    expect(stipendLine(1)).toBe('Пока есть долг, обычная стипендия не назначается')
    expect(stipendLine(3)).toBe(STIPEND_DEBT_LINE)
    expect(STIPEND_DEBT_LINE).not.toMatch(/правил/i)
  })

  it('долгов нет — строки нет', () => {
    expect(stipendLine(0)).toBeNull()
  })

  it('выводится из числа «долг» сводки: у набора с долгом есть, без долга нет', () => {
    expect(stipendLine(summarizeGrades(ALL).debt)).toBe(STIPEND_DEBT_LINE)
    expect(stipendLine(summarizeGrades([STAT, MARKETING, MICRO]).debt)).toBeNull()
  })
})

describe('слова строки «что сделать первым»', () => {
  it('долг — пересдать, с датой', () => {
    const first = pickFirstAction(ALL, TODAY)!
    expect(firstActionText(first)).toEqual({ lead: 'Пересдать', detail: 'Эконометрика, пересдача 18 ноября' })
  })

  it('долг без даты — так и сказано', () => {
    const noDate = row('Право', { outcome: '2' })
    expect(firstActionText(pickFirstAction([noDate], TODAY)!).detail).toBe('Право, дата пересдачи не назначена')
  })

  it('недопуск — добрать баллы, с числом и склонением', () => {
    const first = pickFirstAction([CORP, MICRO], TODAY)!
    expect(firstActionText(first)).toEqual({ lead: 'Добрать баллы', detail: 'Корпоративные финансы, до допуска не хватает 8 баллов' })
    const one = pickFirstAction([row('Х', { points: 29, examDate: '2026-12-01' })], TODAY)!
    expect(firstActionText(one).detail).toBe('Х, до допуска не хватает 1 балл')
  })

  it('недопуск у зачёта: числа нет, допуска нет', () => {
    const credit = row('Зачёт', { controlKind: 'credit', admitted: false, examDate: '2026-12-30' })
    expect(firstActionText(pickFirstAction([credit], TODAY)!).detail).toBe('Зачёт, допуска пока нет')
  })

  it('ближайший экзамен или зачёт — слово по виду контроля', () => {
    const exam = pickFirstAction([MICRO], TODAY)!
    expect(firstActionText(exam, 'exam')).toEqual({ lead: 'Подготовиться', detail: 'Микроэкономика, экзамен 20 декабря' })
    const credit = pickFirstAction([LOGISTICS], TODAY)!
    expect(firstActionText(credit, 'credit').detail).toBe('Логистика цепей поставок, зачёт 14 декабря')
  })
})

describe('шкала полосы баллов', () => {
  it('экзамен без итога: из 60, отметка допуска на 30', () => {
    expect(pointsScale({ controlKind: 'exam', outcome: 'pending' })).toEqual({ max: 60, threshold: 30, kind: 'semester' })
  })

  it('экзамен с оценкой, долг по экзамену и зачёт: сумма из 100, порога нет', () => {
    expect(pointsScale({ controlKind: 'exam', outcome: '4' })).toEqual({ max: 100, threshold: null, kind: 'total' })
    expect(pointsScale({ controlKind: 'exam', outcome: '2' })).toEqual({ max: 100, threshold: null, kind: 'total' })
    expect(pointsScale({ controlKind: 'credit', outcome: 'pending' })).toEqual({ max: 100, threshold: null, kind: 'total' })
  })
})

describe('работы дисциплины: предстоящие и прошедшие', () => {
  const works = [
    { title: 'Б', dueDate: '2026-11-20' },
    { title: 'А', dueDate: '2026-11-14' },
    { title: 'В', dueDate: '2026-11-13' },
    { title: 'Г', dueDate: '2026-10-01' },
    { title: 'Д', dueDate: '2026-11-20' },
  ]

  it('срок сегодня — предстоящая; предстоящие по возрастанию, прошедшие недавние сверху', () => {
    const { upcoming, past } = splitWorks(works, TODAY)
    expect(upcoming.map((w) => w.title)).toEqual(['А', 'Б', 'Д'])
    expect(past.map((w) => w.title)).toEqual(['В', 'Г'])
  })

  it('работа не теряется и не двоится; входной список не меняется', () => {
    const copy = [...works]
    const { upcoming, past } = splitWorks(works, TODAY)
    expect(upcoming.length + past.length).toBe(works.length)
    expect(works).toEqual(copy)
  })

  it('работ нет — две пустые группы', () => {
    expect(splitWorks([], TODAY)).toEqual({ upcoming: [], past: [] })
  })
})

describe('вид «Сессия»: раскладка', () => {
  it('предстоящие по возрастанию, прошедшие по убыванию, каждая дисциплина — в одной группе', () => {
    const past = row('Прошлый экзамен', { outcome: '5', points: 90, examDate: '2026-11-10' })
    const older = row('Старый зачёт', { controlKind: 'credit', outcome: 'credit', examDate: '2026-10-20' })
    const noDate = row('Без даты')
    const groups = groupSession([...ALL, past, older, noDate], TODAY)
    expect(groups.upcoming.map((r) => r.name)).toEqual([
      'Эконометрика',
      'Корпоративные финансы',
      'Логистика цепей поставок',
      'Деловой английский',
      'Микроэкономика',
    ])
    expect(groups.past.map((r) => r.name)).toEqual(['Прошлый экзамен', 'Старый зачёт', 'Маркетинг', 'Статистика'])
    expect(groups.undated.map((r) => r.name)).toEqual(['Без даты'])
    const total = groups.upcoming.length + groups.past.length + groups.undated.length
    expect(total).toBe(ALL.length + 3)
  })

  it('день контроля — сегодня: ещё «предстоящий»', () => {
    const groups = groupSession([row('Сегодня', { examDate: TODAY }), row('Вчера', { examDate: '2026-11-13' })], TODAY)
    expect(groups.upcoming.map((r) => r.name)).toEqual(['Сегодня'])
    expect(groups.past.map((r) => r.name)).toEqual(['Вчера'])
  })

  it('пусто — три пустые группы', () => {
    expect(groupSession([], TODAY)).toEqual({ upcoming: [], past: [], undated: [] })
  })
})

describe('вид «Сессия»: статус строки', () => {
  it('допущен, не допущен с числом, пересдача, сдано', () => {
    expect(sessionStatus(MICRO)).toEqual({ kind: 'admitted', word: 'Допущен', missing: null })
    expect(sessionStatus(CORP)).toEqual({ kind: 'not_admitted', word: 'Не допущен', missing: 8 })
    expect(sessionStatus(ECON)).toEqual({ kind: 'retake', word: 'Пересдача', missing: null })
    expect(sessionStatus(STAT)).toEqual({ kind: 'passed', word: 'Сдано', missing: null })
  })

  it('зачёт: допущен по признаку; без допуска — «Не допущен» без числа: порога нет', () => {
    expect(sessionStatus(LOGISTICS).kind).toBe('admitted')
    const noAdmission = row('Зачёт', { controlKind: 'credit', admitted: false })
    expect(sessionStatus(noAdmission)).toEqual({ kind: 'not_admitted', word: 'Не допущен', missing: null })
  })

  it('зачёт без баллов — не «не допущен»: пустое не ноль', () => {
    const empty = row('Проектная работа', { controlKind: 'credit', points: null })
    expect(sessionStatus(empty).kind).toBe('admitted')
  })
})
