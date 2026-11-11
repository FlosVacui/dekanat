// Основной набор вымышленных данных: два студента с разными данными и сотрудник (ТР-11).
// Все люди, дисциплины, аудитории и даты придуманы; настоящих людей нет (ТР-5).
// Пароли основного набора публичны по заданию (ТР-9.2): они нужны жюри и тестам. Это не секрет сервиса.
// Резервные наборы для жюри — пакет 3.8: их логины и пароли в git не лежат.
import type { CohortSpec } from './seed-lib'

export const MAIN_COHORT: CohortSpec = {
  cohort: 'main',
  passwordPublished: true,
  staff: { login: 'dekanat', password: 'demo-dekanat-2026' },
  groups: [
    {
      name: 'Э-21-1',
      faculty: 'Факультет экономики и управления',
      dailyLessons: [
        {
          start: '09:00',
          end: '10:30',
          discipline: 'Микроэкономика',
          kind: 'lecture',
          room: 'Б-311',
          teacher: 'Громов Е. В.',
          change: { dayOffset: 1, kind: 'room_changed', note: 'Аудитория изменена: Б-311 → Б-312' },
        },
        {
          start: '10:45',
          end: '12:15',
          discipline: 'Логистика цепей поставок',
          kind: 'seminar',
          room: 'Б-204',
          teacher: 'Савельева Н. П.',
        },
      ],
      disciplines: [
        {
          name: 'Микроэкономика',
          controlKind: 'exam',
          semester: 5,
          exam: { dayOffset: 21, time: '10:00', room: 'Б-311' },
          assignments: [
            { title: 'Расчётная работа №3', dayOffset: 2, maxPoints: 20 },
            { title: 'Контрольная по теории спроса', dayOffset: 5, maxPoints: 15 },
          ],
        },
        {
          name: 'Логистика цепей поставок',
          controlKind: 'credit',
          semester: 5,
          exam: { dayOffset: 14, time: '12:30', room: 'Б-204' },
          assignments: [{ title: 'Реферат по складской логистике', dayOffset: 9, maxPoints: 25 }],
        },
        {
          name: 'Статистика',
          controlKind: 'exam',
          semester: 5,
          exam: { dayOffset: -10, time: '09:00', room: 'Б-110' },
          assignments: [],
        },
        {
          name: 'Деловой английский',
          controlKind: 'credit',
          semester: 5,
          exam: { dayOffset: 15, time: '14:00', room: 'Б-402' },
          assignments: [{ title: 'Презентация на английском', dayOffset: 6, maxPoints: 20 }],
        },
      ],
    },
    {
      name: 'П-22-1',
      faculty: 'Факультет права и политики',
      dailyLessons: [
        {
          start: '09:00',
          end: '10:30',
          discipline: 'Конституционное право',
          kind: 'lecture',
          room: 'Ю-102',
          teacher: 'Ермолаев Т. А.',
          change: { dayOffset: 1, kind: 'cancelled', note: 'Пара отменена, преподаватель на конференции' },
        },
        {
          start: '10:45',
          end: '12:15',
          discipline: 'Римское право',
          kind: 'seminar',
          room: 'Ю-215',
          teacher: 'Лисицына О. М.',
        },
      ],
      disciplines: [
        { name: 'Конституционное право', controlKind: 'exam', semester: 3, exam: { dayOffset: -8, time: '09:00', room: 'Ю-102' }, assignments: [] },
        { name: 'Право Евразийского союза', controlKind: 'credit', semester: 3, exam: { dayOffset: -6, time: '11:00', room: 'Ю-310' }, assignments: [] },
        {
          name: 'Римское право',
          controlKind: 'exam',
          semester: 3,
          exam: { dayOffset: 19, time: '10:00', room: 'Ю-215' },
          assignments: [
            { title: 'Доклад о понятии собственности', dayOffset: 3, maxPoints: 20 },
            { title: 'Эссе по источникам права', dayOffset: 6, maxPoints: 20 },
          ],
        },
        { name: 'Философия', controlKind: 'credit', semester: 3, exam: { dayOffset: 12, time: '13:00', room: 'Ю-101' }, assignments: [] },
      ],
    },
  ],
  students: [
    {
      login: 'belozerov',
      password: 'demo-student-1-2026',
      fullName: 'Белозёров Кирилл Андреевич',
      faculty: 'Факультет экономики и управления',
      programme: 'Экономика',
      course: 3,
      groupName: 'Э-21-1',
      grades: [
        { discipline: 'Микроэкономика', points: 64, outcome: 'pending' },
        { discipline: 'Логистика цепей поставок', points: 88, outcome: 'credit' },
        { discipline: 'Статистика', points: 79, outcome: '4' },
        { discipline: 'Деловой английский', points: 52, outcome: 'pending' },
      ],
      requests: [
        { key: 'seed-1', kind: 'dean_certificate', status: 'issued', note: 'Для райвоенкомата «Северный-7»', daysAgo: 12 },
      ],
      notifications: [
        {
          key: 'n1',
          kind: 'reminder',
          title: 'Срок через 2 дня: Расчётная работа №3',
          body: 'Микроэкономика, сдача в аудитории Б-311.',
          link: '/grades',
          unread: true,
        },
        {
          key: 'n2',
          kind: 'news',
          title: 'Окно комиссии по материальной помощи открыто',
          body: 'Подайте заявление до 15 декабря.',
          link: '/requests',
          unread: true,
        },
      ],
      markers: {
        profile: 'Белозёров',
        schedule: 'Громов',
        grades: 'Логистика цепей поставок',
        requests: 'Северный-7',
        notifications: 'Расчётная работа №3',
      },
    },
    {
      login: 'nesterova',
      password: 'demo-student-2-2026',
      fullName: 'Нестерова Алина Павловна',
      faculty: 'Факультет права и политики',
      programme: 'Юриспруденция',
      course: 2,
      groupName: 'П-22-1',
      grades: [
        { discipline: 'Конституционное право', points: 93, outcome: '5' },
        { discipline: 'Право Евразийского союза', points: 85, outcome: 'credit' },
        { discipline: 'Римское право', points: 58, outcome: 'pending' },
        { discipline: 'Философия', points: 31, outcome: 'pending', admitted: false },
      ],
      requests: [
        { key: 'seed-1', kind: 'financial_aid', status: 'submitted', note: 'Для комиссии: льготный проездной «Зелёная-3»', daysAgo: 2 },
      ],
      notifications: [
        {
          key: 'n1',
          kind: 'reminder',
          title: 'Срок через 3 дня: Доклад о понятии собственности',
          body: 'Римское право, семинар в аудитории Ю-215.',
          link: '/grades',
          unread: true,
        },
      ],
      markers: {
        profile: 'Нестерова',
        schedule: 'Лисицына',
        grades: 'Право Евразийского союза',
        requests: 'Зелёная-3',
        notifications: 'Доклад о понятии собственности',
      },
    },
  ],
  announcements: [
    {
      key: 'a1',
      faculty: 'Факультет экономики и управления',
      title: 'Окно комиссии по материальной помощи',
      body: 'Заявления на материальную помощь принимаются до 15 декабря в кабинете 124, 1 корпус.',
      hoursAgo: 30,
    },
    {
      key: 'a2',
      faculty: 'Факультет права и политики',
      title: 'Консультация перед сессией',
      body: 'Консультация по римскому праву пройдёт в аудитории Ю-215.',
      hoursAgo: 20,
    },
  ],
}
