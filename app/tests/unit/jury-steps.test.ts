// Сценарий для жюри: какой шаг подсвечен по адресу и как читается сохранённое состояние панели. Чистая логика, база не нужна.
import { describe, expect, it } from 'vitest'
import { JURY_STEPS, JURY_STORAGE_KEY, currentJuryStep, juryNeighbours, normalizePath, parseStoredChoice, resolvePanelState } from '../../src/components/jury/steps'

const stepOf = (path: string | null | undefined) => {
  const index = currentJuryStep(path)
  return index === null ? null : JURY_STEPS[index]!.n
}

describe('шаги сценария', () => {
  it('пять шагов с номерами 1–5, адреса по заданию, адреса не повторяются; «Как это сделано» в сценарии нет', () => {
    expect(JURY_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5])
    expect(JURY_STEPS.map((s) => s.href)).toEqual(['/', '/grades', '/requests/new?type=dean_certificate', '/requests', '/staff/requests'])
    expect(new Set(JURY_STEPS.map((s) => s.href)).size).toBe(JURY_STEPS.length)
  })

  it('у каждого шага есть подпись и подсказка, что смотреть; паролей в подсказках нет', () => {
    for (const step of JURY_STEPS) {
      expect(step.label.length).toBeGreaterThan(5)
      expect(step.hint.length).toBeGreaterThan(20)
      expect(step.hint).not.toMatch(/demo-|парол/i)
    }
  })
})

describe('juryNeighbours: кнопки «Назад» и «Далее»', () => {
  it('вне сценария: назад нельзя, «Далее» — шаг 1', () => {
    expect(juryNeighbours(null)).toEqual({ prev: null, next: JURY_STEPS[0] })
  })
  it('первый шаг: назад нельзя, далее — шаг 2', () => {
    expect(juryNeighbours(0)).toEqual({ prev: null, next: JURY_STEPS[1] })
  })
  it('середина: оба соседа', () => {
    expect(juryNeighbours(2)).toEqual({ prev: JURY_STEPS[1], next: JURY_STEPS[3] })
  })
  it('последний шаг: «Далее» нет', () => {
    expect(juryNeighbours(JURY_STEPS.length - 1)).toEqual({ prev: JURY_STEPS[JURY_STEPS.length - 2], next: null })
  })
})

describe('currentJuryStep: шаг по адресу', () => {
  it.each([
    ['/', 1],
    ['/grades', 2],
    ['/requests/new', 3],
    ['/requests', 4],
    ['/staff/requests', 5],
    ['/staff/questions', 5],
    ['/staff', 5],
    ['/staff/students', 5],
    ['/staff/students/9f2c', 5],
    ['/staff/announcements', 5],
  ])('адрес шага %s — шаг %i', (path, n) => {
    expect(stepOf(path)).toBe(n)
  })

  it('вложенные адреса относятся к своему шагу', () => {
    expect(stepOf('/grades/9f2c')).toBe(2)
    expect(stepOf('/requests/9f2c')).toBe(4)
    expect(stepOf('/requests/9f2c/certificate')).toBe(4)
    expect(stepOf('/requests/new/done')).toBe(3)
    expect(stepOf('/staff/requests/9f2c')).toBe(5)
  })

  it('адрес шага 3 со строкой запроса `?type=…` всё равно даёт шаг 3', () => {
    expect(stepOf('/requests/new?type=dean_certificate')).toBe(3)
  })

  it('«/requests/new» — шаг 3, а не 4: побеждает самый длинный адрес', () => {
    expect(stepOf('/requests/new')).toBe(3)
    expect(stepOf('/requests')).toBe(4)
  })

  it('корень совпадает только сам с собой: другие страницы шаг 1 не подсвечивают', () => {
    expect(stepOf('/schedule')).toBeNull()
    expect(stepOf('/notifications')).toBeNull()
    expect(stepOf('/ideas')).toBeNull()
    expect(stepOf('/profile')).toBeNull()
    expect(stepOf('/login')).toBeNull()
  })

  it('адрес, который лишь начинается так же, шаг не даёт', () => {
    expect(stepOf('/gradesheet')).toBeNull()
    expect(stepOf('/requests-archive')).toBeNull()
    expect(stepOf('/processing')).toBeNull()
    // 20.11, блиц: шаг 5 охватывает весь кабинет сотрудника (`also: ['/staff']`); было — `/staff` вне сценария.
    expect(stepOf('/staff')).toBe(5)
    expect(stepOf('/staffing')).toBeNull()
    expect(stepOf('/stafford/requests')).toBeNull()
    expect(stepOf('/staff/questions/1')).toBe(5)
    expect(stepOf('/process')).toBeNull()
  })

  it('строка запроса, якорь и хвостовой слеш не мешают', () => {
    expect(stepOf('/staff/requests?status=overdue&q=%D0%B0')).toBe(5)
    expect(stepOf('/grades/')).toBe(2)
    expect(stepOf('/requests/#top')).toBe(4)
    expect(stepOf('/?x=1')).toBe(1)
  })

  it('нет адреса — нет шага', () => {
    expect(stepOf(null)).toBeNull()
    expect(stepOf(undefined)).toBeNull()
    expect(stepOf('')).toBeNull()
  })
})

describe('normalizePath', () => {
  it('убирает запрос, якорь и хвостовые слеши; корень остаётся корнем', () => {
    expect(normalizePath('/requests/?a=1#b')).toBe('/requests')
    expect(normalizePath('/requests///')).toBe('/requests')
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('')).toBe('/')
    expect(normalizePath('/?a=1')).toBe('/')
  })
})

describe('сохранённое состояние панели и состояние по умолчанию', () => {
  it('parseStoredChoice: только «open» и «closed» — выбор; пусто и мусор — выбора нет', () => {
    expect(parseStoredChoice('closed')).toBe('closed')
    expect(parseStoredChoice('open')).toBe('open')
    for (const bad of [null, undefined, '', 'CLOSED', '{"closed":true}']) expect(parseStoredChoice(bad)).toBeNull()
  })

  it('выбора нет: открыта от 1024 px, свёрнута уже', () => {
    expect(resolvePanelState(null, 1280)).toBe('open')
    expect(resolvePanelState(null, 1024)).toBe('open')
    expect(resolvePanelState(null, 1023)).toBe('closed')
    expect(resolvePanelState(null, 360)).toBe('closed')
  })

  it('сохранённый выбор главнее ширины', () => {
    expect(resolvePanelState('open', 360)).toBe('open')
    expect(resolvePanelState('closed', 1280)).toBe('closed')
  })

  it('ключ хранилища назван по проекту и без личных данных', () => {
    expect(JURY_STORAGE_KEY).toBe('dekanat-jury-panel')
  })
})
