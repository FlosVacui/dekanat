// Описание таблиц. Только определения: ни соединения, ни запросов. Читается и слоем доступа,
// и drizzle-kit при создании миграций, поэтому без `server-only`.
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`)
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/** Аккаунты. Все аккаунты прототипа тестовые: у каждого набор и признак «пароль опубликован» (ADR-0003). */
export const users = pgTable(
  'users',
  {
    id: id(),
    login: text('login').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(),
    cohort: text('cohort').notNull(),
    passwordPublished: boolean('password_published').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [check('users_role_check', sql`${t.role} in ('student', 'staff')`)],
)

export const groups = pgTable('groups', {
  id: id(),
  name: text('name').notNull().unique(),
  faculty: text('faculty').notNull(),
})

export const students = pgTable('students', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  fullName: text('full_name').notNull(),
  faculty: text('faculty').notNull(),
  programme: text('programme').notNull(),
  course: integer('course').notNull(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => groups.id),
})

/** Сессии: в базе только хеш токена (ADR-0003). */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: text('ip').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/**
 * Счётчики перебора входа (ADR-0003, «Защита от перебора»). Ключи — приведённая строка логина и адрес, а не номер
 * пользователя: выдуманный логин получает те же задержки. Пишутся одной атомарной операцией до проверки пароля.
 * Сбрасывает счётчики `npm run db:seed`; сами строки чистятся по давности.
 */

/** Пара «адрес и логин»: число попыток подряд и время, раньше которого следующая попытка не принимается. */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    ip: text('ip').notNull(),
    login: text('login').notNull(),
    fails: integer('fails').notNull(),
    nextAllowedAt: timestamp('next_allowed_at', { withTimezone: true }).notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ip, t.login] }), index('login_attempts_last_idx').on(t.lastAttemptAt)],
)

/** Адрес: число попыток входа в текущем окне в 10 минут, верных и неверных вместе. */
export const loginIpWindows = pgTable(
  'login_ip_windows',
  {
    ip: text('ip').primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull(),
  },
  (t) => [index('login_ip_windows_start_idx').on(t.windowStart)],
)

/** Логин с неопубликованным паролем: неверные попытки подряд. Сбрасывается только верным входом. */
export const loginStreaks = pgTable('login_streaks', {
  login: text('login').primaryKey(),
  fails: integer('fails').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const lessons = pgTable(
  'lessons',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    lessonDate: date('lesson_date', { mode: 'string' }).notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    discipline: text('discipline').notNull(),
    kind: text('kind').notNull(),
    room: text('room').notNull(),
    teacher: text('teacher').notNull(),
  },
  (t) => [
    index('lessons_group_date_idx').on(t.groupId, t.lessonDate),
    check('lessons_kind_check', sql`${t.kind} in ('lecture', 'seminar', 'lab')`),
  ],
)

export const lessonChanges = pgTable(
  'lesson_changes',
  {
    id: id(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lessons.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    note: text('note').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('lesson_changes_kind_check', sql`${t.kind} in ('cancelled', 'moved', 'room_changed', 'teacher_changed')`),
  ],
)

export const disciplines = pgTable(
  'disciplines',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    controlKind: text('control_kind').notNull(),
    semester: integer('semester').notNull(),
    examDate: date('exam_date', { mode: 'string' }),
    examTime: time('exam_time'),
    examRoom: text('exam_room'),
  },
  (t) => [
    index('disciplines_group_idx').on(t.groupId),
    check('disciplines_control_check', sql`${t.controlKind} in ('exam', 'credit')`),
  ],
)

export const assignments = pgTable('assignments', {
  id: id(),
  disciplineId: uuid('discipline_id')
    .notNull()
    .references(() => disciplines.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  maxPoints: integer('max_points').notNull(),
})

export const grades = pgTable(
  'grades',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.userId, { onDelete: 'cascade' }),
    disciplineId: uuid('discipline_id')
      .notNull()
      .references(() => disciplines.id, { onDelete: 'cascade' }),
    points: integer('points'),
    outcome: text('outcome').notNull(),
    admitted: boolean('admitted').notNull().default(true),
  },
  (t) => [
    unique('grades_student_discipline_unique').on(t.studentId, t.disciplineId),
    check('grades_outcome_check', sql`${t.outcome} in ('5', '4', '3', '2', 'credit', 'no_credit', 'pending')`),
    check('grades_points_check', sql`${t.points} is null or (${t.points} >= 0 and ${t.points} <= 100)`),
  ],
)

/** Заявки. Адрес подачи записан в самой заявке; ссылки на сессию нет (ADR-0003, «Чистка спама»). */
export const requests = pgTable(
  'requests',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.userId, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('submitted'),
    note: text('note'),
    ip: text('ip').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    dueDate: date('due_date', { mode: 'string' }),
    pickupUntil: date('pickup_until', { mode: 'string' }),
    issuedOn: date('issued_on', { mode: 'string' }),
    rejectReason: text('reject_reason'),
  },
  (t) => [
    index('requests_student_idx').on(t.studentId, t.createdAt),
    index('requests_ip_created_idx').on(t.ip, t.createdAt),
    check('requests_kind_check', sql`${t.kind} in ('dean_certificate', 'tuition_certificate', 'financial_aid')`),
    check('requests_status_check', sql`${t.status} in ('submitted', 'in_progress', 'ready', 'issued', 'rejected')`),
  ],
)

export const requestEvents = pgTable(
  'request_events',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    byUserId: uuid('by_user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    /** Адрес, с которого сотрудник сменил статус: по нему считается лимит смены статуса. У прежних строк пусто. */
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('request_events_request_idx').on(t.requestId, t.createdAt),
    index('request_events_by_user_idx').on(t.byUserId, t.createdAt),
  ],
)

export const announcements = pgTable('announcements', {
  id: id(),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
  faculty: text('faculty'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
})

export const announcementReads = pgTable(
  'announcement_reads',
  {
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.userId, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.studentId] })],
)

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.userId, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('notifications_student_idx').on(t.studentId, t.createdAt),
    check('notifications_kind_check', sql`${t.kind} in ('reminder', 'news')`),
  ],
)
