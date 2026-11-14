// Пакет 3.3, этап Б: сквозные тесты экрана «Успеваемость» не зависят от дня недели запуска (ошибка ИИ 84).
// Сквозной тест нельзя запустить в другой день: «сегодня» берётся по часам. Поэтому здесь для 14 дней подряд сверены
// расчёт помощника сквозных тестов (свой, короткий) и функции экрана (src/lib/grades.ts), на которые экран опирается.
// База не нужна.
import { describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { addDays, todayIn } from '../../src/lib/dates'
import { examPointsForGrades, groupSession, sortForSemester, summaryPhrase, type FirstActionInput } from '../../src/lib/grades'
import { expectedExamNeeds, planGrades, type PlannedRow } from '../e2e/helpers/grades-plan-core'

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')

const RUN_DAY = todayIn('Europe/Moscow')
const DAYS_IN_ROW = 14
const days = Array.from({ length: DAYS_IN_ROW }, (_, i) => addDays(RUN_DAY, i))

function screenInput(rows: PlannedRow[]): FirstActionInput[] {
  return rows.map((r) => ({
    disciplineId: r.id,
    name: r.name,
    controlKind: r.controlKind,
    outcome: r.outcome,
    points: r.points,
    admitted: r.admitted,
    examDate: r.examDate,
  }))
}

describe.each([student1, student2])('помощник сквозных тестов и функции экрана: студент $login, 14 дней подряд', (student) => {
  it('фраза-итог, порядок карточек и раскладка «Сессии» совпадают с функциями экрана в каждый день', () => {
    for (const day of days) {
      const plan = planGrades(day, student.login)
      const input = screenInput(plan.rows)
      expect(summaryPhrase(input, day), `${day}: фраза`).toBe(plan.phrase)
      expect(sortForSemester(input).map((r) => r.name), `${day}: порядок «Семестра»`).toEqual(plan.semesterOrder)
      const groups = groupSession(input, day)
      expect(groups.upcoming.map((r) => r.name), `${day}: «Сессия», предстоящие`).toEqual(plan.sessionUpcoming)
      expect(groups.past.map((r) => r.name), `${day}: «Сессия», прошедшие`).toEqual(plan.sessionPast)
    }
  })

  it('чужие номера дисциплин есть и не пересекаются со своими', () => {
    for (const day of days) {
      const plan = planGrades(day, student.login)
      expect(plan.foreignIds.length, `${day}: чужих дисциплин нет`).toBeGreaterThan(0)
      const own = new Set(plan.rows.map((r) => r.id))
      for (const id of plan.foreignIds) expect(own.has(id), `${day}: ${id} свой и чужой`).toBe(false)
    }
  })
})

describe('что видно в день запуска и в соседние дни: студент 1', () => {
  it('сдано 2 из 7, долг 1, впереди 4; первая карточка — долг, вторая — недопуск; ближайший контроль — пересдача долга', () => {
    for (const day of days) {
      const plan = planGrades(day, student1.login)
      expect([plan.passed, plan.debt, plan.ahead], `${day}`).toEqual([2, 1, 4])
      expect(plan.semesterOrder.slice(0, 2), `${day}`).toEqual(['Эконометрика', 'Корпоративные финансы'])
      expect(plan.nearest?.name, `${day}`).toBe('Эконометрика')
      expect(plan.nearest?.word, `${day}`).toBe('Ближайшая пересдача')
      // Пересдача — на 4–5 дней вперёд (не в воскресенье): всегда «предстоящая», в «Сессии» верхняя строка.
      expect(plan.sessionUpcoming[0], `${day}`).toBe('Эконометрика')
      expect(plan.sessionPast, `${day}`).toEqual(['Маркетинг', 'Статистика'])
    }
  })

  it('строки «что нужно на экзамене»: расчёт помощника совпадает с функцией экрана на баллах из плана', () => {
    for (const day of days) {
      for (const row of planGrades(day, student1.login).rows.filter((r) => r.controlKind === 'exam' && r.outcome === 'pending')) {
        const lines = examPointsForGrades(row.points).map((t) =>
          t.status === 'needs'
            ? `${t.grade}:нужно ${t.points}`
            : t.status === 'unreachable'
              ? `${t.grade}:недостижимо`
              : `${t.grade}:допуск ${t.missingToAdmission}`,
        )
        const expected = expectedExamNeeds(row.points).map((s) => {
          const grade = s.charAt('Чтобы получить '.length)
          const needs = /нужно (\d+) из/.exec(s)
          const missing = /не хватает (\d+)/.exec(s)
          return needs ? `${grade}:нужно ${needs[1]}` : missing ? `${grade}:допуск ${missing[1]}` : `${grade}:недостижимо`
        })
        expect(lines, `${day}: ${row.name}`).toEqual(expected)
      }
    }
  })
})

describe('что видно у студента 2', () => {
  it('долгов нет — строки о стипендии не будет; первым стоит ближайший контроль', () => {
    for (const day of days) {
      const plan = planGrades(day, student2.login)
      expect(plan.debt, `${day}`).toBe(0)
      expect(plan.phrase, `${day}`).toContain('Долгов нет.')
      expect(plan.nearest, `${day}: ближайшего контроля нет`).toBeDefined()
    }
  })
})
