// Справка «Получить сразу»: создание сразу в статусе «Выдана», публичное чтение для /verify, срок в списке сотрудника, адрес из Host.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CERTIFICATE_TITLE, baseUrlFrom, certificateCode, verifyCertificateCode } from '@/lib/certificate'
import { type Actor as ActorType } from '@/server/auth/session'
import { closeDb } from '@/server/dal/client'
import { ForbiddenError } from '@/server/dal/guards'
import * as staffDal from '@/server/dal/staff'
import * as studentDal from '@/server/dal/student'
import { STAFF_MAIN, STUDENT_A, STUDENT_B } from './fixtures'
import { actorFor, freshIp } from './helpers'

let a: ActorType
let b: ActorType
let staff: ActorType
const SECRET = 'test-secret-label-not-real'

beforeAll(async () => {
  ;[a, b, staff] = await Promise.all([actorFor(STUDENT_A), actorFor(STUDENT_B), actorFor(STAFF_MAIN)])
})
afterAll(closeDb)

describe('createMyReadyCertificate', () => {
  it('создаёт свою справку по месту требования сразу «Выдана», история: подана, готова, выдана', async () => {
    const created = await studentDal.createMyReadyCertificate(a, freshIp())
    expect(created).not.toBeNull()
    const mine = await studentDal.getMyRequest(a, created!.id)
    expect(mine).toMatchObject({ kind: 'dean_certificate', status: 'issued', purpose: 'on_demand' })
    expect(mine?.issuedOn).toBeTruthy()
    expect(mine?.events.map((e) => e.status)).toEqual(['submitted', 'ready', 'issued'])
    // Чужой студент её не видит.
    expect(await studentDal.getMyRequest(b, created!.id)).toBeNull()
  })

  it('сотрудник не может: отказ по роли', async () => {
    await expect(studentDal.createMyReadyCertificate(staff, freshIp())).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('getCertificateForVerification', () => {
  it('отдаёт только тип, ФИО, курс, группу и дату готовности', async () => {
    const created = await studentDal.createMyReadyCertificate(a, freshIp())
    const check = await studentDal.getCertificateForVerification(created!.id)
    expect(check).not.toBeNull()
    expect(Object.keys(check!).sort()).toEqual(['course', 'fullName', 'groupName', 'issuedAt', 'kind'])
    expect(check!.fullName).toBe(STUDENT_A.fullName)
  })

  it('справка в статусе «Готова» (её отметил сотрудник) тоже проверяется', async () => {
    const created = await studentDal.createMyRequest(a, { kind: 'dean_certificate', purpose: 'on_demand' }, freshIp())
    for (const target of ['in_progress', 'ready'] as const) {
      expect(await staffDal.changeRequestStatus(staff, created!.id, { target }, freshIp())).toMatchObject({ ok: true })
    }
    expect(await studentDal.getCertificateForVerification(created!.id)).not.toBeNull()
  })

  it('поданная заявка, чужого вида заявка и не UUID — null', async () => {
    const submitted = await studentDal.createMyRequest(a, { kind: 'dean_certificate' }, freshIp())
    expect(await studentDal.getCertificateForVerification(submitted!.id)).toBeNull()
    const tuition = await studentDal.createMyRequest(a, { kind: 'tuition_certificate' }, freshIp())
    expect(await studentDal.getCertificateForVerification(tuition!.id)).toBeNull()
    expect(await studentDal.getCertificateForVerification('1; drop table requests')).toBeNull()
  })

  it('код из справки проходит проверку и ведёт к ней; чужой код — нет', async () => {
    const created = await studentDal.createMyReadyCertificate(a, freshIp())
    const code = certificateCode(created!.id, SECRET)
    expect(verifyCertificateCode(code, SECRET)).toBe(created!.id)
    expect(verifyCertificateCode(code, 'другой-секрет-для-проверки')).toBeNull()
    expect(CERTIFICATE_TITLE).toBe('Справка об обучении')
  })
})

describe('срок в списке сотрудника', () => {
  it('listCohortRequests отдаёт dueDate', async () => {
    const created = await studentDal.createMyReadyCertificate(a, freshIp())
    const list = await staffDal.listCohortRequests(staff)
    const row = list.find((r) => r.id === created!.id)
    expect(row).toBeDefined()
    expect(row!.dueDate).toBeTruthy()
  })
})

describe('baseUrlFrom', () => {
  it('хост и протокол', () => {
    expect(baseUrlFrom('dekanat.example', null)).toBe('https://dekanat.example')
    expect(baseUrlFrom('localhost:3000', null)).toBe('http://localhost:3000')
    expect(baseUrlFrom('dekanat.example', 'http')).toBe('http://dekanat.example')
    expect(baseUrlFrom('dekanat.example', 'javascript, https')).toBe('https://dekanat.example')
  })
  it('мусорный хост — null', () => {
    for (const bad of [null, '', 'a b', 'evil.example/path', 'x"onerror=', 'host:99999999']) expect(baseUrlFrom(bad, null)).toBeNull()
  })
})
