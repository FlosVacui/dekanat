// Набор вымышленных данных без базы: что вычисляет seed-plan.ts на день Д (пакет 3.8, черновик данных docs/data/draft.md).
// Главное — привязка к дню недели: тесты и посетители заполняют базу в любой день, поэтому всё проверяется на каждом из
// семи дней недели в роли Д и на двух неделях подряд (верхней и нижней).
import { describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import {
  LESSONS_AHEAD_DAYS,
  LESSONS_BACK_DAYS,
  PAIR_TIMES,
  buildCohortPlan,
  daysPhrase,
  toWorkday,
  weekKindOf,
  weekdayOf,
  type CohortPlan,
  type PlannedLesson,
} from '../../db/seed-plan'
import { addDays, addWorkingDays, formatDate, weekInfo } from '../../src/lib/dates'
import { REQUEST_KIND_INFO, computeDueDate, computePickupUntil } from '../../src/lib/requests'

const MONDAY = '2026-11-23' // первый день экспертизы; 13-я неделя семестра, верхняя
/** Четырнадцать дней подряд: каждый день недели дважды, при верхней и при нижней неделе. */
const TWO_WEEKS = Array.from({ length: 14 }, (_, i) => addDays(MONDAY, i))

const [student1, student2] = MAIN_COHORT.students
if (!student1 || !student2) throw new Error('В основном наборе должно быть два студента')
const [group1, group2] = MAIN_COHORT.groups
if (!group1 || !group2) throw new Error('В основном наборе должно быть две группы')

const lessonsOf = (plan: CohortPlan, groupName: string) => plan.lessons.filter((l) => l.groupName === groupName)
const onDay = (plan: CohortPlan, groupName: string, date: string) => lessonsOf(plan, groupName).filter((l) => l.date === date)
const changed = (plan: CohortPlan, groupName: string) => lessonsOf(plan, groupName).filter((l) => l.change !== null)
const dayWord = (n: number) => ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][n]

describe('основной набор: состав по черновику', () => {
  const plan = buildCohortPlan(MAIN_COHORT, MONDAY)

  it('два факультета, две группы, два студента и сотрудник, логины и ФИО прежние', () => {
    expect(plan.groups.map((g) => [g.name, g.faculty])).toEqual([
      ['ЦЭ-24-03', 'Факультет цифровой экономики'],
      ['ЦИ-25-01', 'Факультет цифровой инженерии'],
    ])
    expect(MAIN_COHORT.students.map((s) => [s.login, s.fullName, s.course])).toEqual([
      ['belozerov', 'Белозёров Кирилл Андреевич', 3],
      ['nesterova', 'Нестерова Алина Павловна', 2],
    ])
    expect(MAIN_COHORT.staff.login).toBe('dekanat')
    expect(MAIN_COHORT.passwordPublished).toBe(true)
  })

  it('сетка пар — приказ № 290: 8:30–10:00 … 20:30–22:00', () => {
    expect(Object.values(PAIR_TIMES)).toEqual([
      ['08:30', '10:00'],
      ['10:15', '11:45'],
      ['12:00', '13:30'],
      ['14:00', '15:30'],
      ['15:45', '17:15'],
      ['17:20', '18:50'],
      ['18:55', '20:25'],
      ['20:30', '22:00'],
    ])
    for (const l of plan.lessons) expect([l.startsAt, l.endsAt]).toEqual([...PAIR_TIMES[l.pair]!])
  })

  it('пары от Д-7 до Д+27, воскресенья без пар', () => {
    const dates = plan.lessons.map((l) => l.date).sort()
    expect(dates[0]! >= addDays(MONDAY, -LESSONS_BACK_DAYS)).toBe(true)
    expect(dates[dates.length - 1]! <= addDays(MONDAY, LESSONS_AHEAD_DAYS)).toBe(true)
    expect(lessonsOf(plan, group1.name).some((l) => l.date === addDays(MONDAY, -LESSONS_BACK_DAYS))).toBe(true)
    // Д+25 — пятница: последний день с парами в окне; Д+26 — суббота нижней недели без пар, Д+27 — воскресенье.
    expect(lessonsOf(plan, group1.name).some((l) => l.date === addDays(MONDAY, LESSONS_AHEAD_DAYS - 2))).toBe(true)
    expect(plan.lessons.filter((l) => weekdayOf(l.date) === 0)).toEqual([])
  })

  it('верхняя и нижняя неделя дают разные дни (группа 1)', () => {
    expect(weekInfo('2026-11-23')?.kind).toBe('верхняя')
    expect(weekInfo('2026-11-30')?.kind).toBe('нижняя')
    const pairs = (date: string) => onDay(plan, group1.name, date).map((l) => l.pair)
    // Вторник: на нижней неделе добавляется четвёртая пара — лабораторная.
    expect(pairs('2026-11-24')).toEqual([2, 3])
    expect(pairs('2026-12-01')).toEqual([2, 3, 4])
    expect(onDay(plan, group1.name, '2026-12-01')[2]).toMatchObject({ discipline: 'Корпоративные финансы', kind: 'lab', room: '2-301' })
    // Четверг: верхняя — пар нет, нижняя — лекция по микроэкономике.
    expect(pairs('2026-11-26')).toEqual([])
    expect(onDay(plan, group1.name, '2026-12-03')).toMatchObject([{ pair: 2, discipline: 'Микроэкономика', kind: 'lecture', room: '1-412' }])
    // Суббота: верхняя — деловой английский, нижняя — пар нет.
    expect(onDay(plan, group1.name, '2026-11-28')).toMatchObject([{ pair: 1, discipline: 'Деловой английский' }])
    expect(pairs('2026-12-05')).toEqual([])
    // Понедельник, среда, пятница — одинаковые на обеих неделях.
    for (const [upper, lower] of [['2026-11-23', '2026-11-30'], ['2026-11-25', '2026-12-02'], ['2026-11-27', '2026-12-04']] as const) {
      expect(pairs(upper)).toEqual(pairs(lower))
    }
  })

  it('верхняя и нижняя неделя дают разные дни (группа 2): в пятницу пара 3 — физика или инженерная графика', () => {
    expect(onDay(plan, group2.name, '2026-11-27')).toMatchObject([{ pair: 3, discipline: 'Физика', teacher: 'Белова С. А.' }])
    expect(onDay(plan, group2.name, '2026-12-04')).toMatchObject([{ pair: 3, discipline: 'Инженерная графика', teacher: 'Кравец Ю. Г.' }])
    expect(onDay(plan, group2.name, '2026-11-28')).toEqual([])
    expect(onDay(plan, group2.name, '2026-12-05')).toEqual([])
  })

  it('чётность недели считает weekInfo; до начала семестра чередование продолжается назад', () => {
    expect(weekKindOf('2026-11-23')).toBe('upper')
    expect(weekKindOf('2026-11-30')).toBe('lower')
    expect(weekKindOf('2026-08-31')).toBe('upper')
    expect(weekKindOf('2026-08-24')).toBe('lower')
    expect(weekKindOf('2026-08-17')).toBe('upper')
  })

  it('шесть заявок, девять объявлений (15 строк), десять уведомлений', () => {
    expect(plan.students.map((s) => s.requests.length)).toEqual([3, 3])
    expect(plan.students.map((s) => s.notifications.length)).toEqual([6, 4])
    expect(new Set(plan.announcements.map((a) => a.key)).size).toBe(9)
    expect(plan.announcements).toHaveLength(15)
    // «Оба факультета» — две строки, у каждой свой адресат-факультет.
    const a1 = plan.announcements.filter((a) => a.key === 'a1')
    expect(a1.map((a) => a.faculty).sort()).toEqual(['Факультет цифровой инженерии', 'Факультет цифровой экономики'])
    expect(a1.every((a) => a.groupId === null)).toBe(true)
    expect(plan.announcements.filter((a) => a.key === 'a4').map((a) => a.groupId)).toEqual([plan.groups[0]!.id])
    expect(plan.announcements.filter((a) => a.key === 'a8').map((a) => a.faculty)).toEqual(['Факультет цифровой инженерии'])
  })

  it('ключи заявок, работ и изменений в наборе не повторяются: по ним подставляются значения', () => {
    const keys = [
      ...MAIN_COHORT.groups.flatMap((g) => g.changes.map((c) => `change:${c.key}`)),
      ...MAIN_COHORT.groups.flatMap((g) => g.disciplines.flatMap((d) => d.assignments.map((a) => `work:${a.key}`))),
      ...MAIN_COHORT.students.flatMap((s) => s.requests.map((r) => `request:${r.key}`)),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('привязка изменений пар при любом дне недели в роли Д', () => {
  it.each(TWO_WEEKS)('Д = %s: пять изменений у группы 1 и два у группы 2, каждое на своей паре внутри окна Д…Д+6', (today) => {
    const plan = buildCohortPlan(MAIN_COHORT, today)
    const windowEnd = addDays(today, 6)
    const first = changed(plan, group1.name)
    const second = changed(plan, group2.name)
    expect(first).toHaveLength(5)
    expect(second).toHaveLength(2)
    for (const l of [...first, ...second]) {
      expect(l.date >= today && l.date <= windowEnd, `${l.change?.key}: ${l.date} вне окна`).toBe(true)
    }
    expect(first.map((l) => l.change!.kind).sort()).toEqual(['cancelled', 'moved', 'moved', 'room_changed', 'teacher_changed'])
    expect(second.map((l) => l.change!.kind).sort()).toEqual(['cancelled', 'room_changed'])
    // Один вид изменения — одна пара: на паре не больше одного изменения (экран склеил бы две строки).
    expect(new Set(first.map((l) => l.id)).size).toBe(5)
  })

  it.each(TWO_WEEKS)('Д = %s: смена аудитории студента 1 видна на экране «Сегодня» (дни Д и Д+1)', (today) => {
    const plan = buildCohortPlan(MAIN_COHORT, today)
    const tomorrow = addDays(today, 1)
    const room = changed(plan, group1.name).find((l) => l.change!.kind === 'room_changed')!
    const lessonsOnScreenDays = lessonsOf(plan, group1.name).filter((l) => l.date === today || l.date === tomorrow)
    if (lessonsOnScreenDays.length > 0) {
      expect([today, tomorrow], `смена аудитории на ${room.date}, а экран показывает ${today} и ${tomorrow}`).toContain(room.date)
      expect(room.change).toMatchObject({ kind: 'room_changed', newRoom: '2-108', note: `${room.room} → 2-108` })
    } else {
      // Суббота нижней недели: пар нет ни в день Д, ни в воскресенье Д+1 — показать нечем, изменение остаётся в окне Д…Д+6.
      expect(weekdayOf(today)).toBe(6)
      expect(weekKindOf(today)).toBe('lower')
    }
  })

  it('на 200 днях подряд (зима, весна, лето) набор строится: пять и два изменения в окне, смена аудитории на экране при парах', () => {
    for (let i = 0; i < 200; i += 1) {
      const today = addDays('2026-09-01', i)
      const plan = buildCohortPlan(MAIN_COHORT, today)
      const windowEnd = addDays(today, 6)
      expect(changed(plan, group1.name), today).toHaveLength(5)
      expect(changed(plan, group2.name), today).toHaveLength(2)
      for (const l of plan.lessons.filter((x) => x.change)) expect(l.date >= today && l.date <= windowEnd, today).toBe(true)
      const screenLessons = lessonsOf(plan, group1.name).filter((l) => l.date === today || l.date === addDays(today, 1))
      const room = changed(plan, group1.name).find((l) => l.change!.kind === 'room_changed')!
      if (screenLessons.length > 0) expect([today, addDays(today, 1)], today).toContain(room.date)
    }
  })

  it('день Д — понедельник: изменения ровно по таблице черновика, раздел 3.1 и 3.2', () => {
    const plan = buildCohortPlan(MAIN_COHORT, MONDAY)
    const at = (groupName: string, key: string): PlannedLesson => lessonsOf(plan, groupName).find((l) => l.change?.key === key)!
    const shape = (l: PlannedLesson) => [addDaysFrom(l.date), l.pair, l.discipline, l.kind, l.change!.kind]
    const addDaysFrom = (date: string) => Math.round((Date.parse(date) - Date.parse(MONDAY)) / 86_400_000)
    expect(shape(at(group1.name, 'cf-room'))).toEqual([1, 2, 'Корпоративные финансы', 'lecture', 'room_changed'])
    expect(at(group1.name, 'cf-room').change).toMatchObject({ note: '2-210 → 2-108', newRoom: '2-108' })
    expect(shape(at(group1.name, 'micro-move'))).toEqual([2, 3, 'Микроэкономика', 'seminar', 'moved'])
    expect(shape(at(group1.name, 'logistics-cancel'))).toEqual([4, 2, 'Логистика цепей поставок', 'lecture', 'cancelled'])
    expect(at(group1.name, 'logistics-cancel').change!.note).toBe('преподаватель в командировке')
    expect(shape(at(group1.name, 'cf-move'))).toEqual([4, 3, 'Корпоративные финансы', 'seminar', 'moved'])
    expect(shape(at(group1.name, 'english-teacher'))).toEqual([5, 1, 'Деловой английский', 'seminar', 'teacher_changed'])
    expect(at(group1.name, 'english-teacher').change!.note).toBe('Ведёт Яковлева А. С. вместо Мельник Д. О.')
    expect(shape(at(group2.name, 'math-room'))).toEqual([1, 2, 'Математический анализ', 'seminar', 'room_changed'])
    expect(at(group2.name, 'math-room').change!.note).toBe('4-402 → 4-404')
    expect(shape(at(group2.name, 'prog-cancel'))).toEqual([3, 1, 'Программирование на Python', 'lab', 'cancelled'])
    expect(at(group2.name, 'prog-cancel').change!.note).toBe('компьютерный класс на обслуживании')
  })

  it.each(TWO_WEEKS)('Д = %s: четыре поля переноса заполнены по виду изменения', (today) => {
    const plan = buildCohortPlan(MAIN_COHORT, today)
    const moves = changed(plan, group1.name).filter((l) => l.change!.kind === 'moved')
    expect(moves).toHaveLength(2)
    const sameDay = moves.find((l) => l.change!.key === 'micro-move')!
    // Перенос внутри дня: новое время, новой даты и аудитории нет.
    expect(sameDay.change).toMatchObject({ newDate: null, newStartsAt: '15:45', newEndsAt: '17:15', newRoom: null })
    // Перенос на другой день: суббота после пары, вторая пара, 2-214.
    const otherDay = moves.find((l) => l.change!.key === 'cf-move')!
    expect(otherDay.change).toMatchObject({ newStartsAt: '10:15', newEndsAt: '11:45', newRoom: '2-214' })
    expect(weekdayOf(otherDay.change!.newDate!)).toBe(6)
    expect(otherDay.change!.newDate! > otherDay.date).toBe(true)
    expect(otherDay.change!.newDate! <= addDays(otherDay.date, 6)).toBe(true)
    for (const l of changed(plan, group1.name).filter((x) => x.change!.kind !== 'moved')) {
      expect(l.change!.newDate).toBeNull()
      expect(l.change!.newStartsAt).toBeNull()
    }
  })
})

describe('дисциплины, работы, оценки', () => {
  it.each(TWO_WEEKS)('Д = %s: срок работы не выпадает на субботу и воскресенье', (today) => {
    const plan = buildCohortPlan(MAIN_COHORT, today)
    const works = plan.disciplines.flatMap((d) => d.assignments)
    expect(works).toHaveLength(6)
    for (const w of works) {
      expect([0, 6], `${w.title}: ${w.dueDate}`).not.toContain(weekdayOf(w.dueDate))
      expect(w.dueDate >= today).toBe(true)
    }
  })

  it('сроки работ при Д-понедельнике — по черновику: Д+2, Д+7, Д+9, Д+8, Д+3, Д+4', () => {
    const plan = buildCohortPlan(MAIN_COHORT, MONDAY)
    const due = Object.fromEntries(plan.disciplines.flatMap((d) => d.assignments).map((w) => [w.title, w.dueDate]))
    expect(due).toEqual({
      'Расчётная работа №3': addDays(MONDAY, 2),
      'Кейс по оценке проекта': addDays(MONDAY, 7),
      'Реферат по складской логистике': addDays(MONDAY, 9),
      'Презентация на английском': addDays(MONDAY, 8),
      'Отчёт по лабораторной №4': addDays(MONDAY, 3),
      'Чертёж детали с разрезом': addDays(MONDAY, 4),
    })
  })

  it('выходные сдвигаются на понедельник', () => {
    expect(toWorkday('2026-11-28')).toBe('2026-11-30')
    expect(toWorkday('2026-11-29')).toBe('2026-11-30')
    expect(toWorkday('2026-11-27')).toBe('2026-11-27')
  })

  it('оценки: у студента 1 долг, пересдача и допуск без баллов; у студента 2 дисциплина без баллов', () => {
    const plan = buildCohortPlan(MAIN_COHORT, MONDAY)
    const [p1, p2] = plan.students
    expect(p1!.grades).toHaveLength(7)
    expect(p1!.grades.find((g) => g.discipline === 'Эконометрика')).toMatchObject({ points: 41, outcome: '2' })
    expect(p1!.grades.find((g) => g.discipline === 'Корпоративные финансы')).toMatchObject({ points: 22, admitted: false })
    expect(p1!.grades.find((g) => g.discipline === 'Маркетинг')).toMatchObject({ outcome: 'credit' })
    expect(p2!.grades).toHaveLength(8)
    expect(p2!.grades.find((g) => g.discipline === 'Основы проектной работы')).toMatchObject({ points: null, outcome: 'pending' })
    const resit = plan.disciplines.find((d) => d.name === 'Эконометрика')!
    expect([resit.examDate, resit.examTime, resit.examRoom]).toEqual([addDays(MONDAY, 4), '14:00', '1-305'])
    // Сессия текущего семестра — после 21 декабря: «Сданное и долг — в прошлый семестр».
    const micro = plan.disciplines.find((d) => d.name === 'Микроэкономика')!
    expect([micro.examDate, micro.examTime]).toEqual([addDays(MONDAY, 36), '10:00'])
    expect(plan.disciplines.filter((d) => d.groupName === group2.name && d.name === 'Основы проектной работы')[0]!.assignments).toEqual([])
  })

  it('по «Основам проектной работы» пар в расписании нет', () => {
    const plan = buildCohortPlan(MAIN_COHORT, MONDAY)
    expect(plan.lessons.some((l) => l.discipline === 'Основы проектной работы')).toBe(false)
  })
})

describe('заявки: путь по шагам, сроки считают функции кода', () => {
  const requestOf = (plan: CohortPlan, login: string, key: string) =>
    plan.students.find((s) => s.spec.login === login)!.requests.find((r) => r.key === key)!

  it.each(TWO_WEEKS)('Д = %s: у каждой заявки шагов столько, сколько в черновике; сроки равны результату функций', (today) => {
    const plan = buildCohortPlan(MAIN_COHORT, today)
    const expectedSteps = {
      'cert-parents': ['submitted', 'in_progress', 'ready'],
      'cert-military': ['submitted', 'in_progress', 'ready', 'issued'],
      aid: ['submitted', 'in_progress'],
      tuition: ['submitted', 'in_progress'],
      'cert-study': ['submitted', 'rejected'],
      'cert-residence': ['submitted'],
    } as const
    const all = plan.students.flatMap((s) => s.requests)
    expect(all.map((r) => r.key).sort()).toEqual(Object.keys(expectedSteps).sort())
    for (const r of all) {
      expect(r.steps.map((s) => s.status), r.key).toEqual(expectedSteps[r.key as keyof typeof expectedSteps])
      expect(r.status).toBe(r.steps[r.steps.length - 1]!.status)
      const dayOf = (status: string) => r.steps.find((s) => s.status === status)?.date
      expect(r.dueDate, `${r.key}: срок изготовления`).toBe(dayOf('in_progress') ? computeDueDate(r.kind, dayOf('in_progress')!) : null)
      expect(r.pickupUntil, `${r.key}: срок получения`).toBe(dayOf('ready') ? computePickupUntil(r.kind, dayOf('ready')!) : null)
      expect(r.issuedOn, `${r.key}: день выдачи`).toBe(dayOf('issued') ?? null)
      // Шаги идут от прошлого к Д; ни один не в будущем.
      const dates = r.steps.map((s) => s.date)
      expect([...dates].sort()).toEqual(dates)
      expect(dates[dates.length - 1]! <= today).toBe(true)
    }
  })

  it('Д-понедельник: сроки как в черновике, раздел 5.2', () => {
    const plan = buildCohortPlan(MAIN_COHORT, MONDAY)
    const parents = requestOf(plan, 'belozerov', 'cert-parents')
    expect(parents.steps.map((s) => s.date)).toEqual([addDays(MONDAY, -4), addDays(MONDAY, -3), addDays(MONDAY, -3)])
    expect(parents.pickupUntil).toBe(addDays(MONDAY, 1)) // «до <Д+1>»
    expect(parents).toMatchObject({ purpose: 'parents_workplace', paymentYear: null, note: null })
    const military = requestOf(plan, 'belozerov', 'cert-military')
    expect(military.issuedOn).toBe(addDays(MONDAY, -11))
    expect(military).toMatchObject({ purpose: 'on_demand', note: 'Для райвоенкомата «Северный-7»' })
    const aid = requestOf(plan, 'belozerov', 'aid')
    expect(aid.dueDate).toBe(addDays(MONDAY, 3)) // оригиналы — «до <Д+3>»
    expect(aid).toMatchObject({ purpose: null, paymentYear: null })
    const tuition = requestOf(plan, 'nesterova', 'tuition')
    expect(tuition.dueDate).toBe(addWorkingDays(addDays(MONDAY, -3), 10))
    expect(tuition).toMatchObject({ purpose: null, paymentYear: 2025, note: 'Для налогового вычета, договор «Зелёная-3»' })
    const rejected = requestOf(plan, 'nesterova', 'cert-study')
    expect(rejected).toMatchObject({ status: 'rejected', rejectReason: 'not_eligible', purpose: 'study_period', dueDate: null })
    expect(rejected.steps[1]!.note).toBe('Такую справку выдают по заявлению в деканате. Подайте заявление лично')
    expect(requestOf(plan, 'nesterova', 'cert-residence')).toMatchObject({ status: 'submitted', purpose: 'residence' })
  })

  it('все пять статусов есть в наборе; события: «Подана» от студента, остальные от сотрудника', () => {
    const plan = buildCohortPlan(MAIN_COHORT, MONDAY)
    expect(new Set(plan.students.flatMap((s) => s.requests.map((r) => r.status)))).toEqual(
      new Set(['submitted', 'in_progress', 'ready', 'issued', 'rejected']),
    )
    for (const s of plan.students) for (const r of s.requests) for (const step of r.steps) expect(step.byStudent).toBe(step.status === 'submitted')
  })

  it('поля вида подходят ограничениям базы: назначение — у справки из деканата, год — у справки об оплате, не меньше 2024', () => {
    const plan = buildCohortPlan(MAIN_COHORT, MONDAY)
    for (const r of plan.students.flatMap((s) => s.requests)) {
      expect(r.purpose !== null, r.key).toBe(r.kind === 'dean_certificate')
      expect(r.paymentYear !== null, r.key).toBe(r.kind === 'tuition_certificate')
      if (r.paymentYear !== null) expect(r.paymentYear).toBeGreaterThanOrEqual(2024)
    }
  })

  it('кабинет справки из деканата — «105, 1 корпус»; «120а» нигде нет', () => {
    expect(REQUEST_KIND_INFO.dean_certificate.room).toBe('105, 1 корпус')
    expect(REQUEST_KIND_INFO.dean_certificate.pickup).toContain('кабинет 105, 1 корпус')
    expect(JSON.stringify(MAIN_COHORT)).not.toContain('120а')
    expect(REQUEST_KIND_INFO.tuition_certificate.room).toBe('118, 1 корпус')
    expect(REQUEST_KIND_INFO.financial_aid.room).toBe('124, 1 корпус')
  })
})

describe('объявления и уведомления', () => {
  it.each(TWO_WEEKS)('Д = %s: в текстах нет неподставленных значений; сроки в заголовках совпадают с датами', (today) => {
    const plan = buildCohortPlan(MAIN_COHORT, today)
    for (const text of [
      ...plan.announcements.flatMap((a) => [a.title, a.body]),
      ...plan.students.flatMap((s) => s.notifications.flatMap((n) => [n.title, n.body, n.link ?? ''])),
    ]) {
      expect(text).not.toMatch(/[{}]/)
    }
    const rz3 = plan.disciplines.flatMap((d) => d.assignments).find((w) => w.key === 'rz3')!
    const titles = plan.students[0]!.notifications.map((n) => n.title)
    expect(titles).toContain(`Срок через ${daysPhrase(Math.round((Date.parse(rz3.dueDate) - Date.parse(today)) / 86_400_000))}: Расчётная работа №3`)
    const parents = plan.students[0]!.requests.find((r) => r.key === 'cert-parents')!
    expect(titles).toContain(`Справка готова: заберите до ${formatDate(parents.pickupUntil!)}`)
    // День недели в заголовках — день недели пары, на которую пришлось изменение.
    const cancelled = changed(plan, group1.name).find((l) => l.change!.key === 'logistics-cancel')!
    expect(titles).toContain(`Пара отменена: Логистика цепей поставок, ${dayWord(weekdayOf(cancelled.date))}`)
  })

  it('Д-понедельник: заголовки как в таблице черновика, раздел 6', () => {
    const plan = buildCohortPlan(MAIN_COHORT, MONDAY)
    expect(plan.students[0]!.notifications.map((n) => [n.kind, n.title, n.unread])).toEqual([
      ['reminder', `Справка готова: заберите до ${formatDate(addDays(MONDAY, 1))}`, true],
      ['reminder', 'Срок через 2 дня: Расчётная работа №3', true],
      ['reminder', 'Осталось 3 дня: принесите оригиналы для материальной помощи', true],
      ['reminder', 'Пара перенесена: Микроэкономика, среда, 5 пара', true],
      ['reminder', 'Пара отменена: Логистика цепей поставок, пятница', true],
      ['news', 'Пересдача по эконометрике', false],
    ])
    expect(plan.students[1]!.notifications.map((n) => [n.kind, n.title, n.unread])).toEqual([
      ['reminder', 'Заявка отклонена: справка о периоде обучения', true],
      ['reminder', 'Аудитория изменена: Математический анализ, вторник', true],
      ['reminder', 'Срок через 3 дня: Отчёт по лабораторной №4', false],
      ['news', 'Олимпиада по программированию', true],
    ])
  })

  it('ссылки уведомлений — на существующие экраны', () => {
    const plan = buildCohortPlan(MAIN_COHORT, MONDAY)
    const ownRequests = (s: (typeof plan.students)[number]) => new Set(s.requests.map((r) => `/requests/${r.id}`))
    for (const s of plan.students) {
      for (const n of s.notifications) {
        const ok = n.link !== null && (['/grades', '/schedule', '/notifications', '/requests'].includes(n.link) || ownRequests(s).has(n.link))
        expect(ok, `${n.key}: ${n.link}`).toBe(true)
      }
    }
  })

  it('объявления: день публикации — сдвиг от Д; Д-2 … Д; тексты с датами подставлены', () => {
    const plan = buildCohortPlan(MAIN_COHORT, MONDAY)
    const byKey = (key: string) => plan.announcements.find((a) => a.key === key)!
    expect(byKey('a1').date).toBe(addDays(MONDAY, -2))
    expect(byKey('a5').date).toBe(MONDAY)
    expect(byKey('a6').date).toBe(addDays(MONDAY, -7))
    expect(byKey('a3').body).toContain(formatDate(addDays(MONDAY, 10)))
    expect(byKey('a5').body).toContain(formatDate(addDays(MONDAY, 35)))
    expect(byKey('a4').body).toContain(formatDate(addDays(MONDAY, 4)))
  })
})

describe('метки для тестов', () => {
  /** Всё, что видит студент: профиль, расписание группы, дисциплины, оценки, заявки, уведомления, объявления его группы и факультета. */
  function visibleTo(plan: CohortPlan, index: number): string {
    const s = plan.students[index]!
    const groupName = s.spec.groupName
    const groupId = s.groupId
    return JSON.stringify({
      profile: [s.spec.fullName, s.spec.faculty, s.spec.programme, s.spec.course, groupName],
      lessons: plan.lessons.filter((l) => l.groupName === groupName),
      disciplines: plan.disciplines.filter((d) => d.groupName === groupName),
      grades: s.grades,
      requests: s.requests,
      notifications: s.notifications,
      announcements: plan.announcements.filter((a) => a.groupId === groupId || a.faculty === s.spec.faculty),
    })
  }

  it.each(TWO_WEEKS.slice(0, 7))('Д = %s: слово-метка одного студента не встречается в данных другого', (today) => {
    const plan = buildCohortPlan(MAIN_COHORT, today)
    for (const [mine, other] of [[0, 1], [1, 0]] as const) {
      const own = visibleTo(plan, mine)
      const foreign = visibleTo(plan, other)
      const otherStudent = plan.students[other]!.spec
      expect(own).not.toContain(otherStudent.groupName)
      for (const marker of Object.values(plan.students[mine]!.spec.markers)) {
        expect(own, `своя метка «${marker}» пропала`).toContain(marker)
        expect(foreign, `метка «${marker}» студента ${mine + 1} есть в данных студента ${other + 1}`).not.toContain(marker)
      }
      expect(foreign).not.toContain(plan.students[mine]!.spec.fullName)
      expect(foreign).not.toContain(plan.students[mine]!.spec.login)
      expect(own).not.toContain(otherStudent.fullName)
    }
  })

  it('метки по таблице черновика, раздел 2.2', () => {
    expect(student1.markers).toEqual({
      profile: 'Белозёров',
      schedule: 'Громов',
      grades: 'Маркетинг',
      requests: 'Северный-7',
      notifications: 'Расчётная работа №3',
    })
    expect(student2.markers).toEqual({
      profile: 'Нестерова',
      schedule: 'Зайцев',
      grades: 'Линейная алгебра',
      requests: 'Зелёная-3',
      notifications: 'Отчёт по лабораторной №4',
    })
  })

  it('метка оценок студента 1 — сданный зачёт: сквозной тест ждёт «Итог: Зачтено»', () => {
    const grade = student1.grades.find((g) => g.discipline === student1.markers.grades)!
    expect(grade.outcome).toBe('credit')
    expect(MAIN_COHORT.groups[0]!.disciplines.find((d) => d.name === student1.markers.grades)?.controlKind).toBe('credit')
  })

  it('название работы — «Расчётная работа №3» без пробела после знака номера', () => {
    const titles = MAIN_COHORT.groups.flatMap((g) => g.disciplines.flatMap((d) => d.assignments.map((a) => a.title)))
    expect(titles).toContain('Расчётная работа №3')
    expect(titles.filter((t) => /№\s/.test(t))).toEqual([])
  })
})
