// «Черновик ИИ» (draftAnswerAction): отказ для вопроса чужого набора (замечание R-design-pass-11). Действие вызывается как
// функция; кука и заголовки подменены, сеть подменена: настоящая модель не вызывается. Вход, сессия и база настоящие.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ actor: null as unknown, ip: 'unknown' }))

vi.mock('@/server/auth/cookie', () => ({
  getCurrentActor: async () => state.actor,
  getClientIp: async () => state.ip,
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

import { draftAnswerAction, type DraftState } from '@/app/staff/questions/[id]/actions'
import { resetAiLimits } from '@/server/ai'
import { closeDb } from '@/server/dal/client'
import * as studentDal from '@/server/dal/student'
import { ALT_STUDENT, STAFF_MAIN, STUDENT_A } from './fixtures'
import { actorFor, freshIp, withOwner } from './helpers'

const KEY = 'test-key-not-real-0000'
const OWN_TEXT = 'Вопрос своего набора про пересдачу'
const FOREIGN_TEXT = 'Вопрос чужого набора с меткой МЕТКА-ЧУЖОЙ-НАБОР'
const created: string[] = []
const start: DraftState = { draft: null, error: null, version: 0 }
let fetchMock: ReturnType<typeof vi.fn>

afterAll(async () => {
  await withOwner((c) => c.query('delete from questions where id = any($1::uuid[])', [created]))
  await closeDb()
})

beforeEach(() => {
  vi.stubEnv('AI_BASE_URL', 'https://llm.example.test/v1')
  vi.stubEnv('AI_API_KEY', KEY)
  vi.stubEnv('AI_MODEL', 'model-x')
  vi.stubEnv('AI_FOLDER_ID', '')
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Черновик ответа' } }] })))
  vi.stubGlobal('fetch', fetchMock)
  resetAiLimits()
  state.ip = freshIp()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function ask(login: typeof STUDENT_A, text: string): Promise<string> {
  const made = await studentDal.createMyQuestion(await actorFor(login), { topic: 'documents', text }, freshIp())
  if (!made) throw new Error('вопрос не создан')
  created.push(made.id)
  return made.id
}

function form(questionId: string): FormData {
  const data = new FormData()
  data.set('questionId', questionId)
  return data
}

describe('draftAnswerAction: вопрос чужого набора', () => {
  it('сотрудник основного набора: чужой вопрос и несуществующий дают один отказ, модель не вызвана, текста вопроса в ответе нет', async () => {
    state.actor = await actorFor(STAFF_MAIN)
    const foreign = await ask(ALT_STUDENT, FOREIGN_TEXT)
    const written: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk))
      return true
    })

    const refusedForeign = await draftAnswerAction(start, form(foreign))
    const refusedMissing = await draftAnswerAction(start, form('00000000-0000-4000-8000-000000000000'))
    const refusedGarbage = await draftAnswerAction(start, form("1' or '1'='1"))

    expect(refusedForeign).toEqual({ draft: null, error: 'failed', version: 1 })
    expect(refusedMissing).toEqual(refusedForeign)
    expect(refusedGarbage).toEqual(refusedForeign)
    expect(fetchMock, 'модель не вызывалась').not.toHaveBeenCalled()
    expect(JSON.stringify(refusedForeign)).not.toContain('МЕТКА-ЧУЖОЙ-НАБОР')
    // Отказ записан в журнал безопасности как чужая запись; текста вопроса и его номера в журнале нет.
    const log = written.join('')
    expect(log.match(/access_denied_record/g)?.length).toBe(3)
    expect(log).not.toContain('МЕТКА-ЧУЖОЙ-НАБОР')
    expect(log).not.toContain(foreign)
  })

  it('свой вопрос того же действия получает черновик: отказ выше — из-за набора, а не из-за настройки', async () => {
    state.actor = await actorFor(STAFF_MAIN)
    const own = await ask(STUDENT_A, OWN_TEXT)
    const result = await draftAnswerAction(start, form(own))
    expect(result).toEqual({ draft: 'Черновик ответа', error: null, version: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as { messages: { content: string }[] }
    expect(body.messages[1]?.content).toBe(OWN_TEXT)
  })

  it('студент вызвать действие не может: отказ по роли, модель не вызвана', async () => {
    state.actor = await actorFor(STUDENT_A)
    const own = await ask(STUDENT_A, OWN_TEXT)
    await expect(draftAnswerAction(start, form(own))).rejects.toThrow(/NEXT_FORBIDDEN|NEXT_REDIRECT|NEXT_NOT_FOUND/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
