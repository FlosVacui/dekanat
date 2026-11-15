// Лента уведомлений и объявлений, число непрочитанного и отметка «прочитано» (пакет 3.5, ЯД-5, ЗД-5, ADR-0002).
// Студенты — основной набор: Белозёров (экономика) и Нестерова (инженерия). Объявление «Олимпиада по программированию»
// адресовано только факультету инженерии. Всё, что тесты отметили, в конце возвращается к тому, что было до них.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as studentDal from '@/server/dal/student'
import { STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { restoreFeedState, snapshotFeedState, type FeedSnapshot } from './feed-state'
import { actorFor, withOwner } from './helpers'

let a: Actor
let b: Actor
let staff: Actor

const NOT_A_RECORD = '00000000-0000-4000-8000-000000000000'
const ENGINEERING_ONLY_TITLE = 'Олимпиада по программированию'

const snapshot = snapshotFeedState
const restore = restoreFeedState

let initial: FeedSnapshot
beforeAll(async () => {
  ;[a, b, staff] = await Promise.all([actorFor(STUDENT_A), actorFor(STUDENT_B), actorFor(STAFF_MAIN)])
  initial = await snapshot()
})
afterEach(async () => {
  await restore(initial)
})
afterAll(async () => {
  await restore(initial)
  expect(await snapshot(), 'прочитанность после тестов равна прочитанности до них').toEqual(initial)
  await closeDb()
})

async function engineeringOnlyId(): Promise<string> {
  const res = await withOwner((c) => c.query('select id from announcements where title = $1 and faculty is not null', [ENGINEERING_ONLY_TITLE]))
  expect(res.rows).toHaveLength(1)
  return res.rows[0].id as string
}

async function readAtOf(id: string): Promise<Date | null> {
  const res = await withOwner((c) => c.query('select read_at from notifications where id = $1', [id]))
  return res.rows[0].read_at as Date | null
}

async function readsOf(announcementId: string, login: string): Promise<number> {
  const res = await withOwner((c) =>
    c.query(
      'select 1 from announcement_reads r join users u on u.id = r.student_id where r.announcement_id = $1 and u.login = $2',
      [announcementId, login],
    ),
  )
  return res.rowCount ?? 0
}

describe('лента: личные уведомления и объявления одним списком', () => {
  it('обе таблицы в одном списке, новые сверху, не больше 100; у записи нужные поля', async () => {
    const feed = await studentDal.listMyFeed(a)
    expect(feed.length).toBeLessThanOrEqual(100)
    expect(feed.some((i) => i.source === 'notification')).toBe(true)
    expect(feed.some((i) => i.source === 'announcement')).toBe(true)
    const times = feed.map((i) => i.at.getTime())
    expect(times, 'новые сверху').toEqual([...times].sort((x, y) => y - x))
    for (const item of feed) {
      expect(['notification', 'announcement']).toContain(item.source)
      expect(['reminder', 'news']).toContain(item.feed)
      expect(typeof item.read).toBe('boolean')
      if (item.source === 'announcement') {
        expect(item.feed).toBe('news')
        expect(item.link).toBeNull()
      }
    }
    // Лента уведомления — по его виду: «Пересдача по эконометрике» в наборе — новость, «Срок через…» — напоминание.
    const resit = feed.find((i) => i.source === 'notification' && i.title === 'Пересдача по эконометрике')
    expect(resit?.feed).toBe('news')
    expect(feed.find((i) => i.source === 'notification' && i.title.startsWith('Срок через'))?.feed).toBe('reminder')
  })

  it('личные уведомления студента в ленте те же, что отдаёт слой; чужих нет', async () => {
    const own = (await studentDal.listMyNotifications(a)).map((n) => n.id).sort()
    const feedOwn = (await studentDal.listMyFeed(a)).filter((i) => i.source === 'notification').map((i) => i.id).sort()
    expect(feedOwn).toEqual(own)
    const theirs = new Set((await studentDal.listMyNotifications(b)).map((n) => n.id))
    expect(feedOwn.some((id) => theirs.has(id))).toBe(false)
  })

  it('объявление другого факультета в ленту не попадает; у студента того факультета оно есть', async () => {
    const engineeringOnly = await engineeringOnlyId()
    const feedA = await studentDal.listMyFeed(a)
    const feedB = await studentDal.listMyFeed(b)
    expect(feedA.some((i) => i.source === 'announcement' && i.id === engineeringOnly)).toBe(false)
    expect(feedB.some((i) => i.source === 'announcement' && i.id === engineeringOnly)).toBe(true)
    // Объявление группы экономики не видно студенту инженерии: «Пересдача по эконометрике» — только у Белозёрова.
    const groupOnly = await withOwner((c) => c.query('select id from announcements where title = $1 and group_id is not null', ['Пересдача по эконометрике']))
    const groupAnnouncementId = groupOnly.rows[0].id as string
    expect(feedA.some((i) => i.source === 'announcement' && i.id === groupAnnouncementId)).toBe(true)
    expect(feedB.some((i) => i.source === 'announcement' && i.id === groupAnnouncementId)).toBe(false)
  })

  it('число у колокольчика — непрочитанные записи ленты: один счёт', async () => {
    for (const actor of [a, b]) {
      const feed = await studentDal.listMyFeed(actor)
      const count = await studentDal.countMyUnreadNotifications(actor)
      const unreadInFeed = feed.filter((i) => !i.read).length
      // Лента режется на 100 записях, число — нет: при короткой ленте они равны, при длинной число не меньше.
      if (feed.length < 100) expect(count).toBe(unreadInFeed)
      else expect(count).toBeGreaterThanOrEqual(unreadInFeed)
    }
  })
})

describe('отметка уведомления', () => {
  it('своё уведомление: прочитано, число меньше на один, ссылка из базы; повтор ничего не меняет', async () => {
    const feed = await studentDal.listMyFeed(a)
    const target = feed.find((i) => i.source === 'notification' && !i.read && i.link !== null)!
    expect(target).toBeDefined()
    const before = await studentDal.countMyUnreadNotifications(a)
    expect(await studentDal.markMyFeedItemRead(a, 'notification', target.id)).toBe(target.link)
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(before - 1)
    const firstReadAt = await readAtOf(target.id)
    expect(firstReadAt).not.toBeNull()
    expect((await studentDal.listMyFeed(a)).find((i) => i.source === 'notification' && i.id === target.id)?.read).toBe(true)

    expect(await studentDal.markMyFeedItemRead(a, 'notification', target.id)).toBe(target.link)
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(before - 1)
    expect(await readAtOf(target.id), 'время первой отметки не сдвигается').toEqual(firstReadAt)
  })

  it('номер уведомления другого студента, случайный номер и мусор — один ответ, ни одна строка не меняется', async () => {
    const foreign = (await studentDal.listMyFeed(b)).find((i) => i.source === 'notification' && !i.read)!
    expect(foreign).toBeDefined()
    const aBefore = await studentDal.countMyUnreadNotifications(a)
    const bBefore = await studentDal.countMyUnreadNotifications(b)
    const before = await snapshot()

    const answers = [
      await studentDal.markMyFeedItemRead(a, 'notification', foreign.id),
      await studentDal.markMyFeedItemRead(a, 'notification', NOT_A_RECORD),
      await studentDal.markMyFeedItemRead(a, 'notification', '1; drop table notifications'),
      await studentDal.markMyFeedItemRead(a, 'notification', undefined),
      await studentDal.markMyFeedItemRead(a, 'notification', { id: foreign.id }),
    ]
    expect(answers).toEqual([null, null, null, null, null])
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(aBefore)
    expect(await studentDal.countMyUnreadNotifications(b)).toBe(bBefore)
    expect(await snapshot(), 'ни одна строка не изменилась').toEqual(before)
    expect(await readAtOf(foreign.id)).toBeNull()
  })

  it('источник не из списка — тот же ответ и никаких изменений', async () => {
    const own = (await studentDal.listMyFeed(a)).find((i) => i.source === 'notification' && !i.read)!
    const before = await snapshot()
    expect(await studentDal.markMyFeedItemRead(a, 'something', own.id)).toBeNull()
    expect(await studentDal.markMyFeedItemRead(a, undefined, own.id)).toBeNull()
    expect(await snapshot()).toEqual(before)
  })
})

describe('отметка объявления', () => {
  it('своё объявление: число меньше на один; повтор — без ошибки и без изменений', async () => {
    const target = (await studentDal.listMyFeed(a)).find((i) => i.source === 'announcement' && !i.read)!
    expect(target).toBeDefined()
    const before = await studentDal.countMyUnreadNotifications(a)
    expect(await studentDal.markMyFeedItemRead(a, 'announcement', target.id)).toBeNull()
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(before - 1)
    expect(await readsOf(target.id, STUDENT_A.login)).toBe(1)
    expect((await studentDal.listMyFeed(a)).find((i) => i.source === 'announcement' && i.id === target.id)?.read).toBe(true)

    const afterFirst = await snapshot()
    await expect(studentDal.markMyFeedItemRead(a, 'announcement', target.id)).resolves.toBeNull()
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(before - 1)
    expect(await readsOf(target.id, STUDENT_A.login)).toBe(1)
    expect(await snapshot()).toEqual(afterFirst)
  })

  it('объявление другого факультета: строки в announcement_reads нет, числа не меняются, ответ тот же', async () => {
    const engineeringOnly = await engineeringOnlyId()
    const aBefore = await studentDal.countMyUnreadNotifications(a)
    const bBefore = await studentDal.countMyUnreadNotifications(b)
    const answers = [
      await studentDal.markMyFeedItemRead(a, 'announcement', engineeringOnly),
      await studentDal.markMyFeedItemRead(a, 'announcement', NOT_A_RECORD),
      await studentDal.markMyFeedItemRead(a, 'announcement', 'не-номер'),
    ]
    expect(answers).toEqual([null, null, null])
    expect(await readsOf(engineeringOnly, STUDENT_A.login)).toBe(0)
    expect(await readsOf(engineeringOnly, STUDENT_B.login)).toBe(0)
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(aBefore)
    expect(await studentDal.countMyUnreadNotifications(b)).toBe(bBefore)
  })

  it('номер объявления, поданный как уведомление, ничего не отмечает', async () => {
    const target = (await studentDal.listMyFeed(a)).find((i) => i.source === 'announcement' && !i.read)!
    const before = await snapshot()
    expect(await studentDal.markMyFeedItemRead(a, 'notification', target.id)).toBeNull()
    expect(await snapshot()).toEqual(before)
  })
})

describe('отметить всё', () => {
  it('число студента — ноль, всё в его ленте прочитано; число второго студента не изменилось', async () => {
    const aBefore = await studentDal.countMyUnreadNotifications(a)
    const bBefore = await studentDal.countMyUnreadNotifications(b)
    expect(aBefore).toBeGreaterThan(0)
    expect(bBefore).toBeGreaterThan(0)
    const bFeedBefore = (await studentDal.listMyFeed(b)).map((i) => [i.source, i.id, i.read])

    await studentDal.markAllMyFeedRead(a)
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(0)
    expect((await studentDal.listMyFeed(a)).every((i) => i.read)).toBe(true)
    expect(await studentDal.countMyUnreadNotifications(b)).toBe(bBefore)
    expect((await studentDal.listMyFeed(b)).map((i) => [i.source, i.id, i.read])).toEqual(bFeedBefore)
    // Объявление чужого факультета студенту не отмечено.
    expect(await readsOf(await engineeringOnlyId(), STUDENT_A.login)).toBe(0)

    // Повтор — не ошибка.
    await expect(studentDal.markAllMyFeedRead(a)).resolves.toBeUndefined()
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(0)
  })
})

describe('сотрудник вместо студента получает тот же отказ, что у остальных функций студента', () => {
  it('лента, отметки и счёт', async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => studentDal.listMyFeed(staff),
      () => studentDal.markMyFeedItemRead(staff, 'notification', NOT_A_RECORD),
      () => studentDal.markMyFeedItemRead(staff, 'announcement', NOT_A_RECORD),
      () => studentDal.markAllMyFeedRead(staff),
      () => studentDal.countMyUnreadNotifications(staff),
    ]
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(ForbiddenError)
  })
})
