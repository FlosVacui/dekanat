// Освежение (`db:refresh`) и новые таблицы захода Б: баллы за работы и материалы курса. На сервере после слияния их заполнит
// только освежение (`07-refresh.sh` без аргумента), поэтому вставка должна идти в режиме refresh, а не только в full.
// Образец — seed-cohort.test.ts. База тестовая; в конце набор возвращается к состоянию, которого ждут остальные тесты.
import type pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { MAIN_COHORT } from '../../db/seed-data'
import { seedCohort } from '../../db/seed-lib'
import { buildCohortPlan } from '../../db/seed-plan'
import { addDays, todayIn } from '@/lib/dates'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { closeDb } from '@/server/dal/client'
import { ALT_COHORT, STAFF_MAIN, STUDENT_A } from './fixtures'
import { actorFor, withOwner } from './helpers'

const today = todayIn('Europe/Moscow')
const full = (client: pg.Client, date = today) => seedCohort(client, MAIN_COHORT, date)
const refresh = (client: pg.Client, date = today) => seedCohort(client, MAIN_COHORT, date, { mode: 'refresh' })

afterAll(async () => {
  await withOwner(async (client) => {
    await full(client)
    await seedCohort(client, ALT_COHORT, today)
  })
  await closeDb()
})

async function count(client: pg.Client, sql: string, values: unknown[] = []): Promise<number> {
  return (await client.query(`SELECT count(*)::int AS n FROM (${sql}) x`, values)).rows[0].n as number
}

/** Строки новых таблиц набора: по ним видно, что освежение ничего не добавило и не потеряло. */
async function newTablesFingerprint(client: pg.Client): Promise<string> {
  const rows = await client.query(
    `SELECT coalesce(md5(string_agg(r, '|' ORDER BY r)), 'пусто') AS h FROM (
       SELECT 'r:' || student_id || ':' || assignment_id || ':' || points AS r FROM assignment_results
       UNION ALL SELECT 'm:' || discipline_id || ':' || title || ':' || position FROM course_materials) x`,
  )
  return rows.rows[0].h as string
}

describe('освежение заполняет баллы за работы и материалы', () => {
  it('таблицы пусты (как на сервере после миграции) → после refresh заполнены; сроки сдвинуты; заявка и уведомление посетителя на месте', async () => {
    const a = await actorFor(STUDENT_A)
    const staff = await actorFor(STAFF_MAIN)
    await withOwner((client) => full(client))

    // «Посетитель» подал заявку, сотрудник перевёл её в работу: появились история и уведомление.
    const mine = await studentDal.createMyRequest(a, { kind: 'tuition_certificate', paymentYear: 2025 }, 'refresh-works-test')
    expect(mine).not.toBeNull()
    expect((await staffDal.changeRequestStatus(staff, mine!.id, { target: 'in_progress' })).ok).toBe(true)
    const visitorNotifications = (await studentDal.listMyNotifications(a)).filter((n) => n.title.startsWith('Справка об оплате обучения'))
    expect(visitorNotifications.length).toBeGreaterThan(0)

    const later = addDays(today, 3)
    const planNow = buildCohortPlan(MAIN_COHORT, today)
    const planLater = buildCohortPlan(MAIN_COHORT, later)
    const expectedResults = planLater.students.reduce((sum, s) => sum + s.workResults.length, 0)
    const expectedMaterials = planLater.disciplines.reduce((sum, d) => sum + d.materials.length, 0)
    expect(expectedResults, 'в наборе должны быть баллы за работы').toBe(23)
    // Девять дисциплин текущих семестров (четыре у группы 1 и пять у группы 2, с «Основами проектной работы») по три названия.
    expect(expectedMaterials, 'в наборе должны быть материалы').toBe(27)

    await withOwner(async (client) => {
      // Состояние сервера после миграции: таблицы созданы и пусты.
      await client.query('DELETE FROM assignment_results')
      await client.query('DELETE FROM course_materials')
      expect(await count(client, 'SELECT 1 FROM assignment_results')).toBe(0)

      await refresh(client, later)

      expect(await count(client, 'SELECT 1 FROM assignment_results')).toBe(expectedResults)
      expect(await count(client, 'SELECT 1 FROM course_materials')).toBe(expectedMaterials)
      // Сумма баллов за сданные работы у студента равна баллам за семестр и после освежения.
      const sums = await client.query(
        `SELECT u.login, d.name, sum(r.points)::int AS works, g.points
         FROM assignment_results r JOIN assignments a ON a.id = r.assignment_id JOIN disciplines d ON d.id = a.discipline_id
         JOIN grades g ON g.discipline_id = d.id AND g.student_id = r.student_id JOIN users u ON u.id = r.student_id
         GROUP BY u.login, d.name, g.points`,
      )
      expect(sums.rows.length).toBe(8)
      for (const row of sums.rows) expect(row.works, `${row.login}: ${row.name}`).toBe(row.points)

      // Сроки сдвинулись вместе с Д: долг остался долгом относительно нового дня.
      const stock = await client.query(`SELECT due_date::text AS d FROM assignments WHERE title = 'Тест по запасам'`)
      const stockLater = planLater.disciplines.flatMap((d) => d.assignments).find((w) => w.key === 'stock-test')!.dueDate
      expect(stock.rows[0].d).toBe(stockLater)
      expect(stockLater).not.toBe(planNow.disciplines.flatMap((d) => d.assignments).find((w) => w.key === 'stock-test')!.dueDate)
      expect(stockLater < later).toBe(true)

      // Заявка и уведомление посетителя на месте, не изменены.
      const request = await client.query('SELECT status, ip, payment_year FROM requests WHERE id = $1', [mine!.id])
      expect(request.rows[0]).toMatchObject({ status: 'in_progress', ip: 'refresh-works-test', payment_year: 2025 })
      expect(await count(client, 'SELECT 1 FROM request_events WHERE request_id = $1', [mine!.id])).toBe(2)
      const stillThere = (await studentDal.listMyNotifications(a)).filter((n) => n.title.startsWith('Справка об оплате обучения'))
      expect(stillThere.map((n) => n.id).sort()).toEqual(visitorNotifications.map((n) => n.id).sort())

      // Повторное освежение в тот же день ничего не меняет в новых таблицах.
      const afterFirst = await newTablesFingerprint(client)
      await refresh(client, later)
      expect(await newTablesFingerprint(client)).toBe(afterFirst)
    })
  })

  it('лишнее в новых таблицах убирается; изменённые баллы и порядок материалов возвращаются к набору', async () => {
    await withOwner((client) => full(client))
    const plan = buildCohortPlan(MAIN_COHORT, today)
    const student = plan.students[0]!
    const own = new Set(student.workResults.map((r) => r.assignmentId))
    const group = plan.disciplines.filter((d) => d.groupName === student.spec.groupName)
    const spare = group.flatMap((d) => d.assignments).find((w) => !own.has(w.id))!
    const micro = group.find((d) => d.name === 'Микроэкономика')!

    await withOwner(async (client) => {
      const before = await newTablesFingerprint(client)
      // Лишняя строка баллов за несданную работу, изменённые баллы, лишний материал, сбитый порядок.
      await client.query(`INSERT INTO assignment_results (student_id, assignment_id, points) VALUES ($1, $2, 1)`, [student.userId, spare.id])
      await client.query(`UPDATE assignment_results SET points = 0 WHERE student_id = $1 AND assignment_id = $2`, [student.userId, student.workResults[0]!.assignmentId])
      await client.query(`INSERT INTO course_materials (discipline_id, title, position) VALUES ($1, 'Лишний материал', 9)`, [micro.id])
      await client.query(`UPDATE course_materials SET position = 7 WHERE discipline_id = $1 AND title = 'Программа курса'`, [micro.id])
      expect(await newTablesFingerprint(client)).not.toBe(before)

      await refresh(client)

      expect(await newTablesFingerprint(client)).toBe(before)
      expect(await count(client, `SELECT 1 FROM course_materials WHERE title = 'Лишний материал'`)).toBe(0)
      expect(await count(client, `SELECT 1 FROM assignment_results WHERE assignment_id = $1`, [spare.id])).toBe(0)
    })
  })

  it('работа удалена из набора — её баллы уходят вместе с ней; база на месте после возврата набора', async () => {
    await withOwner((client) => full(client))
    const broken = structuredClone(MAIN_COHORT)
    const economics = broken.groups[0]!
    const micro = economics.disciplines.find((d) => d.name === 'Микроэкономика')!
    micro.assignments = micro.assignments.filter((a) => a.key !== 'rz1')
    const student = broken.students[0]!
    student.workResults = student.workResults!.filter((r) => r.assignmentKey !== 'rz1')
    // Баллы за семестр в наборе уже не равны сумме работ: проверка суммы — отдельный тест, здесь важно только удаление.
    await withOwner(async (client) => {
      await seedCohort(client, broken, today, { mode: 'refresh' })
      expect(await count(client, `SELECT 1 FROM assignments WHERE title = 'Расчётная работа №1'`)).toBe(0)
      expect(await count(client, `SELECT 1 FROM assignment_results r JOIN assignments a ON a.id = r.assignment_id WHERE a.title = 'Расчётная работа №1'`)).toBe(0)
      await full(client)
      expect(await count(client, `SELECT 1 FROM assignments WHERE title = 'Расчётная работа №1'`)).toBe(1)
    })
  })
})
