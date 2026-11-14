// Раскладка расписания по дням. Чистая функция: без базы и без текущего времени, «сегодня» приходит аргументом.
// Экран «Расписание» получает отсюда всё готовое и ничего не считает сам: ни порядок, ни «Было», ни «Перенесена на».
//
// Правила (пакет 3.2):
// - дней семь, начиная с сегодняшнего;
// - отменённая пара остаётся на своём месте с пометкой;
// - перенесённая показывается дважды: на старом месте («moved_from», текст в `movedTo`) и на новом («moved_to», строка в `was`).
//   Нового места нет среди семи дней — остаётся только старое, с текстом, куда перенесена;
// - внутри дня порядок по времени, с учётом нового времени;
// - у дня есть признак «есть изменения» и число пар без отменённых.

import { addDays, formatDayMonth, isIsoDate, weekdayShort } from './dates'
import { changeBadgeLabel } from './labels'

/** Сколько дней показывает экран: сегодня и шесть следующих. */
export const SCHEDULE_DAYS = 7

/**
 * На сколько дней назад экран просит пары: пара, перенесённая с прошедшего дня на день ленты, стоит в базе на старой дате.
 * Вместе с семью днями это 20 дней: слой доступа пропускает до 31.
 */
export const SCHEDULE_LOOKBACK_DAYS = 14

/** Виды изменения пары — как в базе. */
export type ScheduleChangeKind = 'cancelled' | 'moved' | 'room_changed' | 'teacher_changed'

const CHANGE_KINDS: readonly string[] = ['cancelled', 'moved', 'room_changed', 'teacher_changed']

/** Пара в том виде, как её отдаёт `listMyLessons` (`LessonItem`). Тип описан здесь, чтобы библиотека не зависела от серверного кода. */
export interface ScheduleLesson {
  id: string
  /** «ГГГГ-ММ-ДД» */
  date: string
  /** «ЧЧ:ММ» */
  startsAt: string
  endsAt: string
  discipline: string
  /** Код вида занятия: lecture, seminar, lab. Подпись — `lessonKindLabel`. */
  kind: string
  room: string
  teacher: string
  change: {
    kind: string
    note: string
    /** Только у переноса; что пусто — не меняется. */
    newDate: string | null
    newStartsAt: string | null
    newEndsAt: string | null
    newRoom: string | null
  } | null
}

/**
 * Где стоит запись:
 * - `regular` — пара на своём месте (без изменения, отменённая, со сменой аудитории или преподавателя);
 * - `moved_from` — старое место перенесённой пары; в `movedTo` сказано, куда она ушла;
 * - `moved_to` — новое место перенесённой пары; в `was` сказано, где она была.
 */
export type EntryPlacement = 'regular' | 'moved_from' | 'moved_to'

/** Одна строка расписания на одном дне. */
export interface ScheduleEntry {
  /** Уникален в пределах недели: годится как `key` в списке. */
  key: string
  lessonId: string
  placement: EntryPlacement
  discipline: string
  /** Код вида занятия; подпись — `lessonKindLabel`. */
  lessonKind: string
  /** Время на ЭТОМ месте: у `moved_to` новое, у `moved_from` прежнее. «ЧЧ:ММ». */
  startsAt: string
  endsAt: string
  /** Аудитория на этом месте: у `moved_to` и у смены аудитории — новая. */
  room: string
  /** Преподаватель: при замене — новый, если его удалось прочитать из заметки, иначе прежний. */
  teacher: string
  /** Вид изменения; `null` — пара без изменений. */
  changeKind: ScheduleChangeKind | null
  /** Отменена: название и время на экране зачёркнуты, под ними «Занятие не состоится». */
  cancelled: boolean
  /** Текст плашки: «Отменена», «Перенесена», «Сменилась аудитория», «Сменился преподаватель». `null` — плашки нет. */
  badge: string | null
  /** Только у `moved_from`: «Перенесена на сб, 21 ноября, 10:15–11:45, ауд. 2-214». Если день тот же — без даты: «Перенесена на 15:45–17:15, ауд. 1-204». Аудитория названа всегда. */
  movedTo: string | null
  /** «Было: …» у `moved_to`, смены аудитории и замены преподавателя; иначе `null`. Время, дата и аудитория — только то, что поменялось. */
  was: string | null
  /** Заметка деканата как есть («преподаватель в командировке»); `null`, если изменения нет. */
  note: string | null
}

/** Один день ленты. */
export interface ScheduleDay {
  /** «ГГГГ-ММ-ДД» */
  date: string
  /** «чт» — для полосы дней. */
  weekday: string
  /** Число месяца — для полосы дней. */
  dayOfMonth: number
  /** «12 ноября» — для заголовка дня. */
  dayMonth: string
  isToday: boolean
  /** В дне есть отмена, перенос (с любой стороны), смена аудитории или преподавателя: у дня в полосе — точка. */
  hasChanges: boolean
  /** Пар в этот день без отменённых и без старых мест перенесённых (пара ушла). Новое место перенесённой пары считается. */
  lessonCount: number
  /** В порядке времени. Пустой список — «пар нет». */
  entries: ScheduleEntry[]
}

const PLACEMENT_ORDER: Record<EntryPlacement, number> = { moved_from: 0, regular: 1, moved_to: 2 }

function range(start: string, end: string): string {
  return `${start}–${end}`
}

/** «Ведёт Яковлева А. С. вместо Мельник Д. О.» -> новый и прежний преподаватель; не по шаблону — `null`. */
function parseTeacherChange(note: string): { next: string; prev: string } | null {
  const m = /^Ведёт\s+(.+?)\s+вместо\s+(.+)$/.exec(note.trim())
  return m ? { next: m[1]!, prev: m[2]! } : null
}

/** «сб, 21 ноября» */
function dayLabel(date: string): string {
  return `${weekdayShort(date)}, ${formatDayMonth(date)}`
}

/**
 * Раскладывает пары по семи дням, начиная с `today`.
 * Пары вне семи дней отбрасываются, кроме перенесённых в этот промежуток: из прошлых пар остаётся только новое место
 * переноса, попавшее в ленту (старое место, прошлая пара без переноса, прошлая отменённая в ленту не входят).
 * Порядок во входе не важен.
 */
export function buildSchedule(lessons: readonly ScheduleLesson[], today: string, days: number = SCHEDULE_DAYS): ScheduleDay[] {
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i))
  const byDate = new Map<string, ScheduleEntry[]>(dates.map((d) => [d, []]))

  for (const lesson of lessons) {
    const kind = lesson.change && CHANGE_KINDS.includes(lesson.change.kind) ? (lesson.change.kind as ScheduleChangeKind) : null
    const change = kind ? lesson.change : null
    const base = {
      lessonId: lesson.id,
      discipline: lesson.discipline,
      lessonKind: lesson.kind,
      note: change?.note ?? null,
    }
    const original = { startsAt: lesson.startsAt, endsAt: lesson.endsAt, room: lesson.room, teacher: lesson.teacher }

    if (kind === 'moved' && change) {
      const newDate = change.newDate ?? lesson.date
      // Новое время — пара «начало и конец»: задано одно из двух, время считается не заданным (иначе выйдет «12:00–11:45»).
      const newTime = change.newStartsAt && change.newEndsAt ? { startsAt: change.newStartsAt, endsAt: change.newEndsAt } : null
      const next = {
        date: newDate,
        startsAt: newTime?.startsAt ?? lesson.startsAt,
        endsAt: newTime?.endsAt ?? lesson.endsAt,
        room: change.newRoom ?? lesson.room,
      }
      const sameDay = newDate === lesson.date
      const samePlace =
        sameDay && next.startsAt === lesson.startsAt && next.endsAt === lesson.endsAt && next.room === lesson.room
      if (samePlace) {
        // Перенос без новых данных: показывать дважды нечего. Одна строка с плашкой.
        byDate.get(lesson.date)?.push({
          ...base,
          key: `${lesson.id}:regular`,
          placement: 'regular',
          ...original,
          changeKind: 'moved',
          cancelled: false,
          badge: changeBadgeLabel('moved'),
          movedTo: null,
          was: null,
        })
        continue
      }
      const timeText = range(next.startsAt, next.endsAt)
      // В «Перенесена на …» аудитория названа всегда: студенту нужно знать, куда идти.
      const target = sameDay ? `${timeText}, ауд. ${next.room}` : `${dayLabel(newDate)}, ${timeText}, ауд. ${next.room}`
      byDate.get(lesson.date)?.push({
        ...base,
        key: `${lesson.id}:moved_from`,
        placement: 'moved_from',
        ...original,
        changeKind: 'moved',
        cancelled: false,
        badge: changeBadgeLabel('moved'),
        movedTo: `Перенесена на ${target}`,
        was: null,
      })
      const wasDate = sameDay ? '' : `${dayLabel(lesson.date)}, `
      const wasRoom = next.room !== lesson.room ? `, ауд. ${lesson.room}` : ''
      byDate.get(newDate)?.push({
        ...base,
        key: `${lesson.id}:moved_to`,
        placement: 'moved_to',
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        room: next.room,
        teacher: lesson.teacher,
        changeKind: 'moved',
        cancelled: false,
        badge: changeBadgeLabel('moved'),
        movedTo: null,
        was: `Было: ${wasDate}${range(lesson.startsAt, lesson.endsAt)}${wasRoom}`,
      })
      continue
    }

    let room = lesson.room
    let teacher = lesson.teacher
    let was: string | null = null
    if (kind === 'room_changed' && change?.newRoom && change.newRoom !== lesson.room) {
      room = change.newRoom
      was = `Было: ауд. ${lesson.room}`
    } else if (kind === 'teacher_changed' && change) {
      const parsed = parseTeacherChange(change.note)
      if (parsed) {
        teacher = parsed.next
        was = `Было: ${parsed.prev}`
      }
    }
    byDate.get(lesson.date)?.push({
      ...base,
      key: `${lesson.id}:regular`,
      placement: 'regular',
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
      room,
      teacher,
      changeKind: kind,
      cancelled: kind === 'cancelled',
      badge: kind ? changeBadgeLabel(kind) : null,
      movedTo: null,
      was,
    })
  }

  return dates.map((date) => {
    const entries = (byDate.get(date) ?? []).sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) ||
        PLACEMENT_ORDER[a.placement] - PLACEMENT_ORDER[b.placement] ||
        a.discipline.localeCompare(b.discipline, 'ru'),
    )
    return {
      date,
      weekday: weekdayShort(date),
      dayOfMonth: Number(date.slice(8, 10)),
      dayMonth: formatDayMonth(date),
      isToday: date === today,
      hasChanges: entries.some((e) => e.changeKind !== null),
      lessonCount: entries.filter((e) => !e.cancelled && e.placement !== 'moved_from').length,
      entries,
    }
  })
}

/**
 * День из параметра адреса `?day=`: дата из семи дней от сегодняшнего — она; всё остальное (нет, не дата, вне семи дней) — сегодня.
 * Ошибки нет: мусор в адресе не ломает экран.
 */
export function pickDay(param: string | string[] | undefined, today: string, days: number = SCHEDULE_DAYS): string {
  if (typeof param !== 'string' || !isIsoDate(param)) return today
  for (let i = 0; i < days; i += 1) if (addDays(today, i) === param) return param
  return today
}

/** Вид из параметра адреса `?view=`: «week» — неделя, всё остальное — день. */
export function pickView(param: string | string[] | undefined): 'day' | 'week' {
  return param === 'week' ? 'week' : 'day'
}
