// Блок «следующая пара» на экране «Сегодня»: слова двух состояний на отрисованном компоненте (замечание R-4.6-4, ошибка ИИ 125).
// Компонент отрисовывается в строку, текст берётся из нужного элемента целиком и сравнивается с утверждённым шаблоном, не по подстроке.
// «Сегодня» и «сейчас» приходят аргументами, поэтому тест не зависит от дня недели и часа запуска. База не нужна.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NextLessonBlock } from '../../src/components/today/next-lesson'
import type { ScheduleLesson } from '../../src/lib/schedule'
import { buildToday } from '../../src/lib/today'

// 2026-11-16 — понедельник.
const TODAY = '2026-11-16'
const TOMORROW = '2026-11-17'

function lesson(over: Partial<ScheduleLesson> & { id: string }): ScheduleLesson {
  return {
    date: TODAY,
    startsAt: '10:10',
    endsAt: '11:40',
    discipline: 'Математический анализ',
    kind: 'lecture',
    room: '314',
    teacher: 'Л. А. Примерова',
    change: null,
    ...over,
  }
}

/** Текст элемента без разметки: теги убраны, пробелы по краям — тоже. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

/** Внутренняя часть первого элемента с атрибутом `attr`. */
function inner(html: string, tag: string, attr: string): string {
  const m = new RegExp(`<${tag}[^>]*${attr}[^>]*>(.*?)</${tag}>`, 's').exec(html)
  expect(m, `в разметке нет <${tag} ${attr}>`).not.toBeNull()
  return m![1]!
}

describe('блок «следующая пара»: слова состояний на отрисованном компоненте', () => {
  it('пары сегодня кончились, следующая — завтра: плашка говорит «На сегодня всё: пары закончились»', () => {
    // Сегодня пара была и закончилась в 11:40, сейчас 18:00; следующая — на другой день.
    const view = buildToday([lesson({ id: 'a' }), lesson({ id: 'b', date: TOMORROW })], [], TODAY, '18:00')
    expect(view.todayFinished).toBe(true)
    expect(view.next?.date).toBe(TOMORROW)
    const html = renderToStaticMarkup(createElement(NextLessonBlock, { next: view.next, finished: view.todayFinished }))
    expect(textOf(inner(html, 'p', 'data-testid="day-status"'))).toBe('На сегодня всё: пары закончились')
    // Блок «следующая пара» при этом на месте и называет другой день, а не пустое состояние.
    expect(html).not.toContain('В ближайшие 7 дней пар нет')
    expect(textOf(inner(html, 'h2', 'data-testid="next-date"'))).toBe(view.next?.dateTitle)
  })

  it('пары сегодня ещё идут: плашки «На сегодня всё» нет', () => {
    const view = buildToday([lesson({ id: 'a' }), lesson({ id: 'b', date: TOMORROW })], [], TODAY, '08:00')
    expect(view.todayFinished).toBe(false)
    const html = renderToStaticMarkup(createElement(NextLessonBlock, { next: view.next, finished: view.todayFinished }))
    expect(html).not.toContain('data-testid="day-status"')
    expect(html).not.toContain('На сегодня всё')
  })

  it('следующей пары нет: в блоке одна строка «В ближайшие 7 дней пар нет»', () => {
    const view = buildToday([], [], TODAY, '08:00')
    expect(view.next).toBeNull()
    const html = renderToStaticMarkup(createElement(NextLessonBlock, { next: view.next, finished: view.todayFinished }))
    expect(textOf(inner(html, 'section', 'aria-label="Следующая пара"'))).toBe('В ближайшие 7 дней пар нет')
    expect(html).not.toContain('data-testid="day-status"')
    expect(html).not.toContain('data-testid="next-date"')
  })

  it('пары сегодня кончились и следующей нет: обе строки сразу, каждая своим словом', () => {
    const view = buildToday([lesson({ id: 'a' })], [], TODAY, '18:00')
    expect(view.todayFinished).toBe(true)
    expect(view.next).toBeNull()
    const html = renderToStaticMarkup(createElement(NextLessonBlock, { next: view.next, finished: view.todayFinished }))
    expect(textOf(inner(html, 'p', 'data-testid="day-status"'))).toBe('На сегодня всё: пары закончились')
    expect(textOf(inner(html, 'section', 'aria-label="Следующая пара"'))).toBe('В ближайшие 7 дней пар нет')
  })
})
