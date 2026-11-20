import { addDays, todayIn } from '@/lib/dates'
import { upcomingExams, workDeadlines } from '@/lib/reminders/due'
import { SCHEDULE_LOOKBACK_DAYS, buildSchedule } from '@/lib/schedule'
import { getCurrentActor } from '@/server/auth/cookie'
import { getConfig } from '@/server/config'
import { listMyGrades, listMyLessons } from '@/server/dal/student'
import { buildIcs } from '../ics'

// GET /schedule/calendar.ics: пары студента на 14 дней вперёд, с переносами и отменами, файлом для календаря телефона.
// 20.11: и сроки несданных работ на те же 14 дней, и экзамены (до конца сессии, если он ближе 60 дней), с напоминаниями.
// Группа — из сессии; в адресе её нет. Раскладка — та же `buildSchedule`, что у экрана «Расписание».
// Не вошёл — 401, сотрудник — 403. Ответ личный: не кэшируется.
export const dynamic = 'force-dynamic'

/** Сколько дней вперёд попадает в файл. */
const CALENDAR_DAYS = 14

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}

export async function GET(): Promise<Response> {
  const actor = await getCurrentActor()
  if (!actor) return new Response(null, { status: 401, headers: BASE_HEADERS })
  if (actor.role !== 'student') return new Response(null, { status: 403, headers: BASE_HEADERS })
  const { timezone } = getConfig()
  const today = todayIn(timezone)
  // Как на экране: пары просятся и за прошедшие дни, чтобы перенесённая со вчера на сегодня пара не пропала.
  const lessons = await listMyLessons(actor, addDays(today, -SCHEDULE_LOOKBACK_DAYS), addDays(today, CALENDAR_DAYS - 1))
  // 20.11: сроки работ и экзамены — из тех же данных, что экран «Успеваемость»: своя группа и свои баллы из сессии.
  const grades = await listMyGrades(actor, today)
  const reminders = { works: workDeadlines(grades, today, CALENDAR_DAYS), exams: upcomingExams(grades, today) }
  const body = buildIcs(buildSchedule(lessons, today, CALENDAR_DAYS), timezone, new Date(), reminders)
  return new Response(body, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="schedule.ics"',
    },
  })
}
