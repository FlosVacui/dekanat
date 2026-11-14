// Второй набор вымышленных данных — создаётся только в тестах (ADR-0005): студент и сотрудник другого набора.
// Резервные наборы для жюри — app/db/seed-reserve-lib.ts; их здесь нет.
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
      // По паре в каждый учебный день обеих недель.
      week: ([1, 2, 3, 4, 5, 6] as const).map((weekday) => ({
        weekday,
        weeks: 'both' as const,
        pair: 1,
        discipline: 'Теория тестов',
        kind: 'lecture' as const,
        room: 'Т-900',
        teacher: 'Тестов А. А.',
      })),
      changes: [],
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
      requests: [
        {
          key: 'seed-1',
          kind: 'dean_certificate',
          purpose: 'on_demand',
          note: 'Метка второго набора Ω-77',
          steps: [{ status: 'submitted', dayOffset: -1 }],
        },
      ],
      notifications: [],
      // Метка уведомлений — не тире: тире стоит в текстах основного набора («Сессия — с 28 декабря»), и тест «метки не просачиваются» краснел бы.
      markers: { profile: 'Тестовый Тест', schedule: 'Тестов А. А.', grades: 'Теория тестов', requests: 'Ω-77', notifications: 'Ω-78' },
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
