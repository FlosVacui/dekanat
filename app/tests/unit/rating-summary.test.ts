// 20.11, рейтинг в группе: расчёт в слое доступа (SQL) и слова для экрана. Образец — dal-semester.test.ts.
// Свои данные тест создаёт запросом под владельцем (отдельный набор `test-rating`, группы `ТЕСТ-РЕЙТ-*`) и в конце убирает.
// Вход — настоящим путём: действующее лицо берётся из сессии, подделать его нельзя.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RATING_EMPTY_TEXT, formatAverage, ratingLine, ratingNote } from '@/lib/grades'
import { hashPassword } from '@/server/auth/password'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as studentDal from '@/server/dal/student'
import { STAFF_MAIN } from './fixtures'
import { actorFor, withOwner } from './helpers'

const COHORT = 'test-rating'
const PASSWORD = 'тест-рейтинг-пароль-1'

type Outcome = '5' | '4' | '3' | '2' | 'credit' | 'no_credit' | 'pending'
interface Student {
  login: string
  group: 'main' | 'solo' | 'empty' | 'old' | 'back'
  /** Оценки по дисциплинам группы; названия — ключи. */
  marks: Record<string, Outcome>
}

// Группа `main`: текущий семестр 5 (D1, D2, D5 — экзамены, D3 — зачёт), прошлый 4 (D4). Прошлый семестр в рейтинг не входит.
const STUDENTS: Student[] = [
  { login: 'rating-a', group: 'main', marks: { D1: '5', D2: '4', D5: '4', D4: '2' } }, // 13/3, ничья с b
  { login: 'rating-b', group: 'main', marks: { D1: '4', D2: '5', D5: '4' } }, // 13/3
  { login: 'rating-c', group: 'main', marks: { D1: '5', D2: '5' } }, // 5,0
  { login: 'rating-d', group: 'main', marks: { D1: '3', D2: '3', D5: '4' } }, // 10/3
  { login: 'rating-e', group: 'main', marks: { D3: 'credit', D1: 'pending', D2: 'no_credit' } }, // итоговых оценок нет
  { login: 'rating-f', group: 'main', marks: { D1: '2' } }, // 2,0: двойка — тоже итоговая оценка
  { login: 'rating-g', group: 'solo', marks: { S1: '4' } }, // один в группе
  { login: 'rating-h', group: 'empty', marks: {} }, // у группы нет дисциплин
  { login: 'rating-i', group: 'old', marks: { O1: '5' } }, // оценка есть, но только в прошлом семестре группы: текущий — 6
  // Группа `back`: текущий семестр 6 без итогов (сессия впереди), итоги есть в 5 и в 4. Считается последний семестр с итогами — 5.
  { login: 'rating-j', group: 'back', marks: { B5: '5', B5b: '4', B4: '2' } }, // 4,5 за семестр 5; двойка семестра 4 не входит
  { login: 'rating-k', group: 'back', marks: { B5: '4', B5b: '4', B4: '5' } }, // 4,0
  { login: 'rating-l', group: 'back', marks: { B6: 'pending' } }, // в семестре 5 итогов нет — рейтинга нет, хотя у группы он есть
]

const GROUPS = { main: 'ТЕСТ-РЕЙТ-1', solo: 'ТЕСТ-РЕЙТ-2', empty: 'ТЕСТ-РЕЙТ-3', old: 'ТЕСТ-РЕЙТ-4', back: 'ТЕСТ-РЕЙТ-5' } as const
const DISCIPLINES: { group: Student['group']; key: string; kind: 'exam' | 'credit'; semester: number }[] = [
  { group: 'main', key: 'D1', kind: 'exam', semester: 5 },
  { group: 'main', key: 'D2', kind: 'exam', semester: 5 },
  { group: 'main', key: 'D3', kind: 'credit', semester: 5 },
  { group: 'main', key: 'D5', kind: 'exam', semester: 5 },
  { group: 'main', key: 'D4', kind: 'exam', semester: 4 },
  { group: 'solo', key: 'S1', kind: 'exam', semester: 3 },
  { group: 'old', key: 'O1', kind: 'exam', semester: 5 },
  { group: 'old', key: 'O2', kind: 'exam', semester: 6 },
  { group: 'back', key: 'B6', kind: 'exam', semester: 6 },
  { group: 'back', key: 'B5', kind: 'exam', semester: 5 },
  { group: 'back', key: 'B5b', kind: 'exam', semester: 5 },
  { group: 'back', key: 'B4', kind: 'exam', semester: 4 },
]

const actors = new Map<string, Actor>()
let staff: Actor

async function cleanup(): Promise<void> {
  await withOwner(async (c) => {
    await c.query(`delete from users where cohort = $1`, [COHORT]) // студенты и оценки уходят каскадом
    await c.query(`delete from groups where name like 'ТЕСТ-РЕЙТ-%'`) // дисциплины — каскадом
  })
}

beforeAll(async () => {
  await cleanup()
  const hash = await hashPassword(PASSWORD)
  await withOwner(async (c) => {
    const groupIds = new Map<string, string>()
    for (const [key, name] of Object.entries(GROUPS)) {
      const id = randomUUID()
      groupIds.set(key, id)
      await c.query(`insert into groups (id, name, faculty) values ($1, $2, 'Факультет тестовых данных')`, [id, name])
    }
    const disciplineIds = new Map<string, string>()
    for (const d of DISCIPLINES) {
      const id = randomUUID()
      disciplineIds.set(d.key, id)
      await c.query(`insert into disciplines (id, group_id, name, control_kind, semester) values ($1, $2, $3, $4, $5)`, [
        id, groupIds.get(d.group), d.key, d.kind, d.semester,
      ])
    }
    for (const s of STUDENTS) {
      const userId = randomUUID()
      await c.query(`insert into users (id, login, password_hash, role, cohort) values ($1, $2, $3, 'student', $4)`, [userId, s.login, hash, COHORT])
      await c.query(
        `insert into students (user_id, full_name, faculty, programme, course, group_id) values ($1, $2, 'Факультет тестовых данных', 'Тестирование', 1, $3)`,
        [userId, `Рейтинг-${s.login}`, groupIds.get(s.group)],
      )
      for (const [key, outcome] of Object.entries(s.marks)) {
        await c.query(`insert into grades (student_id, discipline_id, points, outcome) values ($1, $2, null, $3)`, [userId, disciplineIds.get(key), outcome])
      }
    }
  })
  for (const s of STUDENTS) actors.set(s.login, await actorFor({ login: s.login, password: PASSWORD }))
  staff = await actorFor(STAFF_MAIN)
})

afterAll(async () => {
  await cleanup()
  await closeDb()
})

const rating = (login: string) => studentDal.getMyRating(actors.get(login)!)

describe('рейтинг в группе: расчёт', () => {
  it('среднее — по итоговым оценкам текущего семестра; прошлый семестр не входит', async () => {
    const a = await rating('rating-a')
    expect(a?.semester).toBe(5)
    // Если бы двойка прошлого семестра входила, среднее было бы 15/4 = 3,75.
    expect(a?.average).toBeCloseTo(13 / 3, 10)
    expect(formatAverage(a!.average)).toBe('4,3')
  })

  it('места: лучший первый; равные средние — одно место, следующее пропускается (1, 2, 2, 4, 5)', async () => {
    const places = Object.fromEntries(await Promise.all(['a', 'b', 'c', 'd', 'f'].map(async (x) => [x, (await rating(`rating-${x}`))?.place] as const)))
    expect(places).toEqual({ c: 1, a: 2, b: 2, d: 4, f: 5 })
  })

  it('ничья точная, без округления: 13/3 и 13/3 — одно место, а 10/3 ниже', async () => {
    const [a, b] = await Promise.all([rating('rating-a'), rating('rating-b')])
    expect(a?.place).toBe(b?.place)
    expect(a?.average).toBe(b?.average)
  })

  it('размер группы — все студенты группы, в том числе без итоговых оценок', async () => {
    for (const x of ['a', 'c', 'f']) expect((await rating(`rating-${x}`))?.groupSize).toBe(6)
  })

  it('нет итоговых оценок (зачёт, «нет итога», незачёт не считаются) — null', async () => {
    expect(await rating('rating-e')).toBeNull()
  })

  it('двойка — итоговая оценка: средний 2,0, последнее место', async () => {
    expect(await rating('rating-f')).toEqual({ semester: 5, average: 2, place: 5, groupSize: 6 })
  })

  it('один в группе: место 1 из 1', async () => {
    expect(await rating('rating-g')).toEqual({ semester: 3, average: 4, place: 1, groupSize: 1 })
  })

  it('у группы нет дисциплин — null', async () => {
    expect(await rating('rating-h')).toBeNull()
  })

  it('у группы нет итогов в текущем семестре (6) — считается последний семестр с итогами (5), а не null', async () => {
    // Было: null. Стало (20.11, решение участника А): в демо у групп студентов 1 и 2 сессия впереди, рейтинг по прошлому семестру.
    expect(await rating('rating-i')).toEqual({ semester: 5, average: 5, place: 1, groupSize: 1 })
  })

  it('откат на прошлый семестр: берётся последний семестр с итогами, более ранний не входит, места считаются там же', async () => {
    const [j, k] = await Promise.all([rating('rating-j'), rating('rating-k')])
    expect(j).toEqual({ semester: 5, average: 4.5, place: 1, groupSize: 3 })
    expect(k).toEqual({ semester: 5, average: 4, place: 2, groupSize: 3 })
    expect(ratingNote(j!)).toBe('За 5 семестр, по итоговым оценкам 2–5; зачёты не входят')
  })

  it('откат не придумывает рейтинг студенту, у которого в выбранном семестре итогов нет', async () => {
    expect(await rating('rating-l')).toBeNull()
  })

  it('текущий семестр с итогами у группы побеждает: откат не включается', async () => {
    expect((await rating('rating-a'))?.semester).toBe(5)
  })
})

describe('рейтинг в группе: что выходит наружу и кому', () => {
  it('только четыре поля: ни имён, ни чужих оценок, ни номеров', async () => {
    const c = await rating('rating-c')
    expect(Object.keys(c!).sort()).toEqual(['average', 'groupSize', 'place', 'semester'])
    const text = JSON.stringify(c)
    expect(text).not.toMatch(/Рейтинг-|rating-|ТЕСТ-РЕЙТ/)
  })

  it('сотрудник получает отказ: функция только для студента', async () => {
    await expect(studentDal.getMyRating(staff)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('функция не принимает номер студента: сигнатура — одно действующее лицо', () => {
    expect(studentDal.getMyRating.length).toBe(1)
  })
})

describe('рейтинг в группе: слова для экрана', () => {
  it('строка «Средний балл 4,3 · место 7 из 24 в группе»', () => {
    expect(ratingLine({ semester: 5, average: 4.3, place: 7, groupSize: 24 })).toBe('Средний балл 4,3 · место 7 из 24 в группе')
    expect(ratingLine({ semester: 5, average: 13 / 3, place: 2, groupSize: 6 })).toBe('Средний балл 4,3 · место 2 из 6 в группе')
  })

  it('подпись называет семестр и шкалу; текст для «нет оценок» — как в задании', () => {
    expect(ratingNote({ semester: 5, average: 4, place: 1, groupSize: 1 })).toBe('За 5 семестр, по итоговым оценкам 2–5; зачёты не входят')
    expect(RATING_EMPTY_TEXT).toBe('Рейтинг появится после первых итоговых оценок')
  })
})
