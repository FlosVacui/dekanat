// Пакет 3.3: данные набора под экран «Успеваемость» и ответ getMyDiscipline на чужой и случайный номер.
// Даты набора привязаны ко дню заполнения базы, поэтому тест дат не называет: ожидания берутся из самой выдачи.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { todayIn } from '@/lib/dates'
import { describeDiscipline, pickFirstAction, summarizeGrades } from '@/lib/grades'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import * as studentDal from '@/server/dal/student'
import { STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor } from './helpers'

let a: Actor
let b: Actor
const today = todayIn('Europe/Moscow')

beforeAll(async () => {
  ;[a, b] = await Promise.all([actorFor(STUDENT_A), actorFor(STUDENT_B)])
})
afterAll(closeDb)

describe('данные набора: пять состояний у Белозёрова (шаг 7 задания 3.3)', () => {
  it('сводка: сдано 2 из 7, долг 1, впереди 4, средний балл 3,0', async () => {
    const rows = await studentDal.listMyGrades(a, today)
    expect(rows).toHaveLength(7)
    expect(summarizeGrades(rows)).toEqual({ passed: 2, debt: 1, ahead: 4, average: 3 })
  })

  it('каждое состояние на месте и называется словами', async () => {
    const rows = await studentDal.listMyGrades(a, today)
    const state = (name: string) => {
      const row = rows.find((r) => r.name === name)
      expect(row, name).toBeDefined()
      return describeDiscipline(row!)
    }
    expect(state('Статистика')).toMatchObject({ kind: 'passed', text: 'сдано' })
    expect(state('Маркетинг')).toMatchObject({ kind: 'passed', text: 'сдано' })
    expect(state('Эконометрика')).toMatchObject({ kind: 'debt', text: 'долг' })
    expect(state('Корпоративные финансы')).toEqual({
      kind: 'ahead_no_admission',
      text: 'впереди, до допуска не хватает 8 баллов',
      missing: 8,
    })
    expect(state('Микроэкономика')).toMatchObject({ kind: 'ahead_admitted', text: 'впереди, допуск есть' })
  })

  it('сданное и долг лежат в прошлом, четвёртом семестре; текущий — пятый', async () => {
    const rows = await studentDal.listMyGrades(a, today)
    const sem = (name: string) => rows.find((r) => r.name === name)?.semester
    expect(['Статистика', 'Маркетинг', 'Эконометрика'].map(sem)).toEqual([4, 4, 4])
    expect(['Микроэкономика', 'Корпоративные финансы', 'Логистика цепей поставок', 'Деловой английский'].map(sem)).toEqual([5, 5, 5, 5])
  })

  it('«что сделать первым» — долг по эконометрике, в какой бы день ни шёл тест', async () => {
    const rows = await studentDal.listMyGrades(a, today)
    const first = pickFirstAction(rows, today)
    expect(first).toMatchObject({ kind: 'debt', name: 'Эконометрика' })
    expect(first?.date).toBe(rows.find((r) => r.name === 'Эконометрика')?.examDate)
    expect(first?.date).not.toBeNull()
  })

  it('без долга первым идёт недопуск: Корпоративные финансы', async () => {
    const rows = (await studentDal.listMyGrades(a, today)).filter((r) => r.name !== 'Эконометрика')
    expect(pickFirstAction(rows, today)).toMatchObject({ kind: 'no_admission', name: 'Корпоративные финансы', missing: 8 })
  })

  it('оценки «3» и итога «не зачтено» в наборе нет — их проверяют тесты функций', async () => {
    const outcomes = new Set([...(await studentDal.listMyGrades(a, today)), ...(await studentDal.listMyGrades(b, today))].map((r) => r.outcome))
    expect(outcomes.has('3')).toBe(false)
    expect(outcomes.has('no_credit')).toBe(false)
  })
})

describe('данные набора: Нестерова — отличница без долгов и дисциплина без баллов', () => {
  it('долгов нет, баллов нет у «Основ проектной работы» — пусто, а не ноль', async () => {
    const rows = await studentDal.listMyGrades(b, today)
    expect(summarizeGrades(rows).debt).toBe(0)
    const project = rows.find((r) => r.name === 'Основы проектной работы')
    expect(project).toBeDefined()
    expect(project!.points).toBeNull()
    expect(describeDiscipline(project!)).toEqual({ kind: 'ahead', text: 'впереди', missing: null })
  })

  it('61 балл по зачёту — всё равно «впереди»: прототип не ставит «зачтено» раньше даты', async () => {
    const rows = await studentDal.listMyGrades(b, today)
    const python = rows.find((r) => r.name === 'Программирование на Python')
    expect(python).toMatchObject({ points: 61, outcome: 'pending' })
    expect(describeDiscipline(python!).text).toBe('впереди')
  })

  it('первым — ближайший экзамен или зачёт; дата не раньше сегодняшней', async () => {
    const rows = await studentDal.listMyGrades(b, today)
    const dates = rows.filter((r) => r.outcome === 'pending' && r.examDate !== null && r.examDate >= today).map((r) => r.examDate!)
    expect(dates.length).toBeGreaterThan(0)
    const first = pickFirstAction(rows, today)
    expect(first?.kind).toBe('next_control')
    expect(first?.date).toBe([...dates].sort()[0])
  })
})

describe('getMyDiscipline: чужая и случайная дисциплина — один и тот же пустой ответ', () => {
  const RANDOM_ID = '7b1d2c9e-4f3a-4b6d-8e5f-1a2b3c4d5e6f'

  it('номер дисциплины другой группы, случайный номер и мусор дают null и не отличаются', async () => {
    const theirs = await studentDal.listMyGrades(b, today)
    const foreign = await studentDal.getMyDiscipline(a, theirs[0]!.disciplineId)
    const random = await studentDal.getMyDiscipline(a, RANDOM_ID)
    const garbage = await studentDal.getMyDiscipline(a, '../../etc/passwd')
    expect(foreign).toBeNull()
    expect(random).toBeNull()
    expect(garbage).toBeNull()
    expect(JSON.stringify(foreign)).toBe(JSON.stringify(random))
    expect(JSON.stringify(random)).toBe(JSON.stringify(garbage))
  })

  it('это верно для каждой чужой дисциплины, а свои открываются', async () => {
    const mine = await studentDal.listMyGrades(a, today)
    const theirs = await studentDal.listMyGrades(b, today)
    expect(theirs.length).toBeGreaterThan(0)
    for (const row of theirs) expect(await studentDal.getMyDiscipline(a, row.disciplineId)).toBeNull()
    for (const row of mine) expect(await studentDal.getMyDiscipline(a, row.disciplineId)).toMatchObject({ disciplineId: row.disciplineId, name: row.name })
  })

  it('выдача свой дисциплины не несёт чужих данных: названия чужой группы в ней нет', async () => {
    const mine = await studentDal.listMyGrades(a, today)
    const theirNames = (await studentDal.listMyGrades(b, today)).map((r) => r.name)
    const detail = JSON.stringify(await Promise.all(mine.map((r) => studentDal.getMyDiscipline(a, r.disciplineId))))
    for (const name of theirNames) expect(detail).not.toContain(name)
  })
})
