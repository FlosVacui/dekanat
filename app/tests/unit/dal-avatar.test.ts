// 20.11, блиц: фото профиля и проверка студенческого билета в слое доступа.
// Права на запись в user_avatars выдаёт migrate-lib.ts (строка GRANT … user_avatars); без неё запись роль приложения не пройдёт.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AVATAR_MAX_BYTES } from '../../src/app/profile/avatar-rules'
import { studentTicketCode, verifyStudentTicketCode } from '@/lib/certificate'
import { type Actor as ActorType } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as studentDal from '@/server/dal/student'
import { STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor, withOwner } from './helpers'

let a: ActorType
let b: ActorType
let staff: ActorType

beforeAll(async () => {
  ;[a, b, staff] = await Promise.all([actorFor(STUDENT_A), actorFor(STUDENT_B), actorFor(STAFF_MAIN)])
})
afterAll(closeDb)

function jpeg(size = 64, fill = 7): Uint8Array {
  const bytes = new Uint8Array(size).fill(fill)
  bytes.set([0xff, 0xd8, 0xff, 0xe0])
  return bytes
}
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('фото профиля', () => {
  it('сохраняется, читается, заменяется и удаляется; владелец — из сессии', async () => {
    await studentDal.deleteMyAvatar(a)
    expect(await studentDal.hasMyAvatar(a)).toBe(false)
    expect(await studentDal.getMyAvatar(a)).toBeNull()

    expect(await studentDal.setMyAvatar(a, jpeg(64, 1), 'image/jpeg')).toEqual({ ok: true, mime: 'image/jpeg' })
    expect(await studentDal.hasMyAvatar(a)).toBe(true)
    const first = await studentDal.getMyAvatar(a)
    expect(first?.mime).toBe('image/jpeg')
    expect([...first!.data]).toEqual([...jpeg(64, 1)])

    // Замена: одна строка на студента, содержимое новое.
    const png = new Uint8Array(40).fill(9)
    png.set(PNG_HEAD)
    expect(await studentDal.setMyAvatar(a, png, 'image/png')).toEqual({ ok: true, mime: 'image/png' })
    const second = await studentDal.getMyAvatar(a)
    expect(second?.mime).toBe('image/png')
    expect(second?.data.length).toBe(40)
    const rows = await withOwner((c) => c.query('select count(*)::int as n from user_avatars where user_id = (select id from users where login = $1)', [STUDENT_A.login]))
    expect(rows.rows[0].n).toBe(1)

    await studentDal.deleteMyAvatar(a)
    expect(await studentDal.hasMyAvatar(a)).toBe(false)
    // Повторное удаление безвредно.
    await studentDal.deleteMyAvatar(a)
  })

  it('чужое фото не видно и не меняется: у функций нет параметра «чьё»', async () => {
    await studentDal.deleteMyAvatar(a)
    await studentDal.deleteMyAvatar(b)
    await studentDal.setMyAvatar(a, jpeg(32, 3), 'image/jpeg')
    expect(await studentDal.getMyAvatar(b)).toBeNull()
    expect(await studentDal.hasMyAvatar(b)).toBe(false)
    // Удаление студентом Б не трогает фото студента А.
    await studentDal.deleteMyAvatar(b)
    expect(await studentDal.hasMyAvatar(a)).toBe(true)
    // Запись студентом Б не меняет фото студента А.
    await studentDal.setMyAvatar(b, jpeg(16, 5), 'image/jpeg')
    expect((await studentDal.getMyAvatar(a))?.data.length).toBe(32)
    expect((await studentDal.getMyAvatar(b))?.data.length).toBe(16)
    await studentDal.deleteMyAvatar(a)
    await studentDal.deleteMyAvatar(b)
  })

  it('отказ без записи: пустой файл, больше 150 КБ, не картинка, тип не из списка; прежнее фото остаётся', async () => {
    await studentDal.deleteMyAvatar(a)
    await studentDal.setMyAvatar(a, jpeg(20, 2), 'image/jpeg')
    expect(await studentDal.setMyAvatar(a, new Uint8Array(), 'image/jpeg')).toEqual({ ok: false, reason: 'empty' })
    expect(await studentDal.setMyAvatar(a, jpeg(AVATAR_MAX_BYTES + 1), 'image/jpeg')).toEqual({ ok: false, reason: 'size' })
    expect(await studentDal.setMyAvatar(a, new TextEncoder().encode('<svg onload="alert(1)"></svg>'), 'image/jpeg')).toEqual({ ok: false, reason: 'type' })
    expect(await studentDal.setMyAvatar(a, jpeg(20, 4), 'image/svg+xml')).toEqual({ ok: false, reason: 'type' })
    expect((await studentDal.getMyAvatar(a))?.data.length).toBe(20)
    expect([...(await studentDal.getMyAvatar(a))!.data]).toEqual([...jpeg(20, 2)])
    // Ровно предел проходит.
    expect((await studentDal.setMyAvatar(a, jpeg(AVATAR_MAX_BYTES), 'image/jpeg')).ok).toBe(true)
    await studentDal.deleteMyAvatar(a)
  })

  it('предел слоя и предел базы совпадают: база не принимает больше 150 КБ и тип не из списка', async () => {
    await withOwner(async (c) => {
      const user = (await c.query('select id from users where login = $1', [STUDENT_B.login])).rows[0].id as string
      await c.query('delete from user_avatars where user_id = $1', [user])
      await expect(c.query('insert into user_avatars (user_id, mime, data) values ($1, $2, $3)', [user, 'image/jpeg', Buffer.alloc(AVATAR_MAX_BYTES + 1)])).rejects.toThrow(/user_avatars_size_check/)
      await expect(c.query('insert into user_avatars (user_id, mime, data) values ($1, $2, $3)', [user, 'image/svg+xml', Buffer.alloc(10)])).rejects.toThrow(/user_avatars_mime_check/)
      await c.query('insert into user_avatars (user_id, mime, data) values ($1, $2, $3)', [user, 'image/jpeg', Buffer.alloc(AVATAR_MAX_BYTES)])
      await c.query('delete from user_avatars where user_id = $1', [user])
    })
  })

  it('сотрудник: отказ по роли во всех четырёх функциях', async () => {
    await expect(studentDal.hasMyAvatar(staff)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(studentDal.getMyAvatar(staff)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(studentDal.setMyAvatar(staff, jpeg(), 'image/jpeg')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(studentDal.deleteMyAvatar(staff)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('getStudentForTicketVerification', () => {
  it('отдаёт только ФИО, курс и группу', async () => {
    const check = await studentDal.getStudentForTicketVerification(a.userId)
    expect(check).toEqual({ fullName: STUDENT_A.fullName, course: STUDENT_A.course, groupName: STUDENT_A.groupName })
  })

  it('сотрудник, чужой номер, мусор и SQL в номере — null', async () => {
    expect(await studentDal.getStudentForTicketVerification(staff.userId)).toBeNull()
    expect(await studentDal.getStudentForTicketVerification('00000000-0000-4000-8000-000000000000')).toBeNull()
    expect(await studentDal.getStudentForTicketVerification("x'; drop table students; --")).toBeNull()
  })

  it('код из сессии студента даёт номер этого студента; код справки с тем же номером не подходит', () => {
    const secret = 'test-secret-label-not-real'
    expect(verifyStudentTicketCode(studentTicketCode(a.userId, secret), secret)).toBe(a.userId)
    expect(verifyStudentTicketCode(studentTicketCode(b.userId, secret), secret)).toBe(b.userId)
    expect(studentTicketCode(a.userId, secret)).not.toBe(studentTicketCode(b.userId, secret))
  })
})
