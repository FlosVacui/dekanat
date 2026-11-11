// Второй набор вымышленных данных — создаётся только в тестах (ADR-0005): студент и сотрудник другого набора.
// Резервные наборы для жюри — пакет 3.8; их здесь нет.
import { MAIN_COHORT } from '../../db/seed-data'
import type { CohortSpec } from '../../db/seed-lib'

export const ALT_COHORT: CohortSpec = {
  cohort: 'test-alt',
  passwordPublished: false,
  staff: { login: 'test-alt-staff', password: 'тест-сотрудник-второго-набора-1' },
  groups: [
    {
      name: 'ТЕСТ-Г-9',
      faculty: 'Факультет тестовых данных',
      dailyLessons: [
        { start: '08:30', end: '10:00', discipline: 'Теория тестов', kind: 'lecture', room: 'Т-900', teacher: 'Тестов А. А.' },
      ],
      disciplines: [{ name: 'Теория тестов', controlKind: 'exam', semester: 1, exam: { dayOffset: 30, time: '10:00', room: 'Т-900' }, assignments: [] }],
    },
  ],
  students: [
    {
      login: 'test-alt-student',
      password: 'тест-студент-второго-набора-1',
      fullName: 'Тестовый Тест Тестович',
      faculty: 'Факультет тестовых данных',
      programme: 'Тестирование',
      course: 1,
      groupName: 'ТЕСТ-Г-9',
      grades: [{ discipline: 'Теория тестов', points: 50, outcome: 'pending' }],
      requests: [{ key: 'seed-1', kind: 'dean_certificate', status: 'submitted', note: 'Метка второго набора Ω-77', daysAgo: 1 }],
      notifications: [],
      markers: { profile: 'Тестовый Тест', schedule: 'Тестов А. А.', grades: 'Теория тестов', requests: 'Ω-77', notifications: '—' },
    },
  ],
  announcements: [],
}

export const [STUDENT_A, STUDENT_B] = MAIN_COHORT.students as [
  (typeof MAIN_COHORT.students)[number],
  (typeof MAIN_COHORT.students)[number],
]
export const STAFF_MAIN = MAIN_COHORT.staff
export const ALT_STUDENT = ALT_COHORT.students[0]!
export const STAFF_ALT = ALT_COHORT.staff
