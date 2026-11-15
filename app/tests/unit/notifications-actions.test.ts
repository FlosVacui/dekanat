// Действия экрана «Уведомления» (пакет 3.5): «открыть запись» и «отметить всё». Вызываются как функции; кука и переходы
// Next.js подменены (адрес и вошедшего задаёт тест), вход, сессия и база настоящие. Тут же проверяются разбор фильтра
// и проверка адреса перехода.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ actor: null as unknown }))

vi.mock('@/server/auth/cookie', () => ({
  getCurrentActor: async () => state.actor,
  getClientIp: async () => '10.9.9.9',
  setSessionCookie: async () => undefined,
  logout: async () => undefined,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  forbidden: () => {
    throw new Error('NEXT_FORBIDDEN')
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

import { markAllFeedReadAction, openFeedItemAction } from '@/app/notifications/actions'
import { notificationsHref, parseFilter, safeInternalPath } from '@/app/notifications/filter'
import type { Actor } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import * as studentDal from '@/server/dal/student'
import { STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { restoreFeedState, snapshotFeedState, type FeedSnapshot } from './feed-state'
import { actorFor, withOwner } from './helpers'

const MARK = 'Тест 3.5:'
const NOT_A_RECORD = '00000000-0000-4000-8000-000000000000'

let a: Actor
let b: Actor
let staff: Actor
let initial: FeedSnapshot

beforeAll(async () => {
  ;[a, b, staff] = await Promise.all([actorFor(STUDENT_A), actorFor(STUDENT_B), actorFor(STAFF_MAIN)])
  initial = await snapshotFeedState()
})
afterEach(async () => {
  await restoreFeedState(initial)
})
afterAll(async () => {
  await withOwner((c) => c.query('delete from notifications where title like $1', [`${MARK}%`]))
  await restoreFeedState(initial)
  expect(await snapshotFeedState(), 'прочитанность после тестов равна прочитанности до них').toEqual(initial)
  await closeDb()
})

/** Куда ведёт действие: переход Next.js подменён исключением с адресом. */
async function target(action: (form: FormData) => Promise<void>, fields: Record<string, string>): Promise<string> {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  try {
    await action(form)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('NEXT_REDIRECT ')) return message.slice('NEXT_REDIRECT '.length)
    throw error
  }
  throw new Error('действие не завершилось переходом')
}

async function insertNotification(login: string, title: string, link: string | null): Promise<string> {
  const res = await withOwner((c) =>
    c.query(
      `insert into notifications (student_id, kind, title, body, link)
       select u.id, 'reminder', $2, 'Текст теста', $3 from users u where u.login = $1 returning id`,
      [login, `${MARK} ${title}`, link],
    ),
  )
  return res.rows[0].id as string
}

async function readAtOf(id: string): Promise<Date | null> {
  const res = await withOwner((c) => c.query('select read_at from notifications where id = $1', [id]))
  return res.rows[0].read_at as Date | null
}

describe('фильтр и адрес перехода', () => {
  it('фильтр принимается только из списка', () => {
    expect(parseFilter('news')).toBe('news')
    expect(parseFilter('reminders')).toBe('reminders')
    for (const junk of ['xyz', '', 'NEWS', 'news ', null, undefined, 5, {}, ['xyz']]) expect(parseFilter(junk), String(junk)).toBeNull()
    // Повторённый параметр приходит массивом: это мусор, как и у экрана успеваемости.
    expect(parseFilter(['news', 'reminders'])).toBeNull()
    expect(parseFilter(['news'])).toBeNull()
    expect(notificationsHref(null)).toBe('/notifications')
    expect(notificationsHref('news')).toBe('/notifications?filter=news')
    expect(notificationsHref('reminders')).toBe('/notifications?filter=reminders')
  })

  it('внутренний путь годится; внешний адрес, «//», обратная черта и управляющие символы — нет', () => {
    for (const ok of ['/grades', '/schedule', '/requests/11111111-1111-4111-8111-111111111111', '/notifications?filter=news']) {
      expect(safeInternalPath(ok), ok).toBe(ok)
    }
    const bad = [
      'https://evil.example/x',
      'http://evil.example',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      '\\evil.example',
      'javascript:alert(1)',
      'grades',
      '',
      ' /grades',
      '/\t/evil.example',
      '/\n/evil.example',
      '/gra des',
      '/a\\b',
    ]
    for (const link of bad) expect(safeInternalPath(link), JSON.stringify(link)).toBeNull()
    expect(safeInternalPath(null)).toBeNull()
    expect(safeInternalPath(undefined)).toBeNull()
  })
})

describe('действие «открыть запись»', () => {
  it('своё уведомление со ссылкой: отмечается и ведёт на ссылку из базы; адрес из формы на переход не влияет', async () => {
    state.actor = a
    const item = (await studentDal.listMyFeed(a)).find((i) => i.source === 'notification' && !i.read && i.link?.startsWith('/') && i.link !== '/notifications')!
    expect(item).toBeDefined()
    const before = await studentDal.countMyUnreadNotifications(a)
    const to = await target(openFeedItemAction, {
      source: 'notification',
      id: item.id,
      filter: 'news',
      link: 'https://evil.example/',
      redirect: '//evil.example',
      next: 'https://evil.example',
      returnTo: 'https://evil.example',
    })
    expect(to).toBe(item.link)
    expect(await readAtOf(item.id)).not.toBeNull()
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(before - 1)
  })

  it('уведомление с внешней ссылкой, вставленное тестом, ведёт на /notifications и отмечается', async () => {
    state.actor = a
    for (const [i, link] of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', '/\t/evil.example'].entries()) {
      const id = await insertNotification(STUDENT_A.login, `внешняя ссылка ${i}`, link)
      expect(await readAtOf(id)).toBeNull()
      expect(await target(openFeedItemAction, { source: 'notification', id, filter: 'news' }), JSON.stringify(link)).toBe('/notifications')
      expect(await readAtOf(id), 'запись при этом отмечена').not.toBeNull()
    }
  })

  it('нет ссылки или ссылка на сам экран — обратно на ленту с тем же фильтром', async () => {
    state.actor = a
    const plain = await insertNotification(STUDENT_A.login, 'без ссылки', null)
    const self = await insertNotification(STUDENT_A.login, 'ссылка на экран', '/notifications')
    expect(await target(openFeedItemAction, { source: 'notification', id: plain, filter: 'reminders' })).toBe('/notifications?filter=reminders')
    expect(await target(openFeedItemAction, { source: 'notification', id: self, filter: 'news' })).toBe('/notifications?filter=news')
    expect(await target(openFeedItemAction, { source: 'notification', id: self, filter: 'xyz' })).toBe('/notifications')
    expect(await readAtOf(plain)).not.toBeNull()
    expect(await readAtOf(self)).not.toBeNull()
  })

  it('объявление: отмечается и возвращает на ленту с тем же фильтром', async () => {
    state.actor = a
    const item = (await studentDal.listMyFeed(a)).find((i) => i.source === 'announcement' && !i.read)!
    const before = await studentDal.countMyUnreadNotifications(a)
    expect(await target(openFeedItemAction, { source: 'announcement', id: item.id, filter: 'news' })).toBe('/notifications?filter=news')
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(before - 1)
  })

  it('чужой номер, случайный номер, мусор и пустая форма — один переход, ничего не отмечено', async () => {
    state.actor = a
    const foreign = (await studentDal.listMyFeed(b)).find((i) => i.source === 'notification' && !i.read && i.link)!
    const aBefore = await studentDal.countMyUnreadNotifications(a)
    const bBefore = await studentDal.countMyUnreadNotifications(b)
    const results = [
      await target(openFeedItemAction, { source: 'notification', id: foreign.id, filter: 'news' }),
      await target(openFeedItemAction, { source: 'notification', id: NOT_A_RECORD, filter: 'news' }),
      await target(openFeedItemAction, { source: 'notification', id: 'не-номер', filter: 'news' }),
      await target(openFeedItemAction, { source: 'другой', id: foreign.id, filter: 'news' }),
      await target(openFeedItemAction, { filter: 'news' }),
    ]
    expect(new Set(results)).toEqual(new Set(['/notifications?filter=news']))
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(aBefore)
    expect(await studentDal.countMyUnreadNotifications(b)).toBe(bBefore)
    expect(await readAtOf(foreign.id)).toBeNull()
  })

  it('студента задаёт сессия: номер, поданный от имени другого студента в форме, ничего не меняет', async () => {
    state.actor = b
    const aItem = (await studentDal.listMyFeed(a)).find((i) => i.source === 'notification' && !i.read)!
    await target(openFeedItemAction, { source: 'notification', id: aItem.id, studentId: STUDENT_A.login, userId: a.userId })
    expect(await readAtOf(aItem.id)).toBeNull()
  })

  it('сотрудник — отказ; без сессии — на вход', async () => {
    const item = (await studentDal.listMyFeed(a)).find((i) => i.source === 'notification' && !i.read)!
    state.actor = staff
    await expect(target(openFeedItemAction, { source: 'notification', id: item.id })).rejects.toThrow('NEXT_FORBIDDEN')
    await expect(target(markAllFeedReadAction, {})).rejects.toThrow('NEXT_FORBIDDEN')
    state.actor = null
    expect(await target(openFeedItemAction, { source: 'notification', id: item.id })).toBe('/login')
    expect(await target(markAllFeedReadAction, {})).toBe('/login')
    expect(await readAtOf(item.id)).toBeNull()
  })
})

describe('действие «отметить всё»', () => {
  it('отмечает всё у студента из сессии, возвращает на ленту с тем же фильтром; второй студент не затронут', async () => {
    state.actor = a
    const bBefore = await studentDal.countMyUnreadNotifications(b)
    expect(await studentDal.countMyUnreadNotifications(a)).toBeGreaterThan(0)
    expect(await target(markAllFeedReadAction, { filter: 'reminders' })).toBe('/notifications?filter=reminders')
    expect(await studentDal.countMyUnreadNotifications(a)).toBe(0)
    expect(await studentDal.countMyUnreadNotifications(b)).toBe(bBefore)
  })

  it('фильтр не из списка — без фильтра', async () => {
    state.actor = a
    expect(await target(markAllFeedReadAction, { filter: 'xyz' })).toBe('/notifications')
    expect(await target(markAllFeedReadAction, {})).toBe('/notifications')
  })
})
