// Основной набор вымышленных данных: два студента с разными данными и сотрудник (ТР-11).
// Источник — docs/data/draft.md, версия 2, разделы 2–6. Все люди, названия, аудитории и даты придуманы; настоящих людей нет (ТР-5).
// Даты — сдвигом от дня Д (дня заполнения базы); как они привязываются к неделе, считает seed-plan.ts.
// Пароли основного набора публичны по заданию (ТР-9.2): они нужны жюри и тестам. Это не секрет сервиса.
// Резервные наборы для жюри — seed-reserve-lib.ts: их логины и пароли в git не лежат, а ФИО, группы и факультеты свои.
import type { CohortSpec, GroupSpec, LessonSlot } from './seed-plan'

const MON = 1
const TUE = 2
const WED = 3
const THU = 4
const FRI = 5
const SAT = 6

const FACULTY_ECONOMICS = 'Факультет цифровой экономики'
const FACULTY_ENGINEERING = 'Факультет цифровой инженерии'
const GROUP_ECONOMICS = 'ЦЭ-24-03'
const GROUP_ENGINEERING = 'ЦИ-25-01'

/** Группа ЦЭ-24-03, семестр 5: верхняя неделя — основа, нижняя отличается вторником, четвергом и субботой (черновик, 3.1). */
const WEEK_ECONOMICS: LessonSlot[] = [
  { weekday: MON, weeks: 'both', pair: 1, discipline: 'Микроэкономика', kind: 'lecture', room: '1-412', teacher: 'Громов Е. В.' },
  { weekday: MON, weeks: 'both', pair: 2, discipline: 'Микроэкономика', kind: 'seminar', room: '1-305', teacher: 'Громов Е. В.' },
  { weekday: TUE, weeks: 'both', pair: 2, discipline: 'Корпоративные финансы', kind: 'lecture', room: '2-210', teacher: 'Тарасова Л. И.' },
  { weekday: TUE, weeks: 'both', pair: 3, discipline: 'Логистика цепей поставок', kind: 'seminar', room: '1-204', teacher: 'Савельева Н. П.' },
  { weekday: TUE, weeks: 'lower', pair: 4, discipline: 'Корпоративные финансы', kind: 'lab', room: '2-301', teacher: 'Тарасова Л. И.' },
  { weekday: WED, weeks: 'both', pair: 1, discipline: 'Деловой английский', kind: 'seminar', room: '3-118', teacher: 'Мельник Д. О.' },
  { weekday: WED, weeks: 'both', pair: 2, discipline: 'Корпоративные финансы', kind: 'seminar', room: '2-214', teacher: 'Тарасова Л. И.' },
  { weekday: WED, weeks: 'both', pair: 3, discipline: 'Микроэкономика', kind: 'seminar', room: '1-305', teacher: 'Громов Е. В.' },
  // Четверг верхней недели без пар — для пустого состояния экрана «День».
  { weekday: THU, weeks: 'lower', pair: 2, discipline: 'Микроэкономика', kind: 'lecture', room: '1-412', teacher: 'Громов Е. В.' },
  { weekday: FRI, weeks: 'both', pair: 2, discipline: 'Логистика цепей поставок', kind: 'lecture', room: '1-412', teacher: 'Савельева Н. П.' },
  { weekday: FRI, weeks: 'both', pair: 3, discipline: 'Корпоративные финансы', kind: 'seminar', room: '2-214', teacher: 'Тарасова Л. И.' },
  // Суббота нижней недели без пар.
  { weekday: SAT, weeks: 'upper', pair: 1, discipline: 'Деловой английский', kind: 'seminar', room: '3-118', teacher: 'Мельник Д. О.' },
]

/** Группа ЦИ-25-01, семестр 3: нижняя неделя отличается пятницей (черновик, 3.2). */
const WEEK_ENGINEERING: LessonSlot[] = [
  { weekday: MON, weeks: 'both', pair: 2, discipline: 'Математический анализ', kind: 'lecture', room: '4-501', teacher: 'Зайцев П. Р.' },
  { weekday: MON, weeks: 'both', pair: 3, discipline: 'Физика', kind: 'lab', room: '4-215', teacher: 'Белова С. А.' },
  { weekday: TUE, weeks: 'both', pair: 1, discipline: 'Программирование на Python', kind: 'lab', room: '4-310', teacher: 'Руденко М. В.' },
  { weekday: TUE, weeks: 'both', pair: 2, discipline: 'Математический анализ', kind: 'seminar', room: '4-402', teacher: 'Зайцев П. Р.' },
  { weekday: WED, weeks: 'both', pair: 2, discipline: 'Физика', kind: 'lecture', room: '4-501', teacher: 'Белова С. А.' },
  { weekday: WED, weeks: 'both', pair: 3, discipline: 'Инженерная графика', kind: 'seminar', room: '4-118', teacher: 'Кравец Ю. Г.' },
  { weekday: THU, weeks: 'both', pair: 1, discipline: 'Программирование на Python', kind: 'lab', room: '4-310', teacher: 'Руденко М. В.' },
  { weekday: THU, weeks: 'both', pair: 2, discipline: 'Математический анализ', kind: 'seminar', room: '4-402', teacher: 'Зайцев П. Р.' },
  { weekday: FRI, weeks: 'upper', pair: 3, discipline: 'Физика', kind: 'seminar', room: '4-402', teacher: 'Белова С. А.' },
  { weekday: FRI, weeks: 'lower', pair: 3, discipline: 'Инженерная графика', kind: 'seminar', room: '4-118', teacher: 'Кравец Ю. Г.' },
  // Суббота — без пар.
]

const GROUP_1: GroupSpec = {
  name: GROUP_ECONOMICS,
  faculty: FACULTY_ECONOMICS,
  week: WEEK_ECONOMICS,
  // Пять изменений (черновик, 3.1 и 3.3). Сдвиги — при Д-понедельнике; при другом Д пару выбирает seed-plan.ts.
  changes: [
    // Метка сквозного теста: видна на экране «Сегодня» при любом Д, где в день Д или Д+1 есть пары группы.
    { key: 'cf-room', discipline: 'Корпоративные финансы', lessonKind: 'lecture', dayOffset: 1, anchorToday: true, kind: 'room_changed', newRoom: '2-108' },
    {
      key: 'micro-move',
      discipline: 'Микроэкономика',
      lessonKind: 'seminar',
      dayOffset: 2,
      kind: 'moved',
      // Заметку («на 5 пару, 15:45–17:15, та же аудитория») собирает seed-plan.ts по сетке пар.
      toPair: 5,
    },
    {
      key: 'logistics-cancel',
      discipline: 'Логистика цепей поставок',
      lessonKind: 'lecture',
      dayOffset: 4,
      kind: 'cancelled',
      note: 'преподаватель в командировке',
    },
    {
      key: 'cf-move',
      discipline: 'Корпоративные финансы',
      lessonKind: 'seminar',
      dayOffset: 4,
      kind: 'moved',
      // Заметка: «на субботу <дата новой пары>, 2 пара, 10:15–11:45, ауд. 2-214» — собирает seed-plan.ts.
      toPair: 2,
      toWeekday: SAT,
      toRoom: '2-214',
    },
    {
      key: 'english-teacher',
      discipline: 'Деловой английский',
      lessonKind: 'seminar',
      dayOffset: 5,
      kind: 'teacher_changed',
      note: 'Ведёт Яковлева А. С. вместо Мельник Д. О.',
    },
  ],
  // Сессия — датами календаря, как в объявлении a2: зачёты 21–26.12, экзамены с 28.12 по 24.01, мимо праздников 31.12–08.01.
  // Пересдача — сдвигом: она всегда впереди (docs/data/check-2026-11-17.md, Д-1).
  disciplines: [
    {
      name: 'Микроэкономика',
      controlKind: 'exam',
      semester: 5,
      exam: { date: '2026-12-29', time: '10:00', room: '1-412' },
      assignments: [{ key: 'rz3', title: 'Расчётная работа №3', dayOffset: 2, maxPoints: 20 }],
    },
    {
      name: 'Корпоративные финансы',
      controlKind: 'exam',
      semester: 5,
      exam: { date: '2027-01-13', time: '10:00', room: '2-210' },
      assignments: [{ key: 'case', title: 'Кейс по оценке проекта', dayOffset: 7, maxPoints: 15 }],
    },
    {
      name: 'Логистика цепей поставок',
      controlKind: 'credit',
      semester: 5,
      exam: { date: '2026-12-23', time: '12:00', room: '1-204' },
      assignments: [{ key: 'abstract', title: 'Реферат по складской логистике', dayOffset: 9, maxPoints: 25 }],
    },
    {
      name: 'Деловой английский',
      controlKind: 'credit',
      semester: 5,
      exam: { date: '2026-12-25', time: '08:30', room: '3-118' },
      assignments: [{ key: 'presentation', title: 'Презентация на английском', dayOffset: 8, maxPoints: 20 }],
    },
    // Прошлый семестр: сданное и долг (решение пользователя 13.11.2026).
    { name: 'Статистика', controlKind: 'exam', semester: 4, assignments: [] },
    { name: 'Маркетинг', controlKind: 'credit', semester: 4, assignments: [] },
    // Долг: на экзамене меньше 20 баллов; пересдачу кафедра назначила на Д+4 (приказ № 277: не позже чем за 3 дня).
    // Контроль не в воскресенье (planControlDates): даты в текстах — {exam.<название>}, а не {d+N}.
    { name: 'Эконометрика', controlKind: 'exam', semester: 4, exam: { dayOffset: 4, time: '14:00', room: '1-305' }, assignments: [] },
  ],
}

const GROUP_2: GroupSpec = {
  name: GROUP_ENGINEERING,
  faculty: FACULTY_ENGINEERING,
  week: WEEK_ENGINEERING,
  changes: [
    { key: 'math-room', discipline: 'Математический анализ', lessonKind: 'seminar', dayOffset: 1, kind: 'room_changed', newRoom: '4-404' },
    {
      key: 'prog-cancel',
      discipline: 'Программирование на Python',
      lessonKind: 'lab',
      dayOffset: 3,
      kind: 'cancelled',
      note: 'компьютерный класс на обслуживании',
    },
  ],
  disciplines: [
    { name: 'Математический анализ', controlKind: 'exam', semester: 3, exam: { date: '2026-12-30', time: '10:00', room: '4-501' }, assignments: [] },
    {
      name: 'Физика',
      controlKind: 'exam',
      semester: 3,
      exam: { date: '2027-01-14', time: '10:00', room: '4-501' },
      assignments: [{ key: 'lab4', title: 'Отчёт по лабораторной №4', dayOffset: 3, maxPoints: 10 }],
    },
    { name: 'Программирование на Python', controlKind: 'credit', semester: 3, exam: { date: '2026-12-22', time: '08:30', room: '4-310' }, assignments: [] },
    {
      name: 'Инженерная графика',
      controlKind: 'credit',
      semester: 3,
      exam: { date: '2026-12-24', time: '12:00', room: '4-118' },
      assignments: [{ key: 'drawing', title: 'Чертёж детали с разрезом', dayOffset: 4, maxPoints: 15 }],
    },
    // Дисциплина без баллов, пар в расписании нет: проект без аудиторных занятий (состояние «баллы бывают пустыми»).
    { name: 'Основы проектной работы', controlKind: 'credit', semester: 3, exam: { date: '2026-12-26', time: '10:15', room: '4-402' }, assignments: [] },
    { name: 'Линейная алгебра', controlKind: 'exam', semester: 2, assignments: [] },
    { name: 'Информатика', controlKind: 'exam', semester: 2, assignments: [] },
    { name: 'История России', controlKind: 'credit', semester: 2, assignments: [] },
  ],
}

export const MAIN_COHORT: CohortSpec = {
  cohort: 'main',
  passwordPublished: true,
  staff: { login: 'dekanat', password: 'demo-dekanat-2026' },
  groups: [GROUP_1, GROUP_2],
  students: [
    {
      login: 'belozerov',
      password: 'demo-student-1-2026',
      fullName: 'Белозёров Кирилл Андреевич',
      faculty: FACULTY_ECONOMICS,
      programme: 'Экономика',
      course: 3,
      groupName: GROUP_ECONOMICS,
      grades: [
        { discipline: 'Микроэкономика', points: 41, outcome: 'pending' },
        { discipline: 'Корпоративные финансы', points: 22, outcome: 'pending', admitted: false },
        { discipline: 'Логистика цепей поставок', points: 38, outcome: 'pending' },
        { discipline: 'Деловой английский', points: 44, outcome: 'pending' },
        { discipline: 'Статистика', points: 79, outcome: '4' },
        { discipline: 'Маркетинг', points: 72, outcome: 'credit' },
        // 32 за семестр и 9 на экзамене; в базе одно число (черновик, 2.1).
        { discipline: 'Эконометрика', points: 41, outcome: '2' },
      ],
      requests: [
        {
          key: 'cert-parents',
          kind: 'dean_certificate',
          purpose: 'parents_workplace',
          note: null,
          steps: [
            { status: 'submitted', dayOffset: -4 },
            { status: 'in_progress', dayOffset: -3 },
            { status: 'ready', dayOffset: -3 },
          ],
        },
        {
          key: 'cert-military',
          kind: 'dean_certificate',
          purpose: 'on_demand',
          note: 'Для райвоенкомата «Северный-7»',
          steps: [
            { status: 'submitted', dayOffset: -14 },
            { status: 'in_progress', dayOffset: -13 },
            { status: 'ready', dayOffset: -12 },
            { status: 'issued', dayOffset: -11 },
          ],
        },
        {
          key: 'aid',
          kind: 'financial_aid',
          note: null,
          steps: [
            { status: 'submitted', dayOffset: -9 },
            { status: 'in_progress', dayOffset: -7 },
          ],
        },
      ],
      notifications: [
        {
          key: 'cert-ready',
          kind: 'reminder',
          title: 'Справка готова: заберите до {pickup.cert-parents}',
          body: 'Справка из деканата, кабинет 105, 1 корпус. Возьмите студенческий билет',
          link: '/requests/{id.cert-parents}',
          unread: true,
        },
        {
          key: 'rz3',
          kind: 'reminder',
          title: 'Срок через {left.rz3}: Расчётная работа №3',
          body: 'Микроэкономика, 20 баллов',
          link: '/grades',
          unread: true,
        },
        {
          key: 'aid-originals',
          kind: 'reminder',
          title: 'Осталось {left.aid}: принесите оригиналы для материальной помощи',
          body: 'Оригиналы документов — в деканат, кабинет 124, 1 корпус, до {due.aid}',
          link: '/requests/{id.aid}',
          unread: true,
        },
        {
          key: 'micro-move',
          kind: 'reminder',
          title: 'Пара перенесена: Микроэкономика, {wd.micro-move}, 5 пара',
          body: 'Новое время — 15:45–17:15, аудитория та же',
          link: '/schedule',
          unread: true,
        },
        {
          key: 'logistics-cancel',
          kind: 'reminder',
          title: 'Пара отменена: Логистика цепей поставок, {wd.logistics-cancel}',
          body: 'Причина: {note.logistics-cancel}',
          link: '/schedule',
          unread: true,
        },
        {
          key: 'resit',
          kind: 'news',
          title: 'Пересдача по эконометрике',
          body: 'Кафедра назначила пересдачу на {exam.Эконометрика}, 14:00, аудитория 1-305. Заявление не нужно',
          link: '/notifications',
          unread: false,
        },
      ],
      markers: {
        profile: 'Белозёров',
        schedule: 'Громов',
        grades: 'Маркетинг',
        requests: 'Северный-7',
        notifications: 'Расчётная работа №3',
      },
    },
    {
      login: 'nesterova',
      password: 'demo-student-2-2026',
      fullName: 'Нестерова Алина Павловна',
      faculty: FACULTY_ENGINEERING,
      programme: 'Информационные системы и технологии',
      course: 2,
      groupName: GROUP_ENGINEERING,
      grades: [
        { discipline: 'Математический анализ', points: 52, outcome: 'pending' },
        { discipline: 'Физика', points: 47, outcome: 'pending' },
        // 61 балл, а зачёт ещё не проведён: итог «впереди» — прототип не ставит «зачтено» раньше даты.
        { discipline: 'Программирование на Python', points: 61, outcome: 'pending' },
        { discipline: 'Инженерная графика', points: 46, outcome: 'pending' },
        { discipline: 'Основы проектной работы', points: null, outcome: 'pending' },
        { discipline: 'Линейная алгебра', points: 92, outcome: '5' },
        { discipline: 'Информатика', points: 87, outcome: '5' },
        { discipline: 'История России', points: 88, outcome: 'credit' },
      ],
      requests: [
        {
          key: 'tuition',
          kind: 'tuition_certificate',
          paymentYear: 2025,
          note: 'Для налогового вычета, договор «Зелёная-3»',
          steps: [
            { status: 'submitted', dayOffset: -4 },
            { status: 'in_progress', dayOffset: -3 },
          ],
        },
        {
          key: 'cert-study',
          kind: 'dean_certificate',
          purpose: 'study_period',
          note: null,
          steps: [
            { status: 'submitted', dayOffset: -6 },
            { status: 'rejected', dayOffset: -5, note: 'Такую справку выдают по заявлению в деканате. Подайте заявление лично' },
          ],
          rejectReason: 'not_eligible',
        },
        {
          key: 'cert-residence',
          kind: 'dean_certificate',
          purpose: 'residence',
          note: null,
          steps: [{ status: 'submitted', dayOffset: 0 }],
        },
      ],
      notifications: [
        {
          key: 'cert-rejected',
          kind: 'reminder',
          title: 'Заявка отклонена: справка о периоде обучения',
          body: 'Причина: Нет оснований для выдачи. Можно подать снова',
          link: '/requests/{id.cert-study}',
          unread: true,
        },
        {
          key: 'math-room',
          kind: 'reminder',
          title: 'Аудитория изменена: Математический анализ, {wd.math-room}',
          body: 'Было и стало: {note.math-room}',
          link: '/schedule',
          unread: true,
        },
        {
          key: 'lab4',
          kind: 'reminder',
          title: 'Срок через {left.lab4}: Отчёт по лабораторной №4',
          body: 'Физика, 10 баллов',
          link: '/grades',
          unread: false,
        },
        {
          key: 'olympiad',
          kind: 'news',
          title: 'Олимпиада по программированию',
          body: 'Регистрация открыта до {d+7}. Участники получат диплом',
          link: '/notifications',
          unread: true,
        },
      ],
      markers: {
        profile: 'Нестерова',
        schedule: 'Зайцев',
        grades: 'Линейная алгебра',
        requests: 'Зелёная-3',
        notifications: 'Отчёт по лабораторной №4',
      },
    },
  ],
  // Девять объявлений; «оба факультета» — две строки в базе (раздел 6 черновика).
  announcements: [
    {
      key: 'a1',
      faculties: [FACULTY_ECONOMICS, FACULTY_ENGINEERING],
      title: 'Материальная помощь: комиссия 1–15 декабря',
      body: 'Заявления принимаются в кабинете до 31 декабря. Оригиналы документов принесите в течение 10 дней после согласования заявления, кабинет 124, 1 корпус',
      dayOffset: -2,
    },
    {
      key: 'a2',
      faculties: [FACULTY_ECONOMICS, FACULTY_ENGINEERING],
      title: 'Расписание зимней сессии',
      body: 'Сессия — с 28 декабря по 24 января. Расписание экзаменов появится в кабинете не позже чем за 15 дней до начала',
      dayOffset: -5,
    },
    {
      key: 'a3',
      faculties: [FACULTY_ECONOMICS, FACULTY_ENGINEERING],
      title: 'Повышенная стипендия: приём документов',
      body: 'Документы на конкурс принимаются до {d+10}, 16:00. После этого срока заявки не рассматриваются',
      dayOffset: -3,
    },
    {
      key: 'a4',
      groupName: GROUP_ECONOMICS,
      title: 'Пересдача по эконометрике',
      body: 'Кафедра назначила пересдачу на {exam.Эконометрика}, 14:00, аудитория 1-305. Заявление не нужно',
      dayOffset: -3,
    },
    {
      key: 'a5',
      groupName: GROUP_ECONOMICS,
      title: 'Консультация перед экзаменом по микроэкономике',
      // Накануне экзамена; экзамен в понедельник — консультация в субботу, и тогда «в понедельник» (seed-plan.ts, eve).
      body: 'Консультация — {eve.Микроэкономика}, 12:00, аудитория 1-305. Экзамен — {after-eve.Микроэкономика}',
      dayOffset: 0,
    },
    {
      key: 'a6',
      faculties: [FACULTY_ECONOMICS, FACULTY_ENGINEERING],
      title: 'Оценки за экзамены',
      body: 'Оценка за экзамен появится в кабинете на следующий день после экзамена, за зачёт — до конца сессии',
      dayOffset: -7,
    },
    {
      key: 'a7',
      faculties: [FACULTY_ECONOMICS, FACULTY_ENGINEERING],
      title: 'Сроки недели',
      body: 'Что важно на этой неделе: пересдачи по расписанию кафедр, приём документов на повышенную стипендию, окно комиссии по материальной помощи',
      dayOffset: 0,
    },
    {
      key: 'a8',
      faculties: [FACULTY_ENGINEERING],
      title: 'Олимпиада по программированию',
      body: 'Регистрация открыта до {d+7}. Участники получат диплом',
      dayOffset: -3,
    },
    {
      key: 'a9',
      faculties: [FACULTY_ECONOMICS, FACULTY_ENGINEERING],
      title: 'Ярмарка стажировок',
      body: '{d+9}, с 12:00 до 16:00. Резюме подготовьте заранее',
      dayOffset: -4,
    },
  ],
}
