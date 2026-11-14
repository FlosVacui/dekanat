// Шаги заявки (D-2.2-system, 5.8): все 15 сочетаний «статус × вид», отклонение из «Подана» и из «В работе».
// Часовой пояс вуза — Europe/Moscow (UTC+3, летнего времени нет): 07:42 UTC — это 10:42.
import { describe, expect, it } from 'vitest'
import {
  REQUEST_KINDS,
  REQUEST_KIND_INFO,
  REQUEST_STATUSES,
  STEP_STATE_WORDS,
  buildRequestSteps,
  type BuildStepsInput,
  type RequestKind,
  type RequestStatus,
  type RequestStep,
  type StepState,
} from '@/lib/requests'

const TZ = 'Europe/Moscow'
const AT: Record<string, Date> = {
  submitted: new Date('2026-11-11T07:42:00Z'), // 11.11.2026, 10:42
  in_progress: new Date('2026-11-12T06:20:00Z'), // 12.11.2026, 09:20
  ready: new Date('2026-11-13T11:05:00Z'), // 13.11.2026, 14:05
  issued: new Date('2026-11-14T08:00:00Z'),
  rejected: new Date('2026-11-12T06:40:00Z'), // 12.11.2026, 09:40
}
const FLOW: RequestStatus[] = ['submitted', 'in_progress', 'ready', 'issued']

/** Заявка, дошедшая до `status` по обычному пути: в истории все пройденные статусы. */
function input(kind: RequestKind, status: RequestStatus, over: Partial<BuildStepsInput> = {}): BuildStepsInput {
  const reached = status === 'rejected' ? ['submitted'] : FLOW.slice(0, FLOW.indexOf(status) + 1)
  return {
    kind,
    status,
    events: reached.map((s) => ({ status: s, createdAt: AT[s]! })),
    createdAt: AT.submitted!,
    dueDate: '2026-11-16',
    pickupUntil: '2026-11-17',
    issuedOn: '2026-11-14',
    timezone: TZ,
    ...over,
  }
}

const states = (steps: RequestStep[]): StepState[] => steps.map((s) => s.state)
const byKey = (steps: RequestStep[], key: RequestStatus) => steps.find((s) => s.key === key)

const EXPECTED_STATES: Record<Exclude<RequestStatus, 'rejected'>, StepState[]> = {
  submitted: ['now', 'next', 'next', 'next'],
  in_progress: ['done', 'now', 'next_you', 'next'],
  ready: ['done', 'done', 'now', 'next'],
  issued: ['done', 'done', 'done', 'done'],
}

describe('слова состояния шага', () => {
  it('прописными, как в D-2.2-system 5.8', () => {
    expect(STEP_STATE_WORDS).toEqual({
      done: 'СДЕЛАНО',
      now: 'СЕЙЧАС',
      next: 'ДАЛЬШЕ',
      next_you: 'ДАЛЬШЕ — ВАМ',
      rejected: 'ОТКЛОНЕНО',
    })
  })
})

describe.each(REQUEST_KINDS)('шаги заявки: %s', (kind) => {
  const info = REQUEST_KIND_INFO[kind]
  const certificate = kind !== 'financial_aid'

  it.each(['submitted', 'in_progress', 'ready', 'issued'] as const)('статус %s: четыре шага и состояния по таблице', (status) => {
    const steps = buildRequestSteps(input(kind, status))
    expect(steps.map((s) => s.title)).toEqual(['Подана', 'В работе', 'Готова', 'Выдана'])
    expect(states(steps)).toEqual(EXPECTED_STATES[status])
    // aria-current — ровно на одном шаге («сейчас»); у выданной заявки ни на одном.
    expect(steps.filter((s) => s.current).map((s) => s.key)).toEqual(status === 'issued' ? [] : [status])
  })

  it('«Подана»: шаг «Подана» — сейчас, пояснение с днём, временем и словами «Деканат её получил.»; дальше без пояснений', () => {
    const steps = buildRequestSteps(input(kind, 'submitted'))
    expect(byKey(steps, 'submitted')?.note).toBe('11.11.2026, 10:42. Деканат её получил.')
    expect(byKey(steps, 'in_progress')?.note).toBeNull()
    expect(byKey(steps, 'ready')?.note).toBe(certificate ? info.pickup : null)
    expect(byKey(steps, 'issued')?.note).toBeNull()
    expect(steps.every((s) => s.where === null)).toBe(true)
  })

  it('«В работе»: «Срок — до …»; «Готова» — «дальше — вам», строка про получение только у справок', () => {
    const steps = buildRequestSteps(input(kind, 'in_progress'))
    expect(byKey(steps, 'submitted')?.note).toBe('11.11.2026, 10:42. Деканат её получил.')
    expect(byKey(steps, 'in_progress')?.note).toBe('Срок — до 16.11.2026.')
    expect(byKey(steps, 'ready')?.state).toBe('next_you')
    expect(byKey(steps, 'ready')?.note).toBe(certificate ? info.pickup : null)
    expect(byKey(steps, 'issued')?.note).toBeNull()
    expect(steps.every((s) => s.where === null)).toBe(true)
  })

  it('«Готова»: блок «Куда / До какого дня» только на шаге «Готова»; у материальной помощи только «Куда»', () => {
    const steps = buildRequestSteps(input(kind, 'ready'))
    expect(byKey(steps, 'submitted')?.note).toBe('11.11.2026, 10:42. Деканат её получил.')
    expect(byKey(steps, 'in_progress')?.note).toBe('12.11.2026, 09:20.')
    expect(byKey(steps, 'ready')?.note).toBeNull()
    expect(byKey(steps, 'ready')?.where).toEqual({ room: info.room, until: certificate ? '17.11.2026' : null })
    expect(steps.filter((s) => s.where !== null).map((s) => s.key)).toEqual(['ready'])
  })

  it('«Выдана»: все шаги «сделано», блока нет, в «Выдана» — «Вы получили документ …», у материальной помощи — «Заявление закрыто …»', () => {
    const steps = buildRequestSteps(input(kind, 'issued'))
    expect(byKey(steps, 'submitted')?.note).toBe('11.11.2026, 10:42. Деканат её получил.')
    expect(byKey(steps, 'in_progress')?.note).toBe('12.11.2026, 09:20.')
    expect(byKey(steps, 'ready')?.note).toBe('13.11.2026, 14:05.')
    expect(byKey(steps, 'issued')?.note).toBe(
      kind === 'financial_aid' ? 'Заявление закрыто 14.11.2026.' : 'Вы получили документ 14.11.2026.',
    )
    expect(steps.every((s) => s.where === null && !s.current)).toBe(true)
  })

  it('отклонена из «Подана»: «Подана» — сделано, затем один шаг «Отклонена»; непройденных шагов нет', () => {
    const steps = buildRequestSteps({
      ...input(kind, 'rejected'),
      events: [
        { status: 'submitted', createdAt: AT.submitted! },
        { status: 'rejected', createdAt: AT.rejected! },
      ],
    })
    expect(steps.map((s) => s.title)).toEqual(['Подана', 'Отклонена'])
    expect(states(steps)).toEqual(['done', 'rejected'])
    expect(steps[0]?.note).toBe('11.11.2026, 10:42. Деканат её получил.')
    expect(steps[1]?.note).toBe('12.11.2026, 09:40.')
    expect(steps.filter((s) => s.current).map((s) => s.key)).toEqual(['rejected'])
    expect(steps.every((s) => s.where === null)).toBe(true)
  })

  it('отклонена из «В работе»: «Подана» и «В работе» — сделано, затем «Отклонена»', () => {
    const steps = buildRequestSteps({
      ...input(kind, 'rejected'),
      events: [
        { status: 'submitted', createdAt: AT.submitted! },
        { status: 'in_progress', createdAt: AT.in_progress! },
        { status: 'rejected', createdAt: AT.rejected! },
      ],
    })
    expect(steps.map((s) => s.title)).toEqual(['Подана', 'В работе', 'Отклонена'])
    expect(states(steps)).toEqual(['done', 'done', 'rejected'])
    expect(steps[1]?.note).toBe('12.11.2026, 09:20.')
    expect(steps.filter((s) => s.current).map((s) => s.key)).toEqual(['rejected'])
  })
})

describe('шаги заявки: общее', () => {
  it('охвачены все 15 сочетаний «статус × вид»', () => {
    let combos = 0
    for (const kind of REQUEST_KINDS) {
      for (const status of REQUEST_STATUSES) {
        const steps = buildRequestSteps(input(kind, status))
        expect(steps.length, `${status} × ${kind}`).toBeGreaterThan(0)
        // Ни у одной заявки нет двух шагов с aria-current.
        expect(steps.filter((s) => s.current).length).toBeLessThanOrEqual(1)
        combos += 1
      }
    }
    expect(combos).toBe(15)
  })

  it('в «Отклонена» нет шага «В работе», если записи о нём в истории нет', () => {
    const steps = buildRequestSteps({
      ...input('dean_certificate', 'rejected'),
      events: [{ status: 'rejected', createdAt: AT.rejected! }],
    })
    // Подача всегда была (D-2.2-system 5.8): без её записи день берётся из даты подачи заявки.
    expect(steps.map((s) => s.title)).toEqual(['Подана', 'Отклонена'])
    expect(steps[0]?.note).toBe('11.11.2026, 10:42. Деканат её получил.')
  })

  it('пояснения, для которого нет данных, нет: срок и дата выдачи не записаны', () => {
    const steps = buildRequestSteps(input('dean_certificate', 'in_progress', { dueDate: null }))
    expect(byKey(steps, 'in_progress')?.note).toBeNull()
    const issued = buildRequestSteps(input('dean_certificate', 'issued', { issuedOn: null }))
    expect(byKey(issued, 'issued')?.note).toBeNull()
    const ready = buildRequestSteps(input('dean_certificate', 'ready', { pickupUntil: null }))
    expect(byKey(ready, 'ready')?.where).toEqual({ room: '105, 1 корпус', until: null })
  })

  it('день события — по часовому поясу вуза: 22:30 UTC — уже следующий день в Москве', () => {
    const late = new Date('2026-11-11T22:30:00Z')
    const steps = buildRequestSteps(input('dean_certificate', 'submitted', { events: [{ status: 'submitted', createdAt: late }] }))
    expect(byKey(steps, 'submitted')?.note).toBe('12.11.2026, 01:30. Деканат её получил.')
  })

  it('порядок событий не важен: берётся самая ранняя запись статуса', () => {
    const steps = buildRequestSteps(
      input('dean_certificate', 'ready', {
        events: [
          { status: 'ready', createdAt: AT.ready! },
          { status: 'in_progress', createdAt: new Date('2026-11-12T10:00:00Z') },
          { status: 'in_progress', createdAt: AT.in_progress! },
          { status: 'submitted', createdAt: AT.submitted! },
        ],
      }),
    )
    expect(byKey(steps, 'in_progress')?.note).toBe('12.11.2026, 09:20.')
  })
})
