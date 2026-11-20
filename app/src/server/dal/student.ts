import 'server-only'
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { checkAvatar, type AvatarCheck, type AvatarMime } from '@/app/profile/avatar-rules'
import { isIsoDate, todayIn } from '@/lib/dates'
import { isQuestionTopic, normalizeQuestionText, type QuestionTopic } from '@/lib/questions'
import { currentYearIn, isRequestKind, normalizeFields, type RequestKind } from '@/lib/requests'
import { normalizeIp } from '../auth/ip'
import type { Actor } from '../auth/session'
import { getConfig } from '../config'
import { getDb } from './client'
import { RequestLimitError, isUuid, requireStudent } from './guards'
import {
  announcementReads,
  announcements,
  assignmentResults,
  assignments,
  courseMaterials,
  disciplines,
  grades,
  groups,
  lessonChanges,
  lessons,
  notifications,
  questions,
  requestEvents,
  requests,
  students,
  userAvatars,
} from './schema'

// Функции студента (ADR-0002). Первый аргумент — действующее лицо из сессии; первым делом проверяется роль.
// Запись ищется вместе с владельцем (или группой) в одном запросе; чужая и несуществующая — одинаково null.
// Наружу идут только перечисленные поля.

const MAX_RANGE_DAYS = 31

function assertRange(from: string, to: string): boolean {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return false
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  return days <= MAX_RANGE_DAYS
}

// ---------- Профиль ----------

export interface Profile {
  fullName: string
  faculty: string
  programme: string
  course: number
  groupName: string
}

export async function getMyProfile(actor: Actor): Promise<Profile | null> {
  const { studentId } = requireStudent(actor)
  const rows = await getDb()
    .select({
      fullName: students.fullName,
      faculty: students.faculty,
      programme: students.programme,
      course: students.course,
      groupName: groups.name,
    })
    .from(students)
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(eq(students.userId, studentId))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Номер текущего семестра: наибольший `disciplines.semester` у группы студента. Группа берётся из сессии, как в `getMyProfile`;
 * у группы набор дисциплин нескольких семестров (5, 4, 3), текущий — самый поздний. Нет дисциплин — null.
 */
export async function getMyCurrentSemester(actor: Actor): Promise<number | null> {
  const { groupId } = requireStudent(actor)
  const rows = await getDb()
    .select({ semester: sql<number | null>`max(${disciplines.semester})::int` })
    .from(disciplines)
    .where(eq(disciplines.groupId, groupId))
  return rows[0]?.semester ?? null
}

// ---------- Расписание группы ----------

export interface LessonItem {
  id: string
  date: string
  startsAt: string
  endsAt: string
  discipline: string
  kind: string
  room: string
  teacher: string
  change: LessonChange | null
}

/**
 * Изменение пары. Поля `new*` заполнены только у переноса (`moved`), и только те, что меняются;
 * у отмены, смены аудитории и смены преподавателя они пусты. Смена аудитории кладёт новое место в `newRoom`.
 * Время — «ЧЧ:ММ», дата — «ГГГГ-ММ-ДД».
 */
export interface LessonChange {
  kind: string
  note: string
  newDate: string | null
  newStartsAt: string | null
  newEndsAt: string | null
  newRoom: string | null
}

/** Пары группы студента за промежуток дат (включительно). Группа — из сессии, не из запроса. */
export async function listMyLessons(actor: Actor, from: string, to: string): Promise<LessonItem[]> {
  const { groupId } = requireStudent(actor)
  if (!assertRange(from, to)) return []
  const rows = await getDb()
    .select({
      id: lessons.id,
      date: lessons.lessonDate,
      startsAt: lessons.startsAt,
      endsAt: lessons.endsAt,
      discipline: lessons.discipline,
      kind: lessons.kind,
      room: lessons.room,
      teacher: lessons.teacher,
      changeKind: lessonChanges.kind,
      changeNote: lessonChanges.note,
      changeNewDate: lessonChanges.newDate,
      changeNewStartsAt: lessonChanges.newStartsAt,
      changeNewEndsAt: lessonChanges.newEndsAt,
      changeNewRoom: lessonChanges.newRoom,
    })
    .from(lessons)
    .leftJoin(lessonChanges, eq(lessonChanges.lessonId, lessons.id))
    .where(and(eq(lessons.groupId, groupId), gte(lessons.lessonDate, from), lte(lessons.lessonDate, to)))
    .orderBy(asc(lessons.lessonDate), asc(lessons.startsAt))
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    startsAt: r.startsAt.slice(0, 5),
    endsAt: r.endsAt.slice(0, 5),
    discipline: r.discipline,
    kind: r.kind,
    room: r.room,
    teacher: r.teacher,
    change:
      r.changeKind && r.changeNote
        ? {
            kind: r.changeKind,
            note: r.changeNote,
            newDate: r.changeNewDate ?? null,
            newStartsAt: r.changeNewStartsAt?.slice(0, 5) ?? null,
            newEndsAt: r.changeNewEndsAt?.slice(0, 5) ?? null,
            newRoom: r.changeNewRoom ?? null,
          }
        : null,
  }))
}

// ---------- Успеваемость ----------

/** Работа дисциплины с баллами текущего студента: `points` пусто — работа не сдана. Баллы других студентов сюда не попадают. */
export interface WorkItem {
  id: string
  title: string
  dueDate: string
  maxPoints: number
  points: number | null
}

export interface GradeItem {
  disciplineId: string
  name: string
  controlKind: string
  semester: number
  points: number | null
  /** '5' | '4' | '3' | '2' | 'credit' | 'no_credit' | 'pending' */
  outcome: string
  admitted: boolean
  examDate: string | null
  examTime: string | null
  examRoom: string | null
  /** Ближайшая работа со сроком не раньше `today`. */
  nextDue: { title: string; dueDate: string } | null
  /** Все работы дисциплины по срокам, с баллами студента из сессии. */
  works: WorkItem[]
}

/**
 * Работы дисциплин с баллами одного студента. Баллы подставляются соединением по номеру студента из сессии:
 * результаты других студентов группы в выборку не попадают. Номера дисциплин вызывающий уже проверил по группе.
 */
async function worksWithPoints(studentId: string, disciplineIds: string[]): Promise<(WorkItem & { disciplineId: string })[]> {
  if (disciplineIds.length === 0) return []
  return getDb()
    .select({
      id: assignments.id,
      disciplineId: assignments.disciplineId,
      title: assignments.title,
      dueDate: assignments.dueDate,
      maxPoints: assignments.maxPoints,
      points: assignmentResults.points,
    })
    .from(assignments)
    .leftJoin(assignmentResults, and(eq(assignmentResults.assignmentId, assignments.id), eq(assignmentResults.studentId, studentId)))
    .where(inArray(assignments.disciplineId, disciplineIds))
    .orderBy(asc(assignments.dueDate), asc(assignments.title))
}

/** Дисциплины группы студента с его баллами и итогами. */
export async function listMyGrades(actor: Actor, today: string): Promise<GradeItem[]> {
  const { studentId, groupId } = requireStudent(actor)
  if (!isIsoDate(today)) return []
  const db = getDb()
  const rows = await db
    .select({
      disciplineId: disciplines.id,
      name: disciplines.name,
      controlKind: disciplines.controlKind,
      semester: disciplines.semester,
      examDate: disciplines.examDate,
      examTime: disciplines.examTime,
      examRoom: disciplines.examRoom,
      points: grades.points,
      outcome: grades.outcome,
      admitted: grades.admitted,
    })
    .from(disciplines)
    .leftJoin(grades, and(eq(grades.disciplineId, disciplines.id), eq(grades.studentId, studentId)))
    .where(eq(disciplines.groupId, groupId))
    .orderBy(asc(disciplines.name))

  const ids = rows.map((r) => r.disciplineId)
  const due = ids.length
    ? await db
        .select({ disciplineId: assignments.disciplineId, title: assignments.title, dueDate: assignments.dueDate })
        .from(assignments)
        .where(and(inArray(assignments.disciplineId, ids), gte(assignments.dueDate, today)))
        .orderBy(asc(assignments.dueDate))
    : []
  const nextByDiscipline = new Map<string, { title: string; dueDate: string }>()
  for (const d of due) {
    if (!nextByDiscipline.has(d.disciplineId)) nextByDiscipline.set(d.disciplineId, { title: d.title, dueDate: d.dueDate })
  }

  const allWorks = await worksWithPoints(studentId, ids)
  const worksByDiscipline = new Map<string, WorkItem[]>()
  for (const { disciplineId, ...work } of allWorks) {
    const list = worksByDiscipline.get(disciplineId) ?? []
    list.push(work)
    worksByDiscipline.set(disciplineId, list)
  }

  return rows.map((r) => ({
    disciplineId: r.disciplineId,
    name: r.name,
    controlKind: r.controlKind,
    semester: r.semester,
    points: r.points,
    outcome: r.outcome ?? 'pending',
    admitted: r.admitted ?? true,
    examDate: r.examDate,
    examTime: r.examTime ? r.examTime.slice(0, 5) : null,
    examRoom: r.examRoom,
    nextDue: nextByDiscipline.get(r.disciplineId) ?? null,
    works: worksByDiscipline.get(r.disciplineId) ?? [],
  }))
}

export interface DisciplineDetail extends Omit<GradeItem, 'nextDue' | 'works'> {
  assignments: WorkItem[]
  /** Различные преподаватели пар этой дисциплины у группы студента, по алфавиту. У самой дисциплины преподавателя в базе нет. */
  teachers: string[]
  /** Названия материалов курса по порядку. Файлов и ссылок нет. */
  materials: string[]
}

/** Дисциплина по номеру: условие «номер и группа из сессии» в одном запросе. Чужая — null. */
export async function getMyDiscipline(actor: Actor, disciplineId: string): Promise<DisciplineDetail | null> {
  const { studentId, groupId } = requireStudent(actor)
  if (!isUuid(disciplineId)) return null
  const db = getDb()
  const rows = await db
    .select({
      disciplineId: disciplines.id,
      name: disciplines.name,
      controlKind: disciplines.controlKind,
      semester: disciplines.semester,
      examDate: disciplines.examDate,
      examTime: disciplines.examTime,
      examRoom: disciplines.examRoom,
      points: grades.points,
      outcome: grades.outcome,
      admitted: grades.admitted,
    })
    .from(disciplines)
    .leftJoin(grades, and(eq(grades.disciplineId, disciplines.id), eq(grades.studentId, studentId)))
    .where(and(eq(disciplines.id, disciplineId), eq(disciplines.groupId, groupId)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const works = (await worksWithPoints(studentId, [row.disciplineId])).map(
    (w): WorkItem => ({ id: w.id, title: w.title, dueDate: w.dueDate, maxPoints: w.maxPoints, points: w.points }),
  )
  // Группа — из сессии, дисциплина — уже проверенная выше: преподаватели берутся только у пар этой группы.
  const teacherRows = await db
    .selectDistinct({ teacher: lessons.teacher })
    .from(lessons)
    .where(and(eq(lessons.groupId, groupId), eq(lessons.discipline, row.name)))
    .orderBy(asc(lessons.teacher))
  const materialRows = await db
    .select({ title: courseMaterials.title })
    .from(courseMaterials)
    .where(eq(courseMaterials.disciplineId, row.disciplineId))
    .orderBy(asc(courseMaterials.position))
  return {
    disciplineId: row.disciplineId,
    name: row.name,
    controlKind: row.controlKind,
    semester: row.semester,
    points: row.points,
    outcome: row.outcome ?? 'pending',
    admitted: row.admitted ?? true,
    examDate: row.examDate,
    examTime: row.examTime ? row.examTime.slice(0, 5) : null,
    examRoom: row.examRoom,
    assignments: works,
    teachers: teacherRows.map((t) => t.teacher),
    materials: materialRows.map((m) => m.title),
  }
}

export interface DueAssignment {
  id: string
  disciplineId: string
  discipline: string
  title: string
  dueDate: string
  maxPoints: number
}

/** «Что сдать»: работы дисциплин группы студента со сроком в промежутке. */
export async function listMyAssignmentsDue(actor: Actor, from: string, to: string): Promise<DueAssignment[]> {
  const { groupId } = requireStudent(actor)
  if (!assertRange(from, to)) return []
  return getDb()
    .select({
      id: assignments.id,
      disciplineId: disciplines.id,
      discipline: disciplines.name,
      title: assignments.title,
      dueDate: assignments.dueDate,
      maxPoints: assignments.maxPoints,
    })
    .from(assignments)
    .innerJoin(disciplines, eq(disciplines.id, assignments.disciplineId))
    .where(and(eq(disciplines.groupId, groupId), gte(assignments.dueDate, from), lte(assignments.dueDate, to)))
    .orderBy(asc(assignments.dueDate))
}

// ---------- Заявки ----------

export interface RequestItem {
  id: string
  kind: string
  status: string
  note: string | null
  createdAt: Date
  updatedAt: Date
  dueDate: string | null
  pickupUntil: string | null
  issuedOn: string | null
  rejectReason: string | null
  /** «Куда справка» — ключ из списка; только у справки из деканата. */
  purpose: string | null
  /** «Год оплаты»; только у справки об оплате обучения. */
  paymentYear: number | null
}

export interface RequestEventItem {
  status: string
  createdAt: Date
}

export interface RequestDetail extends RequestItem {
  /** ФИО заявителя: студент видит только свою заявку, поэтому это его собственное имя. */
  studentName: string
  events: RequestEventItem[]
}

const requestColumns = {
  id: requests.id,
  kind: requests.kind,
  status: requests.status,
  note: requests.note,
  createdAt: requests.createdAt,
  updatedAt: requests.updatedAt,
  dueDate: requests.dueDate,
  pickupUntil: requests.pickupUntil,
  issuedOn: requests.issuedOn,
  rejectReason: requests.rejectReason,
  purpose: requests.purpose,
  paymentYear: requests.paymentYear,
}

export async function listMyRequests(actor: Actor): Promise<RequestItem[]> {
  const { studentId } = requireStudent(actor)
  return getDb()
    .select(requestColumns)
    .from(requests)
    .where(eq(requests.studentId, studentId))
    .orderBy(desc(requests.createdAt))
}

/** Заявка по номеру: «номер и владелец» в одном запросе. Чужая и несуществующая — одинаково null. */
export async function getMyRequest(actor: Actor, requestId: string): Promise<RequestDetail | null> {
  const { studentId } = requireStudent(actor)
  if (!isUuid(requestId)) return null
  const db = getDb()
  const rows = await db
    .select({ ...requestColumns, studentName: students.fullName })
    .from(requests)
    .innerJoin(students, eq(students.userId, requests.studentId))
    .where(and(eq(requests.id, requestId), eq(requests.studentId, studentId)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const events = await db
    .select({ status: requestEvents.status, createdAt: requestEvents.createdAt })
    .from(requestEvents)
    .where(eq(requestEvents.requestId, row.id))
    .orderBy(asc(requestEvents.createdAt))
  return { ...row, events }
}

/** Лимит записи (ADR-0003): заявок в сутки на пару «аккаунт и адрес» и на аккаунт. Числа — выбор проекта. */
export const REQUESTS_PER_DAY_PAIR = 10
export const REQUESTS_PER_DAY_ACCOUNT = 200

/**
 * Подача заявки. Студент передаёт вид и значения полей своего вида; владелец и статус «Подана» ставит слой.
 * Поле не передано — значение по умолчанию. Передано не из списка — заявка не создаётся (null). Значение для вида,
 * у которого такого поля нет, отбрасывается. Проверка здесь, в слое, а не только на странице.
 * Адрес подачи записывается в заявку (ADR-0003, «Чистка спама»); значение «unknown» — заголовка нет.
 * Лимит записи: не больше 10 заявок в сутки на пару «аккаунт и адрес» и 200 на аккаунт. Проверка и вставка — одна
 * транзакция под замком на аккаунт, поэтому залп одновременных подач лимит не проходит. Исчерпан лимит —
 * `RequestLimitError`, заявка не создаётся.
 */
export async function createMyRequest(
  actor: Actor,
  input: { kind: RequestKind; purpose?: string | null; paymentYear?: number | string | null },
  ip: string,
): Promise<{ id: string } | null> {
  const { studentId } = requireStudent(actor)
  if (!isRequestKind(input.kind)) return null
  const fields = normalizeFields(input.kind, input, currentYearIn(getConfig().timezone))
  if (!fields) return null
  const safeIp = normalizeIp(ip).slice(0, 64) || 'unknown'
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`requests:${studentId}`}, 0))`)
    const counted = await tx.execute(sql`
      select count(*) filter (where ip = ${safeIp})::int as pair, count(*)::int as account
      from requests where student_id = ${studentId} and created_at > clock_timestamp() - interval '1 day'
    `)
    const pair = Number(counted.rows[0]?.pair ?? 0)
    const account = Number(counted.rows[0]?.account ?? 0)
    if (pair >= REQUESTS_PER_DAY_PAIR) throw new RequestLimitError('pair')
    if (account >= REQUESTS_PER_DAY_ACCOUNT) throw new RequestLimitError('account')
    const inserted = await tx
      .insert(requests)
      .values({
        studentId,
        kind: input.kind,
        status: 'submitted',
        ip: safeIp,
        purpose: fields.purpose,
        paymentYear: fields.paymentYear,
      })
      .returning({ id: requests.id })
    const created = inserted[0]
    if (!created) return null
    await tx.insert(requestEvents).values({ requestId: created.id, status: 'submitted', byUserId: studentId, ip: safeIp })
    return { id: created.id }
  })
}

/**
 * Справка об обучении «Получить сразу»: своя заявка `dean_certificate` с назначением «По месту требования» сразу в статусе
 * «Выдана»: документ у студента на экране, забирать в деканате нечего. История — «Подана», «Готова», «Выдана», одной
 * транзакцией. Владелец — из сессии. Лимит записи тот же, что у подачи. Секрет и код проверки — забота вызывающего:
 * слой их не знает.
 */
export async function createMyReadyCertificate(actor: Actor, ip: string): Promise<{ id: string } | null> {
  const { studentId } = requireStudent(actor)
  const safeIp = normalizeIp(ip).slice(0, 64) || 'unknown'
  const today = todayIn(getConfig().timezone)
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`requests:${studentId}`}, 0))`)
    const counted = await tx.execute(sql`
      select count(*) filter (where ip = ${safeIp})::int as pair, count(*)::int as account
      from requests where student_id = ${studentId} and created_at > clock_timestamp() - interval '1 day'
    `)
    const pair = Number(counted.rows[0]?.pair ?? 0)
    const account = Number(counted.rows[0]?.account ?? 0)
    if (pair >= REQUESTS_PER_DAY_PAIR) throw new RequestLimitError('pair')
    if (account >= REQUESTS_PER_DAY_ACCOUNT) throw new RequestLimitError('account')
    const inserted = await tx
      .insert(requests)
      .values({
        studentId,
        kind: 'dean_certificate',
        status: 'issued',
        ip: safeIp,
        purpose: 'on_demand',
        paymentYear: null,
        dueDate: today,
        issuedOn: today,
      })
      .returning({ id: requests.id })
    const created = inserted[0]
    if (!created) return null
    await tx.insert(requestEvents).values({ requestId: created.id, status: 'submitted', byUserId: studentId, ip: safeIp })
    await tx
      .insert(requestEvents)
      .values({ requestId: created.id, status: 'ready', byUserId: studentId, ip: safeIp, createdAt: sql`clock_timestamp()` })
    await tx
      .insert(requestEvents)
      .values({ requestId: created.id, status: 'issued', byUserId: studentId, ip: safeIp, createdAt: sql`clock_timestamp()` })
    return { id: created.id }
  })
}

/** Что публичная страница проверки вправе показать о справке: ничего сверх этих полей. */
export interface CertificateCheck {
  kind: string
  fullName: string
  course: number
  groupName: string
  /** Момент, когда справка стала готова. */
  issuedAt: Date
}

/**
 * Публичное чтение для `/verify` — единственная функция слоя без действующего лица. Вызывается только после успешной проверки
 * подписи кода (`verifyCertificateCode`): номер приходит из подписанного кода, не из запроса посетителя. Отдаёт только
 * справку из деканата в статусе «Готова» или «Выдана»; номер заявки, адрес, примечание и прочее наружу не идут.
 */
export async function getCertificateForVerification(requestId: string): Promise<CertificateCheck | null> {
  if (!isUuid(requestId)) return null
  const db = getDb()
  const rows = await db
    .select({ kind: requests.kind, fullName: students.fullName, course: students.course, groupName: groups.name })
    .from(requests)
    .innerJoin(students, eq(students.userId, requests.studentId))
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(and(eq(requests.id, requestId), eq(requests.kind, 'dean_certificate'), inArray(requests.status, ['ready', 'issued'])))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const ready = await db
    .select({ at: requestEvents.createdAt })
    .from(requestEvents)
    .where(and(eq(requestEvents.requestId, requestId), eq(requestEvents.status, 'ready')))
    .orderBy(asc(requestEvents.createdAt))
    .limit(1)
  const issuedAt = ready[0]?.at
  if (!issuedAt) return null
  return { ...row, issuedAt }
}

// ---------- Вопросы в деканат (пакет 4.1) ----------

/** Вопрос студента. Адреса подачи и ответа наружу не отдаются; кто из сотрудников ответил — тоже. */
export interface QuestionItem {
  id: string
  topic: string
  status: string
  createdAt: Date
  /** Время ответа деканата; пусто, пока вопрос в статусе «Отправлен». */
  answeredAt: Date | null
}

export interface QuestionDetail extends QuestionItem {
  body: string
  /** Ответ деканата: пуст, пока вопрос в статусе «Отправлен». */
  answer: string | null
}

/** Свои вопросы, новые сверху. Владелец — из сессии. */
export async function listMyQuestions(actor: Actor): Promise<QuestionItem[]> {
  const { studentId } = requireStudent(actor)
  return getDb()
    .select({ id: questions.id, topic: questions.topic, status: questions.status, createdAt: questions.createdAt, answeredAt: questions.answeredAt })
    .from(questions)
    .where(eq(questions.studentId, studentId))
    .orderBy(desc(questions.createdAt))
}

/** Вопрос по номеру: «номер и владелец» в одном запросе. Чужой и несуществующий — одинаково null. */
export async function getMyQuestion(actor: Actor, questionId: string): Promise<QuestionDetail | null> {
  const { studentId } = requireStudent(actor)
  if (!isUuid(questionId)) return null
  const rows = await getDb()
    .select({
      id: questions.id,
      topic: questions.topic,
      status: questions.status,
      createdAt: questions.createdAt,
      body: questions.body,
      answer: questions.answer,
      answeredAt: questions.answeredAt,
    })
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.studentId, studentId)))
    .limit(1)
  return rows[0] ?? null
}

/** Лимит записи (ADR-0003): вопросов в сутки на пару «аккаунт и адрес» и на аккаунт. Числа — как у заявок. */
export const QUESTIONS_PER_DAY_PAIR = 10
export const QUESTIONS_PER_DAY_ACCOUNT = 200

/**
 * Вопрос в деканат. Студент передаёт тему и текст; владельца и статус «Отправлен» ставит слой. Тема не из списка, текст
 * пустой после обрезки пробелов или длиннее 1000 знаков — вопрос не создаётся (null). Проверка здесь, в слое, а не только
 * в форме. Адрес подачи записывается в вопрос; значение «unknown» — заголовка нет.
 * Предел — как у заявок: не больше 10 вопросов в сутки на пару «аккаунт и адрес» и 200 на аккаунт. Проверка и вставка — одна
 * транзакция под замком на аккаунт. Исчерпан предел — `RequestLimitError`, вопрос не создаётся.
 */
export async function createMyQuestion(
  actor: Actor,
  input: { topic: QuestionTopic | string; text: string },
  ip: string,
): Promise<{ id: string } | null> {
  const { studentId } = requireStudent(actor)
  if (!isQuestionTopic(input?.topic)) return null
  const text = normalizeQuestionText(input.text)
  if (text === null) return null
  const safeIp = normalizeIp(ip).slice(0, 64) || 'unknown'
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`questions:${studentId}`}, 0))`)
    const counted = await tx.execute(sql`
      select count(*) filter (where ip = ${safeIp})::int as pair, count(*)::int as account
      from questions where student_id = ${studentId} and created_at > clock_timestamp() - interval '1 day'
    `)
    const pair = Number(counted.rows[0]?.pair ?? 0)
    const account = Number(counted.rows[0]?.account ?? 0)
    if (pair >= QUESTIONS_PER_DAY_PAIR) throw new RequestLimitError('pair')
    if (account >= QUESTIONS_PER_DAY_ACCOUNT) throw new RequestLimitError('account')
    const inserted = await tx
      .insert(questions)
      .values({ studentId, topic: input.topic, body: text, status: 'sent', ip: safeIp })
      .returning({ id: questions.id })
    return inserted[0] ? { id: inserted[0].id } : null
  })
}

// ---------- Уведомления и объявления ----------

export interface NotificationItem {
  id: string
  kind: string
  title: string
  body: string
  link: string | null
  createdAt: Date
  read: boolean
}

/** Факультет студента — из профиля. Нет профиля — null: объявлений для него нет (как в `listMyUnreadAnnouncements`). */
async function facultyOf(studentId: string): Promise<string | null> {
  const profile = await getDb().select({ faculty: students.faculty }).from(students).where(eq(students.userId, studentId)).limit(1)
  return profile[0]?.faculty ?? null
}

/** Объявления, адресованные группе или факультету студента. */
function addressedTo(groupId: string, faculty: string) {
  return sql`(${announcements.groupId} = ${groupId} or ${announcements.faculty} = ${faculty})`
}

/**
 * Число непрочитанного: личные уведомления плюс объявления группы или факультета, которых студент не отмечал.
 * Число у колокольчика и строка «Непрочитанных: N» на экране берутся отсюда: один счёт.
 */
export async function countMyUnreadNotifications(actor: Actor): Promise<number> {
  const { studentId, groupId } = requireStudent(actor)
  const db = getDb()
  const own = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.studentId, studentId), isNull(notifications.readAt)))
  const faculty = await facultyOf(studentId)
  if (!faculty) return own[0]?.n ?? 0
  const board = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(announcements)
    .leftJoin(
      announcementReads,
      and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.studentId, studentId)),
    )
    .where(and(isNull(announcementReads.announcementId), addressedTo(groupId, faculty)))
  return (own[0]?.n ?? 0) + (board[0]?.n ?? 0)
}

export async function listMyNotifications(actor: Actor): Promise<NotificationItem[]> {
  const { studentId } = requireStudent(actor)
  const rows = await getDb()
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(eq(notifications.studentId, studentId))
    .orderBy(desc(notifications.createdAt))
    .limit(100)
  return rows.map(({ readAt, ...rest }) => ({ ...rest, read: readAt !== null }))
}

export interface AnnouncementItem {
  id: string
  title: string
  body: string
  publishedAt: Date
}

/** Непрочитанные объявления группы или факультета студента. Группа и факультет — из профиля. */
export async function listMyUnreadAnnouncements(actor: Actor): Promise<AnnouncementItem[]> {
  const { studentId, groupId } = requireStudent(actor)
  const db = getDb()
  const profile = await db
    .select({ faculty: students.faculty })
    .from(students)
    .where(eq(students.userId, studentId))
    .limit(1)
  const faculty = profile[0]?.faculty
  if (!faculty) return []
  return db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      publishedAt: announcements.publishedAt,
    })
    .from(announcements)
    .leftJoin(
      announcementReads,
      and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.studentId, studentId)),
    )
    .where(
      and(
        isNull(announcementReads.announcementId),
        sql`(${announcements.groupId} = ${groupId} or ${announcements.faculty} = ${faculty})`,
      ),
    )
    .orderBy(desc(announcements.publishedAt))
}

// Единая лента: личные уведомления и объявления группы или факультета (пакет 3.5, ЯД-5).

export type FeedSource = 'notification' | 'announcement'
/** Лента фильтра: `reminder` — «Напоминания»; `news` — «Новости и объявления». */
export type FeedKind = 'reminder' | 'news'

export interface FeedItem {
  source: FeedSource
  id: string
  feed: FeedKind
  title: string
  body: string
  /** У объявления ссылки нет. */
  link: string | null
  at: Date
  read: boolean
}

const FEED_LIMIT = 100

/** Личные уведомления и объявления своей группы или факультета одним списком по времени, новые сверху, не больше 100. */
export async function listMyFeed(actor: Actor): Promise<FeedItem[]> {
  const { studentId, groupId } = requireStudent(actor)
  const db = getDb()
  const own = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      at: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(eq(notifications.studentId, studentId))
    .orderBy(desc(notifications.createdAt))
    .limit(FEED_LIMIT)
  const items: FeedItem[] = own.map((n) => ({
    source: 'notification',
    id: n.id,
    feed: n.kind === 'news' ? 'news' : 'reminder',
    title: n.title,
    body: n.body,
    link: n.link,
    at: n.at,
    read: n.readAt !== null,
  }))
  const faculty = await facultyOf(studentId)
  if (faculty) {
    const board = await db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        at: announcements.publishedAt,
        readId: announcementReads.announcementId,
      })
      .from(announcements)
      .leftJoin(
        announcementReads,
        and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.studentId, studentId)),
      )
      .where(addressedTo(groupId, faculty))
      .orderBy(desc(announcements.publishedAt))
      .limit(FEED_LIMIT)
    for (const a of board) {
      items.push({ source: 'announcement', id: a.id, feed: 'news', title: a.title, body: a.body, link: null, at: a.at, read: a.readId !== null })
    }
  }
  items.sort((x, y) => y.at.getTime() - x.at.getTime())
  return items.slice(0, FEED_LIMIT)
}

export interface FeedItemMark {
  /** Запись есть в ленте этого студента. `false` — чужая, несуществующая или мусор в форме: действие пишет отказ (R-3.5-5). */
  found: boolean
  /** Ссылка своего уведомления из базы; у объявления и у уведомления без ссылки — `null`. */
  link: string | null
}

const NOT_FOUND: FeedItemMark = { found: false, link: null }

/**
 * Отметить одну запись ленты прочитанной. Уведомление: `read_at` ставится строке с этим номером и этим студентом.
 * Объявление: отметка вставляется, только если оно адресовано группе или факультету студента; повтор — не ошибка.
 * Своя запись — `{ found: true, link }`. Чужая, несуществующая запись и мусор вместо номера дают один ответ
 * `{ found: false, link: null }` и ничего не меняют.
 */
export async function markMyFeedItemRead(actor: Actor, source: unknown, id: unknown): Promise<FeedItemMark> {
  const { studentId, groupId } = requireStudent(actor)
  if (!isUuid(id)) return NOT_FOUND
  const db = getDb()
  if (source === 'notification') {
    const rows = await db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(eq(notifications.id, id), eq(notifications.studentId, studentId)))
      .returning({ link: notifications.link })
    return rows[0] ? { found: true, link: rows[0].link ?? null } : NOT_FOUND
  }
  if (source === 'announcement') {
    const faculty = await facultyOf(studentId)
    if (!faculty) return NOT_FOUND
    const addressed = await db
      .select({ id: announcements.id })
      .from(announcements)
      .where(and(eq(announcements.id, id), addressedTo(groupId, faculty)))
      .limit(1)
    if (!addressed[0]) return NOT_FOUND
    await db.insert(announcementReads).values({ announcementId: id, studentId }).onConflictDoNothing()
    return { found: true, link: null }
  }
  return NOT_FOUND
}

/** Отметить всё непрочитанное этого студента — личные уведомления и объявления его группы или факультета — одной транзакцией. */
export async function markAllMyFeedRead(actor: Actor): Promise<void> {
  const { studentId, groupId } = requireStudent(actor)
  const faculty = await facultyOf(studentId)
  await getDb().transaction(async (tx) => {
    await tx
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(eq(notifications.studentId, studentId), isNull(notifications.readAt)))
    if (!faculty) return
    const unread = await tx
      .select({ id: announcements.id })
      .from(announcements)
      .leftJoin(
        announcementReads,
        and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.studentId, studentId)),
      )
      .where(and(isNull(announcementReads.announcementId), addressedTo(groupId, faculty)))
    if (unread.length > 0) {
      await tx
        .insert(announcementReads)
        .values(unread.map((a) => ({ announcementId: a.id, studentId })))
        .onConflictDoNothing()
    }
  })
}

// ---------- Фото профиля и студенческий билет (20.11, блиц) ----------

/** Есть ли у студента фото. Владелец — из сессии. */
export async function hasMyAvatar(actor: Actor): Promise<boolean> {
  const { studentId } = requireStudent(actor)
  const rows = await getDb().select({ userId: userAvatars.userId }).from(userAvatars).where(eq(userAvatars.userId, studentId)).limit(1)
  return rows.length > 0
}

/** Своё фото целиком: для маршрута `/profile/avatar`. Чужого фото запросить нельзя: номера в параметрах нет. */
export async function getMyAvatar(actor: Actor): Promise<{ mime: AvatarMime; data: Buffer } | null> {
  const { studentId } = requireStudent(actor)
  const rows = await getDb()
    .select({ mime: userAvatars.mime, data: userAvatars.data })
    .from(userAvatars)
    .where(eq(userAvatars.userId, studentId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { mime: row.mime as AvatarMime, data: row.data }
}

/**
 * Сохраняет своё фото (заменяет прежнее). Проверка — здесь, в слое, а не только в действии: пустой файл, больше 150 КБ,
 * тип не из списка или чужая сигнатура — отказ, в базу ничего не идёт. Тип в базу записывается по сигнатуре.
 */
export async function setMyAvatar(actor: Actor, bytes: Uint8Array, declaredType: string): Promise<AvatarCheck> {
  const { studentId } = requireStudent(actor)
  const checked = checkAvatar(bytes, declaredType)
  if (!checked.ok) return checked
  const data = Buffer.from(bytes)
  await getDb()
    .insert(userAvatars)
    .values({ userId: studentId, mime: checked.mime, data })
    .onConflictDoUpdate({ target: userAvatars.userId, set: { mime: checked.mime, data, updatedAt: sql`now()` } })
  return checked
}

/** Удаляет своё фото. Нет фото — ничего не происходит. */
export async function deleteMyAvatar(actor: Actor): Promise<void> {
  const { studentId } = requireStudent(actor)
  await getDb().delete(userAvatars).where(eq(userAvatars.userId, studentId))
}

/** Что публичная страница проверки билета вправе показать: ничего сверх этих полей. */
export interface StudentTicketCheck {
  fullName: string
  course: number
  groupName: string
}

/**
 * Публичное чтение для `/verify/student/<код>` — вторая функция слоя без действующего лица, после `getCertificateForVerification`.
 * Вызывается только после успешной проверки подписи кода (`verifyStudentTicketCode`): номер приходит из подписанного кода,
 * не из запроса посетителя. Нет такого студента — null. Логин, набор, факультет и фото наружу не идут.
 */
export async function getStudentForTicketVerification(studentId: string): Promise<StudentTicketCheck | null> {
  if (!isUuid(studentId)) return null
  const rows = await getDb()
    .select({ fullName: students.fullName, course: students.course, groupName: groups.name })
    .from(students)
    .innerJoin(groups, eq(groups.id, students.groupId))
    .where(eq(students.userId, studentId))
    .limit(1)
  return rows[0] ?? null
}

// ---------- Рейтинг в группе (20.11, поддержка и рейтинг) ----------

/** Рейтинг студента в своей группе за семестр. Наружу — только свои значения, место и размер группы. */
export interface GroupRating {
  /**
   * Семестр, по которому считан рейтинг: текущий семестр группы (наибольший `disciplines.semester`), а если итоговых оценок
   * по нему у группы ещё нет — последний семестр, где они есть. Экран подписывает его: «За 4 семестр».
   */
  semester: number
  /** Среднее арифметическое итоговых оценок 2–5 студента за семестр (по выставленным). */
  average: number
  /** Место в группе: 1 + число студентов с более высоким средним. Равные средние — одно место (1, 2, 2, 4). */
  place: number
  /** Сколько студентов в группе (все, в том числе пока без оценок: они ниже в списке). */
  groupSize: number
}

/**
 * Рейтинг студента в группе: один запрос. Студент и группа — из сессии. Считаются итоговые оценки '2'–'5' по дисциплинам
 * группы за один семестр: текущий (наибольший у группы), а если в нём у группы нет ни одной итоговой оценки (сессия впереди) —
 * последний семестр, где они есть (20.11, решение участника А: в демо рейтинг виден). Зачёты и «ещё нет итога» не входят. Средние сравниваются без округления:
 * `сумма_a * число_b` против `сумма_b * число_a`, поэтому равенство точное и дробей с плавающей точкой нет.
 * Чужие баллы из запроса наружу не выходят: приложение получает только число студентов, место и свои сумму и счёт.
 * Нет ни одной итоговой оценки у студента в этом семестре (или нет дисциплин) — null: «Рейтинг появится после первых итоговых оценок».
 */
export async function getMyRating(actor: Actor): Promise<GroupRating | null> {
  const { studentId, groupId } = requireStudent(actor)
  const result = await getDb().execute<{ semester: number | null; total: number; n: number; higher: number; size: number }>(sql`
    with cur as (
      select max(d.semester) as semester
      from disciplines d
      where d.group_id = ${groupId}
        and exists (select 1 from grades gr where gr.discipline_id = d.id and gr.outcome in ('2', '3', '4', '5'))
    ),
    per_student as (
      select s.user_id as student_id,
             coalesce(sum(case when g.outcome in ('2', '3', '4', '5') then g.outcome::int end), 0)::int as total,
             count(case when g.outcome in ('2', '3', '4', '5') then 1 end)::int as n
      from students s
      left join grades g
        on g.student_id = s.user_id
       and g.discipline_id in (
         select d.id from disciplines d, cur where d.group_id = ${groupId} and d.semester = cur.semester
       )
      where s.group_id = ${groupId}
      group by s.user_id
    )
    select (select semester from cur)::int as semester,
           me.total,
           me.n,
           (select count(*) from per_student o where me.n > 0 and o.n > 0 and o.total * me.n > me.total * o.n)::int as higher,
           (select count(*) from per_student)::int as size
    from per_student me
    where me.student_id = ${studentId}
  `)
  const row = result.rows[0]
  if (!row || row.semester === null || Number(row.n) === 0) return null
  const n = Number(row.n)
  return { semester: Number(row.semester), average: Number(row.total) / n, place: Number(row.higher) + 1, groupSize: Number(row.size) }
}
