// Вставка набора вымышленных данных. Общий код для команд db:seed, db:refresh, db:seed:reserve и для тестов
// (второй набор создают только тесты). Что в наборе и как считаются даты — seed-plan.ts.
// Скрипты в app/db/ — исключение из правил «база только в слое» и «process.env только в config.ts» (ADR-0002, ADR-0004).
// Повторный запуск безопасен: у строк набора стабильные номера (UUID из хеша имени), вставка идёт «вставить или обновить».
//
// Два режима.
// • full — заполнение (`db:seed`). Набор возвращается в исходное состояние: заявки, история статусов и уведомления студентов
//   ЭТОГО набора, которых нет в вымышленных данных (их создало приложение или сквозной тест), удаляются; заявки набора
//   возвращаются к своим шагам; прочитанность уведомлений набора возвращается. Счётчики перебора входа обнуляются целиком
//   (login_attempts, login_ip_windows, login_streaks), если не сказано иначе.
// • refresh — «освежить» (`db:refresh`). Даты набора переносятся на сегодня; заявки и уведомления, которых нет в наборе,
//   не удаляются и не меняются; счётчики входа и пароли не трогаются; прочитанность уведомлений набора остаётся.
//
// В обоих режимах устаревшее у набора убирается: пары вне окна Д-7…Д+27, дисциплины, работы и оценки, которых в наборе
// нет, группы, в которых студенты набора учились раньше, и объявления набора, которых в нём больше нет.
// У таблицы groups нет признака набора, поэтому «группы набора» — группы, где до этого запуска учились студенты набора
// (users.cohort), и группы из набора; «объявления набора» — адресованные этим группам или факультетам этих студентов.
// Названия факультетов у наборов разные (seed-reserve-lib.ts), поэтому объявления других наборов не затрагиваются.
import type pg from 'pg'
import { hashPassword } from '../src/server/auth/password'
import { buildCohortPlan, type CohortPlan, type CohortSpec } from './seed-plan'

export * from './seed-plan'

export interface SeedOptions {
  mode?: 'full' | 'refresh'
  /** Обнулять счётчики входа. По умолчанию — да в full и нет в refresh. Резервный набор их не сбрасывает (IMP-019, п. 2). */
  resetLoginCounters?: boolean
  /** Часовой пояс вуза для времени строк: по умолчанию Europe/Moscow. */
  timezone?: string
}

/** Метка времени строки: день и время по часовому поясу вуза. */
const AT = (dateParam: string, timeParam: string, tzParam: string) =>
  `(${dateParam}::date + ${timeParam}::time) AT TIME ZONE ${tzParam}::text`

export async function seedCohort(client: pg.Client | pg.PoolClient, spec: CohortSpec, today: string, options: SeedOptions = {}): Promise<void> {
  const mode = options.mode ?? 'full'
  const resetCounters = options.resetLoginCounters ?? mode === 'full'
  const tz = options.timezone ?? 'Europe/Moscow'
  const plan = buildCohortPlan(spec, today)
  const q = (text: string, values: unknown[] = []) => client.query(text, values)

  // Пароли хешируются до транзакции. В режиме refresh хеш считается только тем, кого в базе ещё нет: у существующих он не меняется.
  const accounts = [
    { id: plan.staffId, login: spec.staff.login, password: spec.staff.password, role: 'staff' },
    ...plan.students.map((s) => ({ id: s.userId, login: s.spec.login, password: s.spec.password, role: 'student' })),
  ]
  const existing = new Set<string>()
  if (mode === 'refresh') {
    const found = await q('SELECT id FROM users WHERE id = ANY($1::uuid[])', [accounts.map((a) => a.id)])
    for (const row of found.rows) existing.add(row.id as string)
  }
  const hashes = new Map<string, string>()
  for (const account of accounts) {
    if (!existing.has(account.id)) hashes.set(account.id, await hashPassword(account.password))
  }

  await q('BEGIN')
  try {
    // Что было у набора до запуска: из этого находится устаревшее.
    const before = await q(
      `SELECT DISTINCT s.group_id, s.faculty FROM students s JOIN users u ON u.id = s.user_id WHERE u.cohort = $1`,
      [spec.cohort],
    )
    const cohortGroupIds = new Set<string>([...before.rows.map((r) => r.group_id as string), ...plan.groups.map((g) => g.id)])
    const cohortFaculties = new Set<string>([...before.rows.map((r) => r.faculty as string), ...plan.groups.map((g) => g.faculty)])
    for (const s of plan.students) cohortFaculties.add(s.spec.faculty)
    // Факультет прежней группы тоже факультет набора: объявления адресуются по его названию.
    const groupFaculties = await q('SELECT faculty FROM groups WHERE id = ANY($1::uuid[])', [[...cohortGroupIds]])
    for (const row of groupFaculties.rows) cohortFaculties.add(row.faculty as string)

    await upsertGroupsAndTimetable(q, plan)
    await upsertAccounts(q, spec, plan, hashes, accounts, mode)

    // Заявки и уведомления.
    const keptRequestIds: string[] = []
    const keptNotificationIds: string[] = []
    for (const student of plan.students) {
      for (const r of student.requests) {
        keptRequestIds.push(r.id)
        const first = r.steps[0]!
        const last = r.steps[r.steps.length - 1]!
        await q(
          `INSERT INTO requests (id, student_id, kind, status, note, ip, created_at, updated_at, due_date, pickup_until, issued_on,
             reject_reason, purpose, payment_year)
           VALUES ($1, $2, $3, $4, $5, 'seed', ${AT('$6', '$7', '$8')}, ${AT('$9', '$10', '$8')}, $11, $12, $13, $14, $15, $16)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, ip = EXCLUDED.ip,
             created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, due_date = EXCLUDED.due_date,
             pickup_until = EXCLUDED.pickup_until, issued_on = EXCLUDED.issued_on, reject_reason = EXCLUDED.reject_reason,
             purpose = EXCLUDED.purpose, payment_year = EXCLUDED.payment_year`,
          [
            r.id, student.userId, r.kind, r.status, r.note,
            first.date, first.time, tz, last.date, last.time,
            r.dueDate, r.pickupUntil, r.issuedOn, r.rejectReason, r.purpose, r.paymentYear,
          ],
        )
        // История: ровно шаги набора. Шаги, которые добавило приложение у заявки набора, убираются.
        await q('DELETE FROM request_events WHERE request_id = $1 AND id <> ALL($2::uuid[])', [r.id, r.steps.map((s) => s.id)])
        for (const step of r.steps) {
          await q(
            `INSERT INTO request_events (id, request_id, status, by_user_id, note, ip, created_at)
             VALUES ($1, $2, $3, $4, $5, NULL, ${AT('$6', '$7', '$8')})
             ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, by_user_id = EXCLUDED.by_user_id, note = EXCLUDED.note,
               ip = EXCLUDED.ip, created_at = EXCLUDED.created_at`,
            [step.id, r.id, step.status, step.byStudent ? student.userId : plan.staffId, step.note, step.date, step.time, tz],
          )
        }
      }
      for (const n of student.notifications) {
        keptNotificationIds.push(n.id)
        // full: прочитанность возвращается к набору (прочитанное остаётся прочитанным, дата не гуляет). refresh: не трогается.
        const readAt = mode === 'full' ? (n.unread ? 'NULL' : 'COALESCE(notifications.read_at, now())') : 'notifications.read_at'
        await q(
          `INSERT INTO notifications (id, student_id, kind, title, body, link, created_at, read_at)
           VALUES ($1, $2, $3, $4, $5, $6, ${AT('$7', '$8', '$9')}, ${n.unread ? 'NULL' : 'now()'})
           ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, title = EXCLUDED.title, body = EXCLUDED.body,
             link = EXCLUDED.link, created_at = EXCLUDED.created_at, read_at = ${readAt}`,
          [n.id, student.userId, n.kind, n.title, n.body, n.link, n.date, n.time, tz],
        )
      }
    }

    // Возврат в исходное состояние (только full): лишнее у студентов этого набора удаляется.
    // История статусов уходит вместе с заявкой (ON DELETE CASCADE).
    if (mode === 'full') {
      const cohortStudents = `SELECT id FROM users WHERE cohort = $1 AND role = 'student'`
      await q(`DELETE FROM requests WHERE student_id IN (${cohortStudents}) AND id <> ALL($2::uuid[])`, [spec.cohort, keptRequestIds])
      await q(`DELETE FROM notifications WHERE student_id IN (${cohortStudents}) AND id <> ALL($2::uuid[])`, [
        spec.cohort,
        keptNotificationIds,
      ])
    }

    // Объявления: набор вставляется, устаревшие объявления набора убираются.
    for (const a of plan.announcements) {
      await q(
        `INSERT INTO announcements (id, group_id, faculty, title, body, published_at)
         VALUES ($1, $2, $3, $4, $5, ${AT('$6', '$7', '$8')})
         ON CONFLICT (id) DO UPDATE SET group_id = EXCLUDED.group_id, faculty = EXCLUDED.faculty, title = EXCLUDED.title,
           body = EXCLUDED.body, published_at = EXCLUDED.published_at`,
        [a.id, a.groupId, a.faculty, a.title, a.body, a.date, a.time, tz],
      )
    }
    await q(
      `DELETE FROM announcements WHERE id <> ALL($1::uuid[]) AND (group_id = ANY($2::uuid[]) OR faculty = ANY($3::text[]))`,
      [plan.announcements.map((a) => a.id), [...cohortGroupIds], [...cohortFaculties]],
    )

    // Группы, где студенты набора учились раньше, а теперь нет: вместе с парами, дисциплинами, работами и оценками (CASCADE).
    await q(
      `DELETE FROM groups WHERE id = ANY($1::uuid[]) AND id <> ALL($2::uuid[])
         AND NOT EXISTS (SELECT 1 FROM students WHERE students.group_id = groups.id)`,
      [[...cohortGroupIds], plan.groups.map((g) => g.id)],
    )

    // Счётчики перебора входа обнуляются: так стенд проверяет лимиты с чистого листа и прежний прогон не мешает
    // следующему (ADR-0003, «Выключателя лимитов нет»). Резервный набор и «освежить» их не сбрасывают.
    if (resetCounters) {
      await q('DELETE FROM login_attempts')
      await q('DELETE FROM login_ip_windows')
      await q('DELETE FROM login_streaks')
    }
    await q('COMMIT')
  } catch (error) {
    await q('ROLLBACK')
    throw error
  }
}

type Query = (text: string, values?: unknown[]) => Promise<pg.QueryResult>

/** Группы, пары с изменениями, дисциплины и работы набора; устаревшее в этих группах удаляется. */
async function upsertGroupsAndTimetable(q: Query, plan: CohortPlan): Promise<void> {
  for (const g of plan.groups) {
    await q(
      `INSERT INTO groups (id, name, faculty) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, faculty = EXCLUDED.faculty`,
      [g.id, g.name, g.faculty],
    )
    const lessons = plan.lessons.filter((l) => l.groupName === g.name)
    for (const l of lessons) {
      await q(
        `INSERT INTO lessons (id, group_id, lesson_date, starts_at, ends_at, discipline, kind, room, teacher)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET lesson_date = EXCLUDED.lesson_date, starts_at = EXCLUDED.starts_at,
           ends_at = EXCLUDED.ends_at, discipline = EXCLUDED.discipline, kind = EXCLUDED.kind,
           room = EXCLUDED.room, teacher = EXCLUDED.teacher`,
        [l.id, g.id, l.date, l.startsAt, l.endsAt, l.discipline, l.kind, l.room, l.teacher],
      )
      if (l.change) {
        const c = l.change
        await q(
          `INSERT INTO lesson_changes (id, lesson_id, kind, note, new_date, new_starts_at, new_ends_at, new_room)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, note = EXCLUDED.note, new_date = EXCLUDED.new_date,
             new_starts_at = EXCLUDED.new_starts_at, new_ends_at = EXCLUDED.new_ends_at, new_room = EXCLUDED.new_room`,
          [c.id, l.id, c.kind, c.note, c.newDate, c.newStartsAt, c.newEndsAt, c.newRoom],
        )
      }
    }
    const lessonIds = lessons.map((l) => l.id)
    const changeIds = lessons.flatMap((l) => (l.change ? [l.change.id] : []))
    await q('DELETE FROM lesson_changes WHERE lesson_id = ANY($1::uuid[]) AND id <> ALL($2::uuid[])', [lessonIds, changeIds])
    await q('DELETE FROM lessons WHERE group_id = $1 AND id <> ALL($2::uuid[])', [g.id, lessonIds])

    const disciplines = plan.disciplines.filter((d) => d.groupName === g.name)
    for (const d of disciplines) {
      await q(
        `INSERT INTO disciplines (id, group_id, name, control_kind, semester, exam_date, exam_time, exam_room)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET control_kind = EXCLUDED.control_kind, semester = EXCLUDED.semester,
           exam_date = EXCLUDED.exam_date, exam_time = EXCLUDED.exam_time, exam_room = EXCLUDED.exam_room`,
        [d.id, g.id, d.name, d.controlKind, d.semester, d.examDate, d.examTime, d.examRoom],
      )
      for (const a of d.assignments) {
        await q(
          `INSERT INTO assignments (id, discipline_id, title, due_date, max_points) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, due_date = EXCLUDED.due_date, max_points = EXCLUDED.max_points`,
          [a.id, d.id, a.title, a.dueDate, a.maxPoints],
        )
      }
      await q('DELETE FROM assignments WHERE discipline_id = $1 AND id <> ALL($2::uuid[])', [d.id, d.assignments.map((a) => a.id)])
    }
    await q('DELETE FROM disciplines WHERE group_id = $1 AND id <> ALL($2::uuid[])', [g.id, disciplines.map((d) => d.id)])
  }
}

/** Сотрудник, студенты и их оценки. Оценок, которых нет в наборе, у студента не остаётся. */
async function upsertAccounts(
  q: Query,
  spec: CohortSpec,
  plan: CohortPlan,
  hashes: Map<string, string>,
  accounts: { id: string; login: string; role: string }[],
  mode: 'full' | 'refresh',
): Promise<void> {
  for (const account of accounts) {
    const hash = hashes.get(account.id)
    // У существующей учётной записи в режиме refresh хеш и признаки не трогаются.
    if (mode === 'refresh' && hash === undefined) continue
    await q(
      `INSERT INTO users (id, login, password_hash, role, cohort, password_published) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, cohort = EXCLUDED.cohort,
         password_published = EXCLUDED.password_published`,
      [account.id, account.login.trim().toLowerCase(), hash, account.role, spec.cohort, spec.passwordPublished],
    )
  }
  for (const s of plan.students) {
    await q(
      `INSERT INTO students (user_id, full_name, faculty, programme, course, group_id) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, faculty = EXCLUDED.faculty,
         programme = EXCLUDED.programme, course = EXCLUDED.course, group_id = EXCLUDED.group_id`,
      [s.userId, s.spec.fullName, s.spec.faculty, s.spec.programme, s.spec.course, s.groupId],
    )
    for (const g of s.grades) {
      await q(
        `INSERT INTO grades (id, student_id, discipline_id, points, outcome, admitted) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, discipline_id) DO UPDATE SET points = EXCLUDED.points, outcome = EXCLUDED.outcome,
           admitted = EXCLUDED.admitted`,
        [g.id, s.userId, g.disciplineId, g.points, g.outcome, g.admitted],
      )
    }
    await q('DELETE FROM grades WHERE student_id = $1 AND id <> ALL($2::uuid[])', [s.userId, s.grades.map((g) => g.id)])
  }
}
