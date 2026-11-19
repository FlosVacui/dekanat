// Раскладка экрана «Сегодня» (Э-2, пакет 3.6). Чистая функция: без базы и без часов, «сегодня» и «сейчас» приходят аргументами.
// Пары раскладывает `buildSchedule`, поэтому пара, перенесённая на сегодня с прошедшего дня, видна и считается
// (строка IMP-028 в ISSUES: прежний экран просил пары по дате старого места и такую пару не видел).
//
// Правила:
// - пары сегодня — записи дня «сегодня» без отменённых и без старого места перенесённой пары (как `lessonCount` в расписании);
// - следующая пара — первая по порядку записей с сегодняшнего дня: сегодняшняя, если ещё не кончилась, иначе ближайшая другого дня.
//   Отменённая пара и старое место перенесённой пары следующими не бывают;
// - изменения — записи с изменением на сегодня и завтра;
// - сроки «что сдать» — разница в днях от сегодня и плашка;
// - «Ждёт вас» (`buildWaiting`) — строки по важности: долг, нет допуска, готовая справка, ответ деканата. Пусто — пустой список.

import { addDays, formatDayMonth, weekdayShort } from './dates'
import {
  describeDiscipline,
  pointsWord,
  sortForSemester,
  STIPEND_DEBT_LINE,
  type FirstActionInput,
} from './grades'
import { topicLabel } from './questions'
import { isRequestKind, isRequestStatus, REQUEST_KIND_INFO, statusText } from './requests'
import { buildSchedule, type ScheduleDay, type ScheduleEntry, type ScheduleLesson } from './schedule'

const WEEKDAYS_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']

/** Работа со сроком: поля слоя доступа (`DueAssignment`), нужные экрану. */
export interface TodayDueInput {
  id: string
  disciplineId: string
  discipline: string
  title: string
  dueDate: string
}

/** Когда начнётся следующая пара: сейчас идёт, позже сегодня, в другой день. */
export type NextKind = 'now' | 'today' | 'other_day'

export interface NextLesson {
  kind: NextKind
  /** День пары, «ГГГГ-ММ-ДД». */
  date: string
  entry: ScheduleEntry
  /** Подпись в шапке блока: «Идёт сейчас» или «Следующая пара». */
  caption: string
  /** Заголовок даты под подписью: «Сегодня», «Завтра, ср 18 ноября», «Пт 20 ноября». */
  dateTitle: string
  /** Подпись кнопки: «Расписание на сегодня» или «Расписание на 16 ноября». */
  buttonLabel: string
  /** Адрес кнопки: `/schedule` для сегодня, `/schedule?day=ГГГГ-ММ-ДД` для другого дня. */
  href: string
}

export interface TodayChange {
  /** «Сегодня» или «Завтра». */
  dayWord: 'Сегодня' | 'Завтра'
  date: string
  entry: ScheduleEntry
}

export type DueTone = 'warn' | 'info'

export interface DueRow {
  id: string
  disciplineId: string
  title: string
  discipline: string
  dueDate: string
  /** Дней от сегодня до срока: 0 — сегодня. */
  daysLeft: number
  /** «Сегодня», «Завтра», «Через 2 дня», «Через 5 дней». */
  chip: string
  /** Сегодня и завтра — «внимание», дальше — нейтральная плашка. */
  tone: DueTone
}

export interface TodayView {
  /** Число пар сегодня: без отменённых и без старых мест перенесённых. */
  todayCount: number
  /** Пары сегодня были, но все кончились: над блоком следующей пары стоит плашка «На сегодня всё: пары закончились». */
  todayFinished: boolean
  next: NextLesson | null
  changes: TodayChange[]
  due: DueRow[]
  /** Подзаголовок: «Воскресенье, 15 ноября · пар нет». */
  subtitle: string
}

/** Числа четырёх плиток на «Сегодня» (только на компьютере). Ноль остаётся нулём. */
export interface TodayTiles {
  lessons: number
  due: number
  requests: number
  unread: number
}

/** Заявка в работе — «Подана» или «В работе». Готовая, выданная и отклонённая в плитку не входят. */
const IN_WORK_STATUSES: readonly string[] = ['submitted', 'in_progress']

/** Сколько заявок студента в статусах «Подана» и «В работе». */
export function countRequestsInWork(requests: readonly { status: string }[]): number {
  return requests.filter((r) => IN_WORK_STATUSES.includes(r.status)).length
}

/** Числа плиток: пары сегодня и «сдать на этой неделе» — из раскладки экрана, заявки — своим счётом, уведомления — число колокольчика. */
export function buildTiles(view: Pick<TodayView, 'todayCount' | 'due'>, requests: readonly { status: string }[], unread: number): TodayTiles {
  return { lessons: view.todayCount, due: view.due.length, requests: countRequestsInWork(requests), unread }
}

/** Дней между двумя датами «ГГГГ-ММ-ДД»: `to − from`. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** «пар нет», «1 пара», «3 пары», «5 пар», «11 пар». */
export function lessonCountText(n: number): string {
  if (n === 0) return 'пар нет'
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return `${n} пар`
  if (mod10 === 1) return `${n} пара`
  if (mod10 >= 2 && mod10 <= 4) return `${n} пары`
  return `${n} пар`
}

/** Заголовок экрана: «Четверг, 19 ноября». */
export function dateHeading(today: string): string {
  const weekday = WEEKDAYS_FULL[new Date(`${today}T00:00:00Z`).getUTCDay()] ?? ''
  return `${weekday}, ${formatDayMonth(today)}`
}

/** Подзаголовок: день недели с большой буквы, дата, число пар. */
export function subtitleText(today: string, lessonCount: number): string {
  const weekday = WEEKDAYS_FULL[new Date(`${today}T00:00:00Z`).getUTCDay()] ?? ''
  return `${weekday}, ${formatDayMonth(today)} · ${lessonCountText(lessonCount)}`
}

/** Плашка срока: «Сегодня», «Завтра», «Через N дня/дней». */
export function dueChipText(daysLeft: number): string {
  if (daysLeft <= 0) return 'Сегодня'
  if (daysLeft === 1) return 'Завтра'
  const mod100 = daysLeft % 100
  const mod10 = daysLeft % 10
  const word = mod100 >= 11 && mod100 <= 14 ? 'дней' : mod10 === 1 ? 'день' : mod10 >= 2 && mod10 <= 4 ? 'дня' : 'дней'
  return `Через ${daysLeft} ${word}`
}

/** Пара может быть «следующей»: не отменена и это не старое место перенесённой пары. */
function isUpcomingCandidate(entry: ScheduleEntry): boolean {
  return !entry.cancelled && entry.placement !== 'moved_from'
}

/**
 * Заголовок даты в блоке «следующая пара»: «Сегодня» для сегодняшнего дня, «Завтра, ср 18 ноября» для завтрашнего,
 * для остальных — день недели с большой буквы и дата без запятой: «Пт 20 ноября».
 */
export function nextDateTitle(date: string, today: string): string {
  if (date === today) return 'Сегодня'
  if (date === addDays(today, 1)) return `Завтра, ${weekdayShort(date)} ${formatDayMonth(date)}`
  const weekday = weekdayShort(date)
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${formatDayMonth(date)}`
}

function pickNext(days: readonly ScheduleDay[], today: string, now: string): NextLesson | null {
  for (const day of days) {
    for (const entry of day.entries) {
      if (!isUpcomingCandidate(entry)) continue
      if (day.date === today) {
        if (entry.endsAt <= now) continue
        const started = entry.startsAt <= now
        return {
          kind: started ? 'now' : 'today',
          date: day.date,
          entry,
          caption: started ? 'Идёт сейчас' : 'Следующая пара',
          dateTitle: nextDateTitle(day.date, today),
          buttonLabel: 'Расписание на сегодня',
          href: '/schedule',
        }
      }
      return {
        kind: 'other_day',
        date: day.date,
        entry,
        caption: 'Следующая пара',
        dateTitle: nextDateTitle(day.date, today),
        buttonLabel: `Расписание на ${formatDayMonth(day.date)}`,
        href: `/schedule?day=${day.date}`,
      }
    }
  }
  return null
}

/**
 * Всё, что рисует экран «Сегодня», кроме заявок и объявлений (они приходят из слоя доступа готовыми).
 * `lessons` — пары за промежуток `scheduleRange(today)`; `now` — «ЧЧ:ММ» в часовом поясе вуза.
 */
export function buildToday(
  lessons: readonly ScheduleLesson[],
  due: readonly TodayDueInput[],
  today: string,
  now: string,
): TodayView {
  const days = buildSchedule(lessons, today)
  const todayDay = days.find((d) => d.date === today)
  const todayCount = todayDay?.lessonCount ?? 0
  const next = pickNext(days, today, now)
  const todayFinished = todayCount > 0 && next?.date !== today

  const tomorrow = addDays(today, 1)
  const changes: TodayChange[] = []
  for (const day of days) {
    if (day.date !== today && day.date !== tomorrow) continue
    for (const entry of day.entries) {
      if (entry.changeKind !== null) changes.push({ dayWord: day.date === today ? 'Сегодня' : 'Завтра', date: day.date, entry })
    }
  }

  const dueRows: DueRow[] = due
    .map((w) => {
      const daysLeft = daysBetween(today, w.dueDate)
      return {
        id: w.id,
        disciplineId: w.disciplineId,
        title: w.title,
        discipline: w.discipline,
        dueDate: w.dueDate,
        daysLeft,
        chip: dueChipText(daysLeft),
        tone: (daysLeft <= 1 ? 'warn' : 'info') as DueTone,
      }
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, 'ru'))

  return { todayCount, todayFinished, next, changes, due: dueRows, subtitle: subtitleText(today, todayCount) }
}

// ---------- «Ждёт вас» ----------

/** Дисциплина для блока «Ждёт вас»: поля `GradeItem` слоя доступа, нужные сборке. */
export interface WaitingGradeInput extends FirstActionInput {
  nextDue: { title: string; dueDate: string } | null
}

/** Заявка для блока «Ждёт вас»: поля `RequestItem` слоя доступа. */
export interface WaitingRequestInput {
  id: string
  kind: string
  status: string
  dueDate: string | null
  pickupUntil: string | null
  issuedOn: string | null
  rejectReason: string | null
}

/** Вопрос для блока «Ждёт вас»: поля `QuestionItem`; список приходит новыми сверху. */
export interface WaitingQuestionInput {
  id: string
  topic: string
  status: string
  /** День ответа деканата (ГГГГ-ММ-ДД в часовом поясе приложения); `null` — не известен. Старше 7 дней ответ в «Ждёт вас» не стоит. */
  answeredOn?: string | null
}

/** Сколько дней ответ деканата висит в «Ждёт вас»: признака «прочитан» в базе нет, строка не должна оставаться навсегда. */
export const ANSWER_WAITING_DAYS = 7

export type WaitingKind = 'debt' | 'no_admission' | 'ready' | 'answer'

/** Цвет метки: красная — долг, жёлтая — нет допуска, зелёная — готово и ответ. Совпадает с тонами `Chip`. */
export type WaitingTone = 'err' | 'warn' | 'ok'

export interface WaitingRow {
  key: string
  kind: WaitingKind
  tone: WaitingTone
  /** Слово метки: «Долг», «Нет допуска», «Готово», «Ответ». */
  label: string
  /** Дисциплина или название заявки. */
  title: string
  /** Главная пояснительная строка; `null` — пояснения нет. */
  detail: string | null
  /** Вторая мелкая строка: стипендия у первого долга, ближайшая работа у дисциплины без допуска. */
  note: string | null
  /** Единственная ссылка строки. */
  href: string
  /** Глагол ссылки: «Подготовиться к пересдаче», «Открыть работы», «Забрать справку», «Прочитать ответ». */
  action: string
}

export const WAITING_EMPTY_TEXT = 'Всё в порядке: долгов и ответов от вас не ждут'

function retakeText(examDate: string | null, today: string): string {
  if (!examDate) return 'Дата пересдачи не назначена'
  if (examDate < today) return `Пересдача была ${formatDayMonth(examDate)}, новая дата не назначена`
  return `Пересдача ${formatDayMonth(examDate)}`
}

/**
 * Что ждёт студента, по важности: долги (по дате пересдачи), дисциплины без допуска, готовые заявки, ответ деканата на вопрос.
 * Из ответов берётся один, самый новый и не старше 7 дней: признака «прочитан» в базе нет. Чистая функция: данные и «сегодня» приходят аргументами,
 * владельца выбрал слой доступа (всё это — записи самого студента из сессии).
 */
export function buildWaiting(input: {
  grades: readonly WaitingGradeInput[]
  requests: readonly WaitingRequestInput[]
  questions: readonly WaitingQuestionInput[]
  today: string
}): WaitingRow[] {
  const { today } = input
  const rows: WaitingRow[] = []
  const ordered = sortForSemester([...input.grades])

  let firstDebt = true
  for (const g of ordered) {
    if (describeDiscipline(g).kind !== 'debt') continue
    rows.push({
      key: `debt-${g.disciplineId}`,
      kind: 'debt',
      tone: 'err',
      label: 'Долг',
      title: g.name,
      detail: retakeText(g.examDate, today),
      note: firstDebt ? STIPEND_DEBT_LINE : null,
      href: `/grades/${g.disciplineId}`,
      action: 'Подготовиться к пересдаче',
    })
    firstDebt = false
  }

  for (const g of ordered) {
    const state = describeDiscipline(g)
    if (state.kind !== 'ahead_no_admission') continue
    rows.push({
      key: `adm-${g.disciplineId}`,
      kind: 'no_admission',
      tone: 'warn',
      label: 'Нет допуска',
      title: g.name,
      detail: state.missing !== null ? `До допуска не хватает ${state.missing} ${pointsWord(state.missing)}` : 'Допуска пока нет',
      note: g.nextDue ? `Ближайшая работа: ${g.nextDue.title}, до ${formatDayMonth(g.nextDue.dueDate)}` : null,
      href: '/grades',
      action: 'Открыть работы',
    })
  }

  for (const r of input.requests) {
    if (r.status !== 'ready' || !isRequestKind(r.kind) || !isRequestStatus(r.status)) continue
    rows.push({
      key: `req-${r.id}`,
      kind: 'ready',
      tone: 'ok',
      label: 'Готово',
      title: REQUEST_KIND_INFO[r.kind].title,
      detail: statusText({
        kind: r.kind,
        status: r.status,
        dueDate: r.dueDate,
        pickupUntil: r.pickupUntil,
        issuedOn: r.issuedOn,
        rejectReason: r.rejectReason,
      }),
      note: null,
      href: `/requests/${r.id}`,
      action: r.kind === 'financial_aid' ? 'Открыть заявку' : 'Забрать справку',
    })
  }

  const oldest = addDays(input.today, -ANSWER_WAITING_DAYS)
  const answered = input.questions.find((q) => q.status === 'answered' && (!q.answeredOn || q.answeredOn >= oldest))
  if (answered) {
    rows.push({
      key: `q-${answered.id}`,
      kind: 'answer',
      tone: 'ok',
      label: 'Ответ',
      title: 'Деканат ответил на ваш вопрос',
      detail: topicLabel(answered.topic),
      note: null,
      href: `/questions/${answered.id}`,
      action: 'Прочитать ответ',
    })
  }

  return rows
}
