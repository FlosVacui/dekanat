// Вставка набора вымышленных данных. Общий код для команды db:seed и для тестов (второй набор создают только тесты).
// Скрипты в app/db/ — исключение из правил «база только в слое» и «process.env только в config.ts» (ADR-0002, ADR-0004).
// Повторный запуск безопасен: у строк набора стабильные номера (UUID из хеша имени), вставка идёт «вставить или обновить».
// Заявки и уведомления, появившиеся при работе приложения, скрипт не трогает и не удаляет.
import { createHash } from 'node:crypto'
import type pg from 'pg'
import { addDays } from '../src/lib/dates'
import { hashPassword } from '../src/server/auth/password'

export interface LessonSpec {
  start: string
  end: string
  discipline: string
  kind: 'lecture' | 'seminar' | 'lab'
  room: string
  teacher: string
  /** Изменение, которое видно в расписании: только у пар через `changeOnDay` дней от сегодня. */
  change?: { dayOffset: number; kind: 'cancelled' | 'moved' | 'room_changed' | 'teacher_changed'; note: string }
}

export interface DisciplineSpec {
  name: string
  controlKind: 'exam' | 'credit'
  semester: number
  /** Дни от сегодня; у дисциплины, по которой экзамен или зачёт ещё впереди или уже прошёл. */
  exam?: { dayOffset: number; time: string; room: string }
  assignments: { title: string; dayOffset: number; maxPoints: number }[]
}

export interface GroupSpec {
  name: string
  faculty: string
  /** Ежедневный набор пар на семь дней начиная с сегодняшнего. */
  dailyLessons: LessonSpec[]
  disciplines: DisciplineSpec[]
}

export interface StudentSpec {
  login: string
  password: string
  fullName: string
  faculty: string
  programme: string
  course: number
  groupName: string
  grades: { discipline: string; points: number | null; outcome: '5' | '4' | '3' | '2' | 'credit' | 'no_credit' | 'pending'; admitted?: boolean }[]
  requests: {
    key: string
    kind: 'dean_certificate' | 'tuition_certificate' | 'financial_aid'
    status: 'submitted' | 'in_progress' | 'ready' | 'issued' | 'rejected'
    note: string
    daysAgo: number
  }[]
  notifications: { key: string; kind: 'reminder' | 'news'; title: string; body: string; link: string | null; unread: boolean }[]
  /** Что тест ищет в чужих ответах: у каждого студента своя метка в профиле, расписании, оценках, заявках и уведомлениях. */
  markers: { profile: string; schedule: string; grades: string; requests: string; notifications: string }
}

export interface CohortSpec {
  cohort: string
  /** «Пароль опубликован»: да у основного набора, нет у резервного, пока его не выдали жюри (ADR-0003). */
  passwordPublished: boolean
  staff: { login: string; password: string }
  groups: GroupSpec[]
  students: StudentSpec[]
  announcements: { key: string; groupName?: string; faculty?: string; title: string; body: string; hoursAgo: number }[]
}

/** Стабильный UUID из набора слов: повторный запуск обновляет те же строки. */
export function detId(...parts: string[]): string {
  const h = createHash('sha1').update(parts.join('\u0000')).digest()
  h[6] = (h[6]! & 0x0f) | 0x50
  h[8] = (h[8]! & 0x3f) | 0x80
  const hex = h.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export async function seedCohort(client: pg.Client | pg.PoolClient, spec: CohortSpec, today: string): Promise<void> {
  const q = (text: string, values: unknown[] = []) => client.query(text, values)
  const staffHash = await hashPassword(spec.staff.password)
  const studentHashes = await Promise.all(spec.students.map((s) => hashPassword(s.password)))

  await q('BEGIN')
  try {
    // Группы.
    const groupId = new Map<string, string>()
    for (const g of spec.groups) {
      const id = detId('group', spec.cohort, g.name)
      groupId.set(g.name, id)
      await q(
        `INSERT INTO groups (id, name, faculty) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, faculty = EXCLUDED.faculty`,
        [id, g.name, g.faculty],
      )
      // Расписание: даты считаются от сегодняшнего дня, чтобы «сегодня» всегда было с парами.
      for (let day = 0; day < 7; day += 1) {
        for (const [index, lesson] of g.dailyLessons.entries()) {
          const lessonId = detId('lesson', spec.cohort, g.name, String(day), String(index))
          await q(
            `INSERT INTO lessons (id, group_id, lesson_date, starts_at, ends_at, discipline, kind, room, teacher)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET lesson_date = EXCLUDED.lesson_date, starts_at = EXCLUDED.starts_at,
               ends_at = EXCLUDED.ends_at, discipline = EXCLUDED.discipline, kind = EXCLUDED.kind,
               room = EXCLUDED.room, teacher = EXCLUDED.teacher`,
            [lessonId, id, addDays(today, day), lesson.start, lesson.end, lesson.discipline, lesson.kind, lesson.room, lesson.teacher],
          )
          const changeId = detId('lesson-change', lessonId)
          if (lesson.change && lesson.change.dayOffset === day) {
            await q(
              `INSERT INTO lesson_changes (id, lesson_id, kind, note) VALUES ($1, $2, $3, $4)
               ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, note = EXCLUDED.note`,
              [changeId, lessonId, lesson.change.kind, lesson.change.note],
            )
          } else {
            await q('DELETE FROM lesson_changes WHERE id = $1', [changeId])
          }
        }
      }
      for (const d of g.disciplines) {
        const disciplineId = detId('discipline', spec.cohort, g.name, d.name)
        await q(
          `INSERT INTO disciplines (id, group_id, name, control_kind, semester, exam_date, exam_time, exam_room)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET control_kind = EXCLUDED.control_kind, semester = EXCLUDED.semester,
             exam_date = EXCLUDED.exam_date, exam_time = EXCLUDED.exam_time, exam_room = EXCLUDED.exam_room`,
          [
            disciplineId,
            id,
            d.name,
            d.controlKind,
            d.semester,
            d.exam ? addDays(today, d.exam.dayOffset) : null,
            d.exam?.time ?? null,
            d.exam?.room ?? null,
          ],
        )
        for (const [index, a] of d.assignments.entries()) {
          await q(
            `INSERT INTO assignments (id, discipline_id, title, due_date, max_points) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, due_date = EXCLUDED.due_date, max_points = EXCLUDED.max_points`,
            [detId('assignment', disciplineId, String(index)), disciplineId, a.title, addDays(today, a.dayOffset), a.maxPoints],
          )
        }
      }
    }

    // Сотрудник.
    const staffId = detId('user', spec.staff.login)
    await q(
      `INSERT INTO users (id, login, password_hash, role, cohort, password_published) VALUES ($1, $2, $3, 'staff', $4, $5)
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, cohort = EXCLUDED.cohort,
         password_published = EXCLUDED.password_published`,
      [staffId, spec.staff.login.trim().toLowerCase(), staffHash, spec.cohort, spec.passwordPublished],
    )

    // Студенты.
    for (const [i, s] of spec.students.entries()) {
      const userId = detId('user', s.login)
      const gId = groupId.get(s.groupName)
      if (!gId) throw new Error(`Нет группы ${s.groupName} в наборе ${spec.cohort}`)
      await q(
        `INSERT INTO users (id, login, password_hash, role, cohort, password_published) VALUES ($1, $2, $3, 'student', $4, $5)
         ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, cohort = EXCLUDED.cohort,
           password_published = EXCLUDED.password_published`,
        [userId, s.login.trim().toLowerCase(), studentHashes[i], spec.cohort, spec.passwordPublished],
      )
      await q(
        `INSERT INTO students (user_id, full_name, faculty, programme, course, group_id) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, faculty = EXCLUDED.faculty,
           programme = EXCLUDED.programme, course = EXCLUDED.course, group_id = EXCLUDED.group_id`,
        [userId, s.fullName, s.faculty, s.programme, s.course, gId],
      )
      for (const g of s.grades) {
        const disciplineId = detId('discipline', spec.cohort, s.groupName, g.discipline)
        await q(
          `INSERT INTO grades (id, student_id, discipline_id, points, outcome, admitted) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (student_id, discipline_id) DO UPDATE SET points = EXCLUDED.points, outcome = EXCLUDED.outcome,
             admitted = EXCLUDED.admitted`,
          [detId('grade', userId, disciplineId), userId, disciplineId, g.points, g.outcome, g.admitted ?? true],
        )
      }
      for (const r of s.requests) {
        const requestId = detId('request', userId, r.key)
        const created = `now() - interval '${Math.trunc(r.daysAgo)} days'`
        await q(
          `INSERT INTO requests (id, student_id, kind, status, note, ip, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'seed', ${created}, ${created})
           ON CONFLICT (id) DO NOTHING`,
          [requestId, userId, r.kind, r.status, r.note],
        )
        await q(
          `INSERT INTO request_events (id, request_id, status, by_user_id, created_at)
           VALUES ($1, $2, $3, $4, ${created}) ON CONFLICT (id) DO NOTHING`,
          [detId('request-event', requestId, r.status), requestId, r.status, r.status === 'submitted' ? userId : staffId],
        )
      }
      for (const n of s.notifications) {
        await q(
          `INSERT INTO notifications (id, student_id, kind, title, body, link, read_at) VALUES ($1, $2, $3, $4, $5, $6, ${
            n.unread ? 'NULL' : 'now()'
          }) ON CONFLICT (id) DO NOTHING`,
          [detId('notification', userId, n.key), userId, n.kind, n.title, n.body, n.link],
        )
      }
    }

    for (const a of spec.announcements) {
      await q(
        `INSERT INTO announcements (id, group_id, faculty, title, body, published_at)
         VALUES ($1, $2, $3, $4, $5, now() - interval '${Math.trunc(a.hoursAgo)} hours')
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body`,
        [
          detId('announcement', spec.cohort, a.key),
          a.groupName ? (groupId.get(a.groupName) ?? null) : null,
          a.faculty ?? null,
          a.title,
          a.body,
        ],
      )
    }
    await q('COMMIT')
  } catch (error) {
    await q('ROLLBACK')
    throw error
  }
}
