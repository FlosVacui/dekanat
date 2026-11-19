// Вопросы в деканат (пакет 4.1, ADR-0002, ADR-0003): слой студента и слой сотрудника, пределы записи, один ответ,
// уведомление об ответе, освежение набора. База — тестовая. Всё, что тесты создали, в конце удаляется:
// следующие файлы работают с теми же аккаунтами.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { seedCohort } from '../../db/seed-lib'
import { buildCohortPlan } from '../../db/seed-plan'
import { QUESTION_MAX_LENGTH, QUESTION_STATUSES, QUESTION_TOPICS, QUESTION_TOPIC_LABELS, topicLabel } from '@/lib/questions'
import { todayIn } from '@/lib/dates'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { ALT_COHORT, ALT_STUDENT, STAFF_ALT, STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor, freshIp, withOwner } from './helpers'

let a: Actor
let b: Actor
let altStudent: Actor
let staff: Actor
let altStaff: Actor
/** Номера вопросов, которые создали тесты: в конце они удаляются вместе с уведомлениями о них. */
const created: string[] = []
const today = todayIn('Europe/Moscow')

beforeAll(async () => {
  ;[a, b, altStudent, staff, altStaff] = await Promise.all([
    actorFor(STUDENT_A),
    actorFor(STUDENT_B),
    actorFor(ALT_STUDENT),
    actorFor(STAFF_MAIN),
    actorFor(STAFF_ALT),
  ])
})

afterAll(async () => {
  await withOwner(async (c) => {
    await c.query(`delete from notifications where link = any($1)`, [created.map((id) => `/questions/${id}`)])
    await c.query(`delete from questions where id = any($1::uuid[]) or ip like 'bulk-q%' or ip = 'visitor'`, [created])
  })
  await closeDb()
})

async function ask(owner: Actor, text = 'Когда можно получить справку?', topic: string = 'documents', ip: string = freshIp()): Promise<string> {
  const made = await studentDal.createMyQuestion(owner, { topic, text }, ip)
  if (!made) throw new Error('вопрос не создан')
  created.push(made.id)
  return made.id
}

async function questionCount(): Promise<number> {
  const res = await withOwner((c) => c.query('select count(*)::int as n from questions'))
  return res.rows[0].n as number
}

describe('темы и ограничения базы', () => {
  it('список тем в ограничении базы — ровно QUESTION_TOPICS из кода; у каждой темы своя подпись', async () => {
    const res = await withOwner((c) => c.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'questions_topic_check'`))
    const inDb = [...String(res.rows[0]?.def).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
    expect(inDb.length).toBeGreaterThan(0)
    expect(inDb.sort()).toEqual([...QUESTION_TOPICS].sort())
    expect(QUESTION_TOPICS).toHaveLength(5)
    expect(new Set(QUESTION_TOPICS.map((t) => QUESTION_TOPIC_LABELS[t])).size).toBe(5)
    expect(QUESTION_TOPICS.map((t) => QUESTION_TOPIC_LABELS[t])).toEqual([
      'Расписание и занятия',
      'Пересдачи и долги',
      'Справки и документы',
      'Стипендия и оплата',
      'Другое',
    ])
  })

  it('статусы в ограничении базы — ровно QUESTION_STATUSES; предел длины в базе — QUESTION_MAX_LENGTH', async () => {
    const status = await withOwner((c) => c.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'questions_status_check'`))
    const inDb = [...String(status.rows[0]?.def).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
    expect(inDb.sort()).toEqual([...QUESTION_STATUSES].sort())
    for (const name of ['questions_body_check', 'questions_answer_check']) {
      const res = await withOwner((c) => c.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1`, [name]))
      expect(String(res.rows[0]?.def), name).toContain(`${QUESTION_MAX_LENGTH}`)
    }
  })

  it('база сама отказывает: тема не из списка, пустой и длинный текст, ответ у отправленного, отвеченный без ответа', async () => {
    const insert = (topic: string, body: string, status = 'sent', answer: string | null = null, answeredAt: string | null = null) =>
      withOwner((c) =>
        c.query(
          `insert into questions (student_id, topic, body, status, answer, answered_at, ip)
           select u.id, $2, $3, $4, $5, $6::timestamptz, 'bulk-q-check' from users u where u.login = $1`,
          [STUDENT_A.login, topic, body, status, answer, answeredAt],
        ),
      )
    const before = await questionCount()
    await expect(insert('выдуманная', 'текст')).rejects.toThrow()
    await expect(insert('other', '')).rejects.toThrow()
    await expect(insert('other', '   ')).rejects.toThrow()
    await expect(insert('other', 'я'.repeat(QUESTION_MAX_LENGTH + 1))).rejects.toThrow()
    await expect(insert('other', 'текст', 'sent', 'ответ', null)).rejects.toThrow()
    await expect(insert('other', 'текст', 'answered', null, null)).rejects.toThrow()
    await expect(insert('other', 'текст', 'answered', 'ответ', null)).rejects.toThrow()
    await expect(insert('other', 'текст', 'выдуманный')).rejects.toThrow()
    expect(await questionCount(), 'ничего не создано').toBe(before)
    await insert('other', 'я'.repeat(QUESTION_MAX_LENGTH))
    await withOwner((c) => c.query(`delete from questions where ip = 'bulk-q-check'`))
  })
})

describe('слой студента: свой вопрос, чужой — null', () => {
  it('вопрос создаётся с владельцем из сессии; наружу не отдаются адреса и сотрудник', async () => {
    const id = await ask(a, '  Здравствуйте!\r\nКогда справка?  ', 'resits')
    const mine = await studentDal.getMyQuestion(a, id)
    expect(mine).not.toBeNull()
    expect(mine!.body, 'края обрезаны, переводы строк — \\n').toBe('Здравствуйте!\nКогда справка?')
    expect(mine!.topic).toBe('resits')
    expect(mine!.status).toBe('sent')
    expect(mine!.answer).toBeNull()
    expect(Object.keys(mine!).sort()).toEqual(['answer', 'answeredAt', 'body', 'createdAt', 'id', 'status', 'topic'])
    const row = await withOwner((c) => c.query('select student_id, ip, status from questions where id = $1', [id]))
    expect(row.rows[0].student_id).toBe(a.userId)
    expect(row.rows[0].status).toBe('sent')
    expect((await studentDal.listMyQuestions(a)).some((q) => q.id === id)).toBe(true)
    for (const item of await studentDal.listMyQuestions(a)) expect(Object.keys(item).sort()).toEqual(['answeredAt', 'createdAt', 'id', 'status', 'topic'])
  })

  it('чужой и несуществующий вопрос — одинаково null; в списке чужого нет', async () => {
    const id = await ask(a)
    expect(await studentDal.getMyQuestion(b, id)).toBeNull()
    expect(await studentDal.getMyQuestion(altStudent, id)).toBeNull()
    expect(await studentDal.getMyQuestion(b, '00000000-0000-4000-8000-000000000000')).toBeNull()
    expect(await studentDal.getMyQuestion(b, 'не-номер')).toBeNull()
    expect((await studentDal.listMyQuestions(b)).some((q) => q.id === id)).toBe(false)
    await expect(studentDal.getMyQuestion(staff, id)).rejects.toMatchObject({ name: 'ForbiddenError' })
    await expect(studentDal.createMyQuestion(staff, { topic: 'other', text: 'текст' }, freshIp())).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('тема не из списка, пустой, из пробелов, длинный, с нулевым знаком или не строка — вопрос не создаётся', async () => {
    const before = await questionCount()
    const ip = freshIp()
    expect(await studentDal.createMyQuestion(a, { topic: 'выдуманная', text: 'текст' }, ip)).toBeNull()
    expect(await studentDal.createMyQuestion(a, { topic: 'other', text: '' }, ip)).toBeNull()
    expect(await studentDal.createMyQuestion(a, { topic: 'other', text: ' \n\t ' }, ip)).toBeNull()
    expect(await studentDal.createMyQuestion(a, { topic: 'other', text: 'я'.repeat(QUESTION_MAX_LENGTH + 1) }, ip)).toBeNull()
    expect(await studentDal.createMyQuestion(a, { topic: 'other', text: 'до\u0000после' }, ip)).toBeNull()
    expect(await studentDal.createMyQuestion(a, { topic: 'other', text: 42 as unknown as string }, ip)).toBeNull()
    expect(await studentDal.createMyQuestion(a, { topic: undefined as unknown as string, text: 'текст' }, ip)).toBeNull()
    expect(await questionCount(), 'ничего не создано').toBe(before)
    // Ровно 1000 знаков — проходит; считаются знаки, а не байты и не половинки пар.
    expect(await ask(a, 'я'.repeat(QUESTION_MAX_LENGTH))).toBeTruthy()
    expect(await ask(a, '😀'.repeat(QUESTION_MAX_LENGTH))).toBeTruthy()
    expect(await studentDal.createMyQuestion(a, { topic: 'other', text: '😀'.repeat(QUESTION_MAX_LENGTH + 1) }, ip)).toBeNull()
  })

  it('текст с разметкой хранится как есть: слой ничего не вырезает и не разбирает', async () => {
    const text = '<script>alert(1)</script> <b>жирный</b>'
    const id = await ask(a, text)
    expect((await studentDal.getMyQuestion(a, id))!.body).toBe(text)
  })
})

describe('предел записи: 10 вопросов в сутки на пару «аккаунт и адрес», 200 на аккаунт', () => {
  it('11-й вопрос за сутки с одного адреса — отказ «pair»; с другого адреса проходит; старше суток не считаются', async () => {
    const x = freshIp()
    const y = freshIp()
    for (let i = 0; i < 10; i += 1) await ask(b, 'вопрос', 'other', x)
    await expect(studentDal.createMyQuestion(b, { topic: 'other', text: 'ещё' }, x)).rejects.toMatchObject({ name: 'RequestLimitError', scope: 'pair' })
    const n = await withOwner((c) => c.query('select count(*)::int as n from questions where ip = $1', [x]))
    expect(n.rows[0].n, 'отказанный вопрос не создан').toBe(10)
    expect(await studentDal.createMyQuestion(b, { topic: 'other', text: 'с другого адреса' }, y)).not.toBeNull()
    await withOwner((c) => c.query(`update questions set created_at = now() - interval '25 hours' where ip = $1`, [x]))
    expect(await studentDal.createMyQuestion(b, { topic: 'other', text: 'после суток' }, x)).not.toBeNull()
  })

  it('20 одновременных вопросов с одного адреса дают не больше 10', async () => {
    const x = freshIp()
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => studentDal.createMyQuestion(a, { topic: 'other', text: 'залп' }, x)))
    expect(results.filter((r) => r.status === 'fulfilled' && r.value !== null)).toHaveLength(10)
    expect(results.filter((r) => r.status === 'rejected' && (r.reason as Error).name === 'RequestLimitError')).toHaveLength(10)
  })

  it('200 вопросов в сутки на аккаунт: с любого адреса — отказ «account»; другой аккаунт не страдает', async () => {
    await withOwner((c) =>
      c.query(
        `insert into questions (student_id, topic, body, ip)
         select u.id, 'other', 'bulk', 'bulk-q-' || g
         from users u, generate_series(1, 200 - (select count(*) from questions q where q.student_id = u.id and q.created_at > now() - interval '1 day')) g
         where u.login = $1`,
        [STUDENT_B.login],
      ),
    )
    try {
      await expect(studentDal.createMyQuestion(b, { topic: 'other', text: 'лишний' }, freshIp())).rejects.toMatchObject({ scope: 'account' })
      expect(await studentDal.createMyQuestion(a, { topic: 'other', text: 'у другого аккаунта' }, freshIp())).not.toBeNull()
    } finally {
      // Заполнение до 200 мешало бы следующим проверкам этого файла, где вопросы задаёт тот же студент.
      await withOwner((c) => c.query(`delete from questions where ip like 'bulk-q-%' and ip <> 'bulk-q-answers'`))
    }
  })
})

describe('слой сотрудника: свой набор, один ответ, уведомление', () => {
  it('сотрудник видит вопросы своего набора; другой набор не видит их и не может ответить', async () => {
    const id = await ask(a, 'Вопрос для набора')
    const altId = await ask(altStudent, 'Вопрос второго набора')
    const mine = await staffDal.listCohortQuestions(staff)
    expect(mine.some((q) => q.id === id)).toBe(true)
    expect(mine.some((q) => q.id === altId)).toBe(false)
    const theirs = await staffDal.listCohortQuestions(altStaff)
    expect(theirs.some((q) => q.id === altId)).toBe(true)
    expect(theirs.some((q) => q.id === id)).toBe(false)

    const detail = await staffDal.getCohortQuestion(staff, id)
    expect(detail).toMatchObject({ id, status: 'sent', body: 'Вопрос для набора', studentName: STUDENT_A.fullName })
    expect(await staffDal.getCohortQuestion(altStaff, id)).toBeNull()
    expect(await staffDal.getCohortQuestion(staff, altId)).toBeNull()
    expect(await staffDal.getCohortQuestion(staff, 'не-номер')).toBeNull()

    expect(await staffDal.answerQuestion(altStaff, id, 'Чужой ответ', freshIp())).toEqual({ ok: false, reason: 'not_found' })
    expect(await staffDal.answerQuestion(staff, altId, 'Чужой ответ', freshIp())).toEqual({ ok: false, reason: 'not_found' })
    const row = await withOwner((c) => c.query('select status, answer from questions where id = any($1::uuid[]) order by id', [[id, altId]]))
    expect(row.rows.every((r) => r.status === 'sent' && r.answer === null), 'вопросы остались без ответа').toBe(true)
    const notes = await withOwner((c) => c.query('select count(*)::int as n from notifications where link = any($1)', [[`/questions/${id}`, `/questions/${altId}`]]))
    expect(notes.rows[0].n, 'уведомлений нет').toBe(0)
    await expect(staffDal.listCohortQuestions(a)).rejects.toMatchObject({ name: 'ForbiddenError' })
    await expect(staffDal.answerQuestion(a, id, 'ответ студента', freshIp())).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('ответ — один раз; уведомление создаётся ровно одно и ведёт на вопрос; студент видит ответ', async () => {
    const id = await ask(a, 'Нужна справка', 'documents')
    const ip = freshIp()
    expect(await staffDal.answerQuestion(staff, id, '  Справка готова через три дня  ', ip)).toEqual({ ok: true })
    expect(await staffDal.answerQuestion(staff, id, 'Второй ответ', ip)).toEqual({ ok: false, reason: 'already_answered' })
    expect(await staffDal.answerQuestion(staff, id, 'Третий ответ', freshIp())).toEqual({ ok: false, reason: 'already_answered' })

    const mine = await studentDal.getMyQuestion(a, id)
    expect(mine).toMatchObject({ status: 'answered', answer: 'Справка готова через три дня' })
    expect(mine!.answeredAt).toBeInstanceOf(Date)
    const row = await withOwner((c) => c.query('select answered_by, answer_ip from questions where id = $1', [id]))
    expect(row.rows[0].answered_by).toBe(staff.userId)
    expect(row.rows[0].answer_ip).toBe(ip)

    const notes = await withOwner((c) =>
      c.query('select student_id, kind, title, body, link, read_at from notifications where link = $1', [`/questions/${id}`]),
    )
    expect(notes.rows).toHaveLength(1)
    expect(notes.rows[0]).toMatchObject({
      student_id: a.userId,
      kind: 'reminder',
      title: 'Деканат ответил на вопрос',
      body: topicLabel('documents'),
      link: `/questions/${id}`,
      read_at: null,
    })
    expect((await staffDal.getCohortQuestion(staff, id))!.answer).toBe('Справка готова через три дня')
  })

  it('пустой, из пробелов и длинный ответ — отказ без изменений; несуществующий номер — «нет такой записи»', async () => {
    const id = await ask(a)
    for (const text of ['', '   ', 'я'.repeat(QUESTION_MAX_LENGTH + 1), 'до\u0000после']) {
      expect(await staffDal.answerQuestion(staff, id, text, freshIp())).toEqual({ ok: false, reason: 'invalid_input' })
    }
    expect((await studentDal.getMyQuestion(a, id))!.status).toBe('sent')
    expect(await staffDal.answerQuestion(staff, '00000000-0000-4000-8000-000000000000', 'ответ', freshIp())).toEqual({ ok: false, reason: 'not_found' })
    expect(await staffDal.answerQuestion(staff, id, 'я'.repeat(QUESTION_MAX_LENGTH), freshIp())).toEqual({ ok: true })
  })

  it('два одновременных ответа на один вопрос: проходит один, уведомление одно', async () => {
    const id = await ask(a)
    const results = await Promise.all([
      staffDal.answerQuestion(staff, id, 'Первый', freshIp()),
      staffDal.answerQuestion(staff, id, 'Второй', freshIp()),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.reason === 'already_answered')).toHaveLength(1)
    const notes = await withOwner((c) => c.query('select count(*)::int as n from notifications where link = $1', [`/questions/${id}`]))
    expect(notes.rows[0].n).toBe(1)
  })

  it('31-й ответ за минуту с одного адреса — «rate_limited»; с другого адреса проходит; через минуту снова', async () => {
    const ids = (
      await withOwner((c) =>
        c.query(
          `insert into questions (student_id, topic, body, ip) select u.id, 'other', 'bulk', 'bulk-q-answers' from users u, generate_series(1, 33) where u.login = $1 returning id`,
          [STUDENT_A.login],
        ),
      )
    ).rows.map((r) => r.id as string)
    created.push(...ids)
    const x = freshIp()
    const y = freshIp()
    for (const id of ids.slice(0, 30)) expect(await staffDal.answerQuestion(staff, id, 'Ответ', x)).toEqual({ ok: true })
    expect(await staffDal.answerQuestion(staff, ids[30]!, 'Ответ', x)).toEqual({ ok: false, reason: 'rate_limited' })
    expect((await studentDal.getMyQuestion(a, ids[30]!))!.status, 'отказанный ответ не записан').toBe('sent')
    expect(await staffDal.answerQuestion(staff, ids[30]!, 'Ответ', y)).toEqual({ ok: true })
    await withOwner((c) => c.query(`update questions set answered_at = now() - interval '2 minutes' where answer_ip = $1`, [x]))
    expect(await staffDal.answerQuestion(staff, ids[31]!, 'Ответ', x)).toEqual({ ok: true })
  })
})

describe('набор данных: вопросы и освежение', () => {
  const plan = buildCohortPlan(MAIN_COHORT, today)

  it('у каждого из двух студентов по два вопроса — с ответом и без; у ответа уведомление «Деканат ответил на вопрос»', async () => {
    expect(plan.students).toHaveLength(2)
    for (const student of plan.students) {
      expect(student.questions, student.spec.login).toHaveLength(2)
      expect(student.questions.filter((q) => q.status === 'answered')).toHaveLength(1)
      expect(student.questions.filter((q) => q.status === 'sent')).toHaveLength(1)
      expect(student.spec.markers.questions, 'метка вопросов').toBeTruthy()
      const answered = student.questions.find((q) => q.status === 'answered')!
      const note = student.notifications.find((n) => n.link === `/questions/${answered.id}`)
      expect(note, 'уведомление об ответе').toMatchObject({ title: 'Деканат ответил на вопрос', body: topicLabel(answered.topic), kind: 'reminder' })
    }
    const [m1, m2] = plan.students.map((s) => s.spec.markers.questions!)
    expect(m1).not.toBe(m2)
    // Метка есть в вопросе своего студента и нет в вопросах чужого.
    expect(plan.students[0]!.questions.some((q) => q.body.includes(m1!))).toBe(true)
    expect(plan.students[1]!.questions.some((q) => q.body.includes(m1!))).toBe(false)
    expect(plan.students[1]!.questions.some((q) => q.body.includes(m2!))).toBe(true)
    expect(plan.students[0]!.questions.some((q) => q.body.includes(m2!))).toBe(false)
  })

  it('вопросы набора лежат в базе после заполнения; студент видит свой ответ', async () => {
    await withOwner((c) => seedCohort(c, MAIN_COHORT, today))
    const mine = await studentDal.listMyQuestions(a)
    const planned = plan.students[0]!.questions
    expect(mine.map((q) => q.id).sort()).toEqual(planned.map((q) => q.id).sort())
    const answered = planned.find((q) => q.status === 'answered')!
    expect(await studentDal.getMyQuestion(a, answered.id)).toMatchObject({ status: 'answered', answer: answered.answer })
    expect(await studentDal.getMyQuestion(b, answered.id), 'чужой вопрос набора').toBeNull()
  })

  for (const mode of ['refresh', 'full'] as const) {
    it(`режим ${mode}: вопросы посетителей и уведомления о них удаляются; вопросы набора, заявка посетителя, другие уведомления и другой набор остаются`, async () => {
      await withOwner((c) => seedCohort(c, MAIN_COHORT, today))
      await withOwner((c) => seedCohort(c, ALT_COHORT, today))
      const visitorQ = await ask(a, 'Вопрос посетителя', 'other', 'visitor')
      const visitorQb = await ask(b, 'Вопрос посетителя Б', 'other', 'visitor')
      await studentDal.createMyQuestion(a, { topic: 'other', text: 'ещё' }, 'visitor')
      const answeredVisitor = await ask(a, 'Вопрос посетителя с ответом')
      expect(await staffDal.answerQuestion(staff, answeredVisitor, 'Ответ посетителю', freshIp())).toEqual({ ok: true })
      const altQuestion = await ask(altStudent, 'Вопрос второго набора')
      expect(await staffDal.answerQuestion(altStaff, altQuestion, 'Ответ второго набора', freshIp())).toEqual({ ok: true })
      const visitorRequest = await studentDal.createMyRequest(a, { kind: 'financial_aid' }, freshIp())
      const marker = `метка-${mode}`
      await withOwner((c) =>
        c.query(
          `insert into notifications (student_id, kind, title, body, link) select u.id, 'reminder', $2, $2, $3 from users u where u.login = $1`,
          [STUDENT_A.login, marker, `/requests/${visitorRequest!.id}`],
        ),
      )
      try {
        const kept = plan.students[0]!.questions
        const keptAnswered = kept.find((q) => q.status === 'answered')!
        const before = await withOwner((c) => c.query('select count(*)::int as n from notifications where student_id = $1', [a.userId]))

        await withOwner((c) => seedCohort(c, MAIN_COHORT, today, { mode }))

        const left = await withOwner((c) => c.query('select id from questions where id = any($1::uuid[])', [[visitorQ, visitorQb, answeredVisitor]]))
        expect(left.rows, 'вопросы посетителей удалены').toHaveLength(0)
        const stillVisitor = await withOwner((c) => c.query(`select count(*)::int as n from questions where ip = 'visitor'`))
        expect(stillVisitor.rows[0].n).toBe(0)
        const gone = await withOwner((c) =>
          c.query('select count(*)::int as n from notifications where link = any($1)', [[`/questions/${answeredVisitor}`, `/questions/${visitorQ}`]]),
        )
        expect(gone.rows[0].n, 'уведомление об ответе на удалённый вопрос удалено').toBe(0)
        // Вопросы набора на месте и с ответом; их уведомление цело.
        const setRows = await withOwner((c) => c.query('select id, status from questions where student_id = $1 order by id', [a.userId]))
        expect(setRows.rows.map((r) => r.id as string).sort()).toEqual(kept.map((q) => q.id).sort())
        expect(setRows.rows.find((r) => r.id === keptAnswered.id)!.status).toBe('answered')
        const keptNote = await withOwner((c) => c.query('select count(*)::int as n from notifications where link = $1', [`/questions/${keptAnswered.id}`]))
        expect(keptNote.rows[0].n).toBe(1)
        // Другой набор не тронут: его вопрос и ответ целы.
        const alt = await withOwner((c) => c.query('select status from questions where id = $1', [altQuestion]))
        expect(alt.rows[0]?.status).toBe('answered')
        const altNote = await withOwner((c) => c.query('select count(*)::int as n from notifications where link = $1', [`/questions/${altQuestion}`]))
        expect(altNote.rows[0].n).toBe(1)
        if (mode === 'refresh') {
          // Заявка посетителя и уведомление о ней остаются только в режиме refresh; full и раньше стирал их.
          const request = await withOwner((c) => c.query('select 1 from requests where id = $1', [visitorRequest!.id]))
          expect(request.rowCount, 'заявка посетителя цела').toBe(1)
          const note = await withOwner((c) => c.query('select 1 from notifications where title = $1', [marker]))
          expect(note.rowCount, 'прочее уведомление цело').toBe(1)
          const after = await withOwner((c) => c.query('select count(*)::int as n from notifications where student_id = $1', [a.userId]))
          // Было: уведомления набора + об удалённом ответе + прочее; стало на одно (об удалённом ответе) меньше.
          expect(after.rows[0].n).toBe(before.rows[0].n - 1)
        }
      } finally {
        await withOwner(async (c) => {
          await c.query(`delete from notifications where title = $1`, [marker])
          await c.query(`delete from requests where id = $1`, [visitorRequest!.id])
          await c.query(`delete from notifications where link = $1`, [`/questions/${altQuestion}`])
          await c.query(`delete from questions where id = $1`, [altQuestion])
        })
        await withOwner((c) => seedCohort(c, MAIN_COHORT, today))
      }
    })
  }
})
