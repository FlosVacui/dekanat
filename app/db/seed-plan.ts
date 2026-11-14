// Формат набора вымышленных данных и расчёт строк набора на день Д. Чистая логика: базы здесь нет, поэтому её
// проверяют модульные тесты при любом дне недели в роли Д (tests/unit/seed-plan.test.ts).
// Источник данных — docs/data/draft.md, версия 2. Все люди, названия и даты придуманы (ТР-5).
import { createHash } from 'node:crypto'
import { addDays, formatDate, SEMESTER_START, weekInfo } from '../src/lib/dates'
import {
  computeDueDate,
  computePickupUntil,
  isAllowedTransition,
  type DeanPurpose,
  type RejectReason,
  type RequestKind,
  type RequestStatus,
} from '../src/lib/requests'

// ---------- Формат набора ----------

export type LessonKind = 'lecture' | 'seminar' | 'lab'
/** День недели как в `Date.getUTCDay()`: 1 — понедельник … 6 — суббота. Воскресенье — без пар. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6
export type WeekPart = 'upper' | 'lower' | 'both'

/** Пара недельного шаблона: день, неделя (верхняя, нижняя, обе), номер пары по сетке приказа № 290. */
export interface LessonSlot {
  weekday: Weekday
  weeks: WeekPart
  pair: number
  discipline: string
  kind: LessonKind
  room: string
  teacher: string
}

interface ChangeBase {
  key: string
  /** Какую пару меняет: дисциплина и вид. */
  discipline: string
  lessonKind: LessonKind
  /** Сдвиг от Д при Д-понедельнике. Пара ищется в окне Д…Д+6 не раньше этого дня; при другом Д — первая в окне. */
  dayOffset: number
  /** Изменение должно быть видно на экране «Сегодня» (дни Д и Д+1): ставится на ближайшую пару этих дней. */
  anchorToday?: boolean
}

export type ChangeSpec = ChangeBase &
  (
    | { kind: 'room_changed'; newRoom: string }
    | { kind: 'cancelled'; note: string }
    | { kind: 'teacher_changed'; note: string }
    /**
     * Перенос: на другую пару того же дня (без `toWeekday`) или на ближайший следующий `toWeekday`. Заметку плана собирает по
     * сетке пар: вид изменения («Пара перенесена») экран печатает сам, заметка несёт только новое (R-2.4-1).
     */
    | { kind: 'moved'; toPair: number; toWeekday?: Weekday; toRoom?: string }
  )

export interface AssignmentSpec {
  key: string
  title: string
  /** Срок сдвигом от Д; выпавший на субботу или воскресенье переносится на понедельник. */
  dayOffset: number
  maxPoints: number
}

export interface DisciplineSpec {
  name: string
  controlKind: 'exam' | 'credit'
  semester: number
  /**
   * День, время и аудитория экзамена, зачёта или пересдачи; сдвиг от Д. У сданного в прошлую сессию — нет.
   * Выпавший на воскресенье контроль переносится на понедельник; если у группы в этот день уже есть контроль — на следующий
   * будний день без контроля. Суббота остаётся: по субботам есть пары. Даты для текстов — в `PlanVars`: `{exam.<название>}`.
   */
  exam?: { dayOffset: number; time: string; room: string }
  assignments: AssignmentSpec[]
}

export interface GroupSpec {
  name: string
  faculty: string
  /** Недельный шаблон пар. */
  week: LessonSlot[]
  changes: ChangeSpec[]
  disciplines: DisciplineSpec[]
}

export interface GradeSpec {
  discipline: string
  points: number | null
  outcome: '5' | '4' | '3' | '2' | 'credit' | 'no_credit' | 'pending'
  admitted?: boolean
}

export interface RequestStepSpec {
  status: RequestStatus
  /** День шага: сдвиг от Д (≤ 0). */
  dayOffset: number
  /** Заметка шага (`request_events.note`). */
  note?: string
}

export interface RequestSpec {
  key: string
  kind: RequestKind
  /** Только у справки из деканата. */
  purpose?: DeanPurpose
  /** Только у справки об оплате. */
  paymentYear?: number
  note: string | null
  steps: RequestStepSpec[]
  /** Только у отклонённой. */
  rejectReason?: RejectReason
}

/** В заголовке и тексте можно писать `{d+N}` (день Д+N как дд.мм.гггг) и значения из `PlanVars`: `{wd.ключ}` и другие. */
export interface NotificationSpec {
  key: string
  kind: 'reminder' | 'news'
  title: string
  body: string
  link: string | null
  unread: boolean
}

export interface StudentSpec {
  login: string
  password: string
  fullName: string
  faculty: string
  programme: string
  course: number
  groupName: string
  grades: GradeSpec[]
  requests: RequestSpec[]
  notifications: NotificationSpec[]
  /** Что тест ищет в чужих ответах: у каждого студента своя метка в профиле, расписании, оценках, заявках и уведомлениях. */
  markers: { profile: string; schedule: string; grades: string; requests: string; notifications: string }
}

export interface AnnouncementSpec {
  key: string
  /** Адресат — группа или факультеты; «обоим факультетам» — две строки в базе. */
  groupName?: string
  faculties?: string[]
  title: string
  body: string
  /** День публикации: сдвиг от Д (≤ 0). */
  dayOffset: number
}

export interface CohortSpec {
  cohort: string
  /** «Пароль опубликован»: да у основного набора, нет у резервного, пока его не выдали жюри (ADR-0003). */
  passwordPublished: boolean
  staff: { login: string; password: string }
  groups: GroupSpec[]
  students: StudentSpec[]
  announcements: AnnouncementSpec[]
}

/** Стабильный UUID из набора слов: повторный запуск обновляет те же строки. */
export function detId(...parts: string[]): string {
  const h = createHash('sha1').update(parts.join('\u0000')).digest()
  h[6] = (h[6]! & 0x0f) | 0x50
  h[8] = (h[8]! & 0x3f) | 0x80
  const hex = h.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// ---------- Сетка и даты ----------

/** Сетка пар приказа № 290 (R-1.6, ЯД-2): номер пары → начало и конец. */
export const PAIR_TIMES: Readonly<Record<number, readonly [string, string]>> = {
  1: ['08:30', '10:00'],
  2: ['10:15', '11:45'],
  3: ['12:00', '13:30'],
  4: ['14:00', '15:30'],
  5: ['15:45', '17:15'],
  6: ['17:20', '18:50'],
  7: ['18:55', '20:25'],
  8: ['20:30', '22:00'],
}

/** Пары создаются на даты от Д-7 до Д+27: у экранов есть прошлая неделя и запас вперёд. */
export const LESSONS_BACK_DAYS = 7
export const LESSONS_AHEAD_DAYS = 27

/** Окно, которое читает экран «Сегодня» (`listMyLessons(Д, Д+6)`); изменения он показывает только на дни Д и Д+1. */
export const TODAY_SCREEN_WINDOW_DAYS = 6

const WEEKDAY_NAMES = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

export function weekdayName(iso: string): string {
  return WEEKDAY_NAMES[weekdayOf(iso)] ?? ''
}

const WEEKDAY_ACCUSATIVE = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу']

/** «на субботу», «на среду»: день недели в винительном падеже. */
export function weekdayAccusative(iso: string): string {
  return WEEKDAY_ACCUSATIVE[weekdayOf(iso)] ?? ''
}

function mondayOf(iso: string): string {
  const dow = weekdayOf(iso)
  return addDays(iso, dow === 0 ? -6 : 1 - dow)
}

/** Верхняя или нижняя неделя. До начала семестра чередование продолжается назад: `weekInfo` там пуст. */
export function weekKindOf(iso: string): 'upper' | 'lower' {
  const info = weekInfo(iso)
  if (info) return info.kind === 'верхняя' ? 'upper' : 'lower'
  const days = (Date.parse(`${mondayOf(iso)}T00:00:00Z`) - Date.parse(`${mondayOf(SEMESTER_START)}T00:00:00Z`)) / 86_400_000
  return Math.abs(Math.floor(days / 7)) % 2 === 0 ? 'upper' : 'lower'
}

/** Срок работы, выпавший на субботу или воскресенье, — на ближайший понедельник. */
export function toWorkday(iso: string): string {
  const dow = weekdayOf(iso)
  return dow === 6 ? addDays(iso, 2) : dow === 0 ? addDays(iso, 1) : iso
}

function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n)
  if (abs % 100 >= 11 && abs % 100 <= 14) return many
  if (abs % 10 === 1) return one
  if (abs % 10 >= 2 && abs % 10 <= 4) return few
  return many
}

/** «2 дня», «1 день», «5 дней» — для заголовков напоминаний. */
export function daysPhrase(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

// ---------- Расчёт ----------

export interface PlannedChange {
  id: string
  key: string
  kind: 'cancelled' | 'moved' | 'room_changed' | 'teacher_changed'
  note: string
  newDate: string | null
  newStartsAt: string | null
  newEndsAt: string | null
  newRoom: string | null
}

export interface PlannedLesson {
  id: string
  groupName: string
  date: string
  pair: number
  startsAt: string
  endsAt: string
  discipline: string
  kind: LessonKind
  room: string
  teacher: string
  change: PlannedChange | null
}

export interface PlannedAssignment {
  id: string
  key: string
  title: string
  dueDate: string
  maxPoints: number
}

export interface PlannedDiscipline {
  id: string
  groupName: string
  name: string
  controlKind: 'exam' | 'credit'
  semester: number
  examDate: string | null
  examTime: string | null
  examRoom: string | null
  assignments: PlannedAssignment[]
}

export interface PlannedStep {
  id: string
  status: RequestStatus
  date: string
  /** Время дня «ЧЧ:ММ» по часовому поясу вуза; на день Д — минуты после полуночи, чтобы запись не стояла в будущем. */
  time: string
  note: string | null
  /** Шаг «Подана» делает студент, остальные — сотрудник. */
  byStudent: boolean
}

export interface PlannedRequest {
  id: string
  key: string
  kind: RequestKind
  status: RequestStatus
  purpose: DeanPurpose | null
  paymentYear: number | null
  note: string | null
  dueDate: string | null
  pickupUntil: string | null
  issuedOn: string | null
  rejectReason: RejectReason | null
  steps: PlannedStep[]
}

export interface PlannedNotification {
  id: string
  key: string
  kind: 'reminder' | 'news'
  title: string
  body: string
  link: string | null
  unread: boolean
  date: string
  time: string
}

export interface PlannedGrade {
  id: string
  disciplineId: string
  discipline: string
  points: number | null
  outcome: GradeSpec['outcome']
  admitted: boolean
}

export interface PlannedStudent {
  userId: string
  spec: StudentSpec
  groupId: string
  grades: PlannedGrade[]
  requests: PlannedRequest[]
  notifications: PlannedNotification[]
}

export interface PlannedAnnouncement {
  id: string
  key: string
  groupId: string | null
  faculty: string | null
  title: string
  body: string
  date: string
  time: string
}

export interface CohortPlan {
  today: string
  cohort: string
  staffId: string
  groups: { id: string; name: string; faculty: string }[]
  lessons: PlannedLesson[]
  disciplines: PlannedDiscipline[]
  students: PlannedStudent[]
  announcements: PlannedAnnouncement[]
  /** Значения для подстановок `{имя}` в текстах уведомлений: разбирает тест. */
  vars: ReadonlyMap<string, string>
}

function pairTimes(pair: number): readonly [string, string] {
  const times = PAIR_TIMES[pair]
  if (!times) throw new Error(`Пары ${pair} нет в сетке (1–8)`)
  return times
}

/** Подстановки `{d+N}` и `{имя}` из `vars`. Неизвестное имя — ошибка набора, а не пустое место на экране. */
export function renderText(text: string, today: string, vars: ReadonlyMap<string, string>): string {
  return text.replace(/\{([^{}]+)\}/g, (_match, token: string) => {
    const shift = /^d([+-]\d+)$/.exec(token)
    if (shift) return formatDate(addDays(today, Number(shift[1])))
    const value = vars.get(token)
    if (value === undefined) throw new Error(`В тексте «${text}» нет значения для {${token}}`)
    return value
  })
}

function planLessons(group: GroupSpec, cohort: string, today: string, vars: Map<string, string>): PlannedLesson[] {
  const lessons: PlannedLesson[] = []
  const slots = [...group.week].sort((a, b) => a.pair - b.pair)
  for (let day = -LESSONS_BACK_DAYS; day <= LESSONS_AHEAD_DAYS; day += 1) {
    const date = addDays(today, day)
    const weekday = weekdayOf(date)
    if (weekday === 0) continue
    const part = weekKindOf(date)
    for (const slot of slots) {
      if (slot.weekday !== weekday || (slot.weeks !== 'both' && slot.weeks !== part)) continue
      const [startsAt, endsAt] = pairTimes(slot.pair)
      lessons.push({
        id: detId('lesson', cohort, group.name, date, String(slot.pair)),
        groupName: group.name,
        date,
        pair: slot.pair,
        startsAt,
        endsAt,
        discipline: slot.discipline,
        kind: slot.kind,
        room: slot.room,
        teacher: slot.teacher,
        change: null,
      })
    }
  }
  const seen = new Set<string>()
  for (const l of lessons) {
    const slotKey = `${l.date}/${l.pair}`
    if (seen.has(slotKey)) throw new Error(`Группа ${group.name}: две пары на ${l.date}, пара ${l.pair}`)
    seen.add(slotKey)
  }

  // Изменения. Правило привязки — черновик, раздел «Если Д — не понедельник».
  const windowEnd = addDays(today, TODAY_SCREEN_WINDOW_DAYS)
  const inWindow = lessons.filter((l) => l.date >= today && l.date <= windowEnd)
  const taken = new Set<string>()
  const holder = new Map<string, ChangeSpec>()
  const pick = (change: ChangeSpec, exclude?: string): PlannedLesson | undefined => {
    const free = inWindow.filter((l) => !taken.has(l.id) && l.id !== exclude && l.discipline === change.discipline)
    const sameKind = free.filter((l) => l.kind === change.lessonKind)
    const candidates = sameKind.length > 0 ? sameKind : free
    const target = addDays(today, change.dayOffset)
    return candidates.find((l) => l.date >= target) ?? candidates[0]
  }
  const apply = (change: ChangeSpec, lesson: PlannedLesson): void => {
    taken.add(lesson.id)
    holder.set(lesson.id, change)
    const base = { id: detId('lesson-change', lesson.id), key: change.key, newDate: null, newStartsAt: null, newEndsAt: null, newRoom: null }
    let planned: PlannedChange
    if (change.kind === 'room_changed') {
      planned = { ...base, kind: 'room_changed', note: `${lesson.room} → ${change.newRoom}`, newRoom: change.newRoom }
    } else if (change.kind === 'moved') {
      const [newStartsAt, newEndsAt] = pairTimes(change.toPair)
      let newDate: string | null = null
      if (change.toWeekday !== undefined) {
        newDate = addDays(lesson.date, 1)
        while (weekdayOf(newDate) !== change.toWeekday) newDate = addDays(newDate, 1)
      }
      const place = change.toRoom ? `ауд. ${change.toRoom}` : 'та же аудитория'
      const note =
        newDate === null
          ? `на ${change.toPair} пару, ${newStartsAt}–${newEndsAt}, ${place}`
          : `на ${weekdayAccusative(newDate)} ${formatDate(newDate).slice(0, 5)}, ${change.toPair} пара, ${newStartsAt}–${newEndsAt}, ${place}`
      planned = { ...base, kind: 'moved', note, newDate, newStartsAt, newEndsAt, newRoom: change.toRoom ?? null }
    } else {
      planned = { ...base, kind: change.kind, note: change.note }
    }
    lesson.change = planned
    vars.set(`wd.${change.key}`, weekdayName(lesson.date))
    vars.set(`note.${change.key}`, planned.note)
  }
  // Сначала изменения без привязки к экрану «Сегодня», потом привязанные: им выбирается из оставшихся пар.
  for (const change of group.changes.filter((c) => !c.anchorToday)) {
    const lesson = pick(change)
    if (!lesson) throw new Error(`Группа ${group.name}: для изменения ${change.key} нет пары «${change.discipline}» в окне Д…Д+6`)
    apply(change, lesson)
  }
  for (const change of group.changes.filter((c) => c.anchorToday)) {
    const wanted = pick(change)
    if (!wanted) throw new Error(`Группа ${group.name}: для изменения ${change.key} нет пары «${change.discipline}» в окне Д…Д+6`)
    const visibleDays = new Set([today, addDays(today, 1)])
    // Пара по черновику попадает на экран — берём её. Нет — ближайшая пара дней Д и Д+1: свободная, а если свободной нет —
    // та, чьё изменение можно поставить на другую пару (оно остаётся в окне, но уходит с экрана «Сегодня»). Пар в эти дни
    // нет вовсе (суббота нижней недели) — остаётся пара по черновику: экран показать её не может.
    let lesson = wanted
    if (!visibleDays.has(wanted.date)) {
      for (const candidate of inWindow.filter((l) => visibleDays.has(l.date))) {
        const other = holder.get(candidate.id)
        if (!other) {
          lesson = candidate
          break
        }
        const alternative = pick(other, candidate.id)
        if (!alternative) continue
        candidate.change = null
        taken.delete(candidate.id)
        holder.delete(candidate.id)
        apply(other, alternative)
        lesson = candidate
        break
      }
    }
    apply(change, lesson)
  }
  return lessons
}

/**
 * Даты контроля группы. Выпавшее на воскресенье — на понедельник; занятый другим контролем группы день — на следующий будний
 * день без контроля. Суббота остаётся. Идёт по возрастанию сдвига, и ни один контроль не встаёт раньше предыдущего:
 * порядок контроля не меняется, пересдача остаётся раньше сессии.
 */
export function planControlDates(disciplines: DisciplineSpec[], today: string): Map<string, string> {
  const dates = new Map<string, string>()
  const used = new Set<string>()
  let last = ''
  const withExam = disciplines.filter((d) => d.exam).sort((a, b) => a.exam!.dayOffset - b.exam!.dayOffset)
  for (const d of withExam) {
    const base = addDays(today, d.exam!.dayOffset)
    let date = base < last ? last : base
    if (weekdayOf(date) === 0 || used.has(date)) {
      do {
        date = addDays(date, 1)
      } while (weekdayOf(date) === 0 || weekdayOf(date) === 6 || used.has(date))
    }
    used.add(date)
    last = date
    dates.set(d.name, date)
  }
  return dates
}

function planDisciplines(group: GroupSpec, cohort: string, today: string, vars: Map<string, string>): PlannedDiscipline[] {
  const controlDates = planControlDates(group.disciplines, today)
  return group.disciplines.map((d) => {
    const id = detId('discipline', cohort, group.name, d.name)
    const examDate = controlDates.get(d.name) ?? null
    if (examDate) {
      vars.set(`exam.${d.name}`, formatDate(examDate))
      // Накануне: день перед контролем, а если он воскресенье (контроль в понедельник) — суббота. «Экзамен — {after}».
      const eve = addDays(examDate, weekdayOf(examDate) === 1 ? -2 : -1)
      vars.set(`eve.${d.name}`, formatDate(eve))
      vars.set(`after-eve.${d.name}`, eve === addDays(examDate, -1) ? 'на следующий день' : 'в понедельник')
    }
    return {
      id,
      groupName: group.name,
      name: d.name,
      controlKind: d.controlKind,
      semester: d.semester,
      examDate,
      examTime: d.exam?.time ?? null,
      examRoom: d.exam?.room ?? null,
      assignments: d.assignments.map((a) => {
        const dueDate = toWorkday(addDays(today, a.dayOffset))
        vars.set(`left.${a.key}`, daysPhrase(daysBetween(today, dueDate)))
        return { id: detId('assignment', id, a.key), key: a.key, title: a.title, dueDate, maxPoints: a.maxPoints }
      }),
    }
  })
}

function stepTime(date: string, today: string, index: number): string {
  return date === today ? `00:${String(10 + index * 5).padStart(2, '0')}` : `09:${String(index * 10).padStart(2, '0')}`
}

function planRequest(spec: RequestSpec, userId: string, today: string, vars: Map<string, string>): PlannedRequest {
  const id = detId('request', userId, spec.key)
  if (spec.kind === 'dean_certificate' ? !spec.purpose || spec.paymentYear !== undefined : spec.purpose !== undefined) {
    throw new Error(`Заявка ${spec.key}: назначение — только у справки из деканата`)
  }
  if (spec.kind === 'tuition_certificate' ? spec.paymentYear === undefined : spec.paymentYear !== undefined) {
    throw new Error(`Заявка ${spec.key}: год оплаты — только у справки об оплате обучения`)
  }
  if (spec.steps.length === 0 || spec.steps[0]!.status !== 'submitted') throw new Error(`Заявка ${spec.key}: путь начинается с «Подана»`)
  let previous: RequestStatus | null = null
  let previousDay = -Infinity
  const steps: PlannedStep[] = spec.steps.map((s, index) => {
    if (previous !== null && !isAllowedTransition(previous, s.status)) {
      throw new Error(`Заявка ${spec.key}: переход ${previous} → ${s.status} недопустим`)
    }
    if (s.dayOffset < previousDay || s.dayOffset > 0) throw new Error(`Заявка ${spec.key}: дни шагов не убывают к прошлому и не позже Д`)
    previous = s.status
    previousDay = s.dayOffset
    const date = addDays(today, s.dayOffset)
    return {
      id: detId('request-event', id, s.status),
      status: s.status,
      date,
      time: stepTime(date, today, index),
      note: s.note ?? null,
      byStudent: s.status === 'submitted',
    }
  })
  const dayOf = (status: RequestStatus) => steps.find((s) => s.status === status)?.date ?? null
  const taken = dayOf('in_progress')
  const ready = dayOf('ready')
  const issued = dayOf('issued')
  const last = steps[steps.length - 1]!
  if ((last.status === 'rejected') !== (spec.rejectReason !== undefined)) {
    throw new Error(`Заявка ${spec.key}: причина отказа — только у отклонённой`)
  }
  const planned: PlannedRequest = {
    id,
    key: spec.key,
    kind: spec.kind,
    status: last.status,
    purpose: spec.purpose ?? null,
    paymentYear: spec.paymentYear ?? null,
    note: spec.note,
    // Сроки считают функции кода от дня шага, как при смене статуса сотрудником.
    dueDate: taken ? computeDueDate(spec.kind, taken) : null,
    pickupUntil: ready ? computePickupUntil(spec.kind, ready) : null,
    issuedOn: issued,
    rejectReason: spec.rejectReason ?? null,
    steps,
  }
  vars.set(`id.${spec.key}`, id)
  if (planned.pickupUntil) vars.set(`pickup.${spec.key}`, formatDate(planned.pickupUntil))
  if (planned.dueDate) {
    vars.set(`due.${spec.key}`, formatDate(planned.dueDate))
    vars.set(`left.${spec.key}`, daysPhrase(daysBetween(today, planned.dueDate)))
  }
  return planned
}

/** Строки набора на день Д. Одинаковый вход даёт одинаковые строки: повторное заполнение в тот же день ничего не меняет. */
export function buildCohortPlan(spec: CohortSpec, today: string): CohortPlan {
  const vars = new Map<string, string>()
  const groups = spec.groups.map((g) => ({ id: detId('group', spec.cohort, g.name), name: g.name, faculty: g.faculty }))
  const groupId = new Map(groups.map((g) => [g.name, g.id]))
  const lessons = spec.groups.flatMap((g) => planLessons(g, spec.cohort, today, vars))
  const disciplines = spec.groups.flatMap((g) => planDisciplines(g, spec.cohort, today, vars))

  const students = spec.students.map((s): PlannedStudent => {
    const userId = detId('user', s.login)
    const gId = groupId.get(s.groupName)
    if (!gId) throw new Error(`Нет группы ${s.groupName} в наборе ${spec.cohort}`)
    const grades = s.grades.map((g): PlannedGrade => {
      const discipline = disciplines.find((d) => d.groupName === s.groupName && d.name === g.discipline)
      if (!discipline) throw new Error(`У студента ${s.login} оценка по дисциплине «${g.discipline}», которой нет в группе ${s.groupName}`)
      return {
        id: detId('grade', userId, discipline.id),
        disciplineId: discipline.id,
        discipline: g.discipline,
        points: g.points,
        outcome: g.outcome,
        admitted: g.admitted ?? true,
      }
    })
    const requests = s.requests.map((r) => planRequest(r, userId, today, vars))
    return { userId, spec: s, groupId: gId, grades, requests, notifications: [] }
  })

  // Тексты — после того как посчитаны все значения подстановок.
  const announcements: PlannedAnnouncement[] = spec.announcements.flatMap((a, index) => {
    const date = addDays(today, a.dayOffset)
    const time = `${date === today ? '00' : '09'}:${String(10 + index).padStart(2, '0')}`
    const text = { title: renderText(a.title, today, vars), body: renderText(a.body, today, vars) }
    const targets: { groupId: string | null; faculty: string | null; suffix: string }[] = []
    if (a.groupName) {
      const gId = groupId.get(a.groupName)
      if (!gId) throw new Error(`Объявление ${a.key}: нет группы ${a.groupName}`)
      targets.push({ groupId: gId, faculty: null, suffix: a.groupName })
    }
    for (const faculty of a.faculties ?? []) targets.push({ groupId: null, faculty, suffix: faculty })
    if (targets.length === 0) throw new Error(`Объявление ${a.key}: нет адресата`)
    return targets.map((t) => ({ id: detId('announcement', spec.cohort, a.key, t.suffix), key: a.key, ...t, ...text, date, time }))
  })
  for (const student of students) {
    student.notifications = student.spec.notifications.map((n, index): PlannedNotification => ({
      id: detId('notification', student.userId, n.key),
      key: n.key,
      kind: n.kind,
      title: renderText(n.title, today, vars),
      body: renderText(n.body, today, vars),
      link: n.link === null ? null : renderText(n.link, today, vars),
      unread: n.unread,
      date: today,
      time: `00:${String(59 - index).padStart(2, '0')}`,
    }))
  }
  return { today, cohort: spec.cohort, staffId: detId('user', spec.staff.login), groups, lessons, disciplines, students, announcements, vars }
}
