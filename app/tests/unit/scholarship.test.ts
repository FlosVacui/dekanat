// Стипендия (20.11): правило назначения по п. 3.1–3.2 положения, выплаты по месяцам, срок подачи на повышенную по п. 3.3.
// Выдуманные оценки, «сегодня» — аргумент: база не нужна. Все ветки правила и все границы месяцев.
import { describe, expect, it } from 'vitest'
import { findItem } from '../../src/lib/regulations/data'
import {
  PAYMENT_DAY,
  PREVIOUS_SESSION_END,
  RAISED_QUESTION_TEXT,
  SAMPLE_NOTE,
  SCHOLARSHIP_ORDER,
  TERM_END,
  buildPayouts,
  buildTodo,
  currentSemesterOf,
  dayWithWeekday,
  describeStatus,
  evaluateScholarship,
  firstOfNextMonth,
  formatRub,
  monthLabel,
  nextSessionEnd,
  raisedQuestionHref,
  raisedWindow,
  sessionSemesterOf,
  type ScholarshipGrade,
} from '../../src/lib/scholarship'

const TODAY = '2026-11-20' // пятница

function grade(name: string, outcome: string, patch: Partial<ScholarshipGrade> = {}): ScholarshipGrade {
  return {
    disciplineId: `id-${name}`,
    name,
    controlKind: outcome === 'credit' || outcome === 'no_credit' ? 'credit' : 'exam',
    outcome,
    points: 70,
    admitted: true,
    examDate: null,
    semester: 4,
    ...patch,
  }
}

/** Текущий семестр 5: дисциплины «впереди»; прошлый семестр 4 — то, что передали. */
function withCurrent(previous: ScholarshipGrade[]): ScholarshipGrade[] {
  return [
    grade('Микроэкономика', 'pending', { semester: 5, examDate: '2026-12-29' }),
    grade('Корпоративные финансы', 'pending', { semester: 5, examDate: '2027-01-13' }),
    ...previous,
  ]
}

describe('формат суммы', () => {
  it('«4 500 ₽»: разряды и знак через неразрывный пробел', () => {
    expect(formatRub(4500)).toBe('4 500 ₽')
    expect(formatRub(4500).replace(/ /g, ' ')).toBe('4 500 ₽')
    expect(formatRub(12000).replace(/ /g, ' ')).toBe('12 000 ₽')
    expect(formatRub(0).replace(/ /g, ' ')).toBe('0 ₽')
    expect(formatRub(950).replace(/ /g, ' ')).toBe('950 ₽')
    expect(formatRub(1234567).replace(/ /g, ' ')).toBe('1 234 567 ₽')
  })
})

describe('приказ о размерах', () => {
  it('три суммы в рублях, повышенная больше академической; пометка «пример для прототипа»', () => {
    expect(SCHOLARSHIP_ORDER.academic).toBeGreaterThan(0)
    expect(SCHOLARSHIP_ORDER.raised).toBeGreaterThan(SCHOLARSHIP_ORDER.academic)
    expect(SCHOLARSHIP_ORDER.social).toBeGreaterThan(0)
    expect(SAMPLE_NOTE).toBe('Суммы — пример для прототипа')
  })

  it('выплата — 25 число, как в п. 3.7 положения; пункт стоит в конце раздела 3', () => {
    expect(PAYMENT_DAY).toBe(25)
    const item = findItem('3.7')
    expect(item?.section).toBe('3')
    expect(item?.text).toContain('25 числа')
    // Прежние номера 3.1–3.6 на месте.
    expect(findItem('3.6')?.title).toMatch(/материальную помощь/)
    expect(findItem('3.2')?.title).toMatch(/академическая/i)
  })
})

describe('семестры', () => {
  it('текущий — самый поздний; прошлая сессия — самый поздний до него, где есть итог', () => {
    const grades = withCurrent([grade('Статистика', '4'), grade('Старая', '5', { semester: 2 })])
    expect(currentSemesterOf(grades)).toBe(5)
    expect(sessionSemesterOf(grades, 5)).toBe(4)
  })

  it('семестр без итогов (все «впереди») не считается сессией; нет дисциплин — нет семестров', () => {
    const grades = [grade('Х', 'pending', { semester: 4 }), grade('Старая', '5', { semester: 2 }), grade('Сейчас', 'pending', { semester: 5 })]
    expect(sessionSemesterOf(grades, 5)).toBe(2)
    expect(currentSemesterOf([])).toBeNull()
    expect(sessionSemesterOf([], null)).toBeNull()
  })
})

describe('назначение: п. 3.1–3.2', () => {
  it('сессия без троек и долгов, бюджет — «Назначена академическая»', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('Статистика', '4'), grade('Эконометрика', '5'), grade('Маркетинг', 'credit')]) })
    expect(status).toMatchObject({ kind: 'academic', currentSemester: 5, sessionSemester: 4, blockers: [], excellent: false })
    expect(describeStatus(status)).toMatchObject({ title: 'Назначена академическая', point: '3.2', tone: 'ok' })
    expect(describeStatus(status).text).toContain('4 семестра')
  })

  it('долг: «2» на экзамене — не назначена, причина «есть долг», дисциплина названа', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('Статистика', '4'), grade('Эконометрика', '2', { examDate: '2026-11-24' })]) })
    expect(status.kind).toBe('none')
    expect(status.blockers.map((b) => b.kind)).toEqual(['debt'])
    expect(status.blockers[0]?.items).toEqual([{ disciplineId: 'id-Эконометрика', name: 'Эконометрика', examDate: '2026-11-24' }])
    const view = describeStatus(status)
    expect(view).toMatchObject({ title: 'Не назначена: есть долг', point: '3.2', tone: 'err' })
    expect(view.text).toContain('«Эконометрика»')
  })

  it('долг по зачёту («не зачтено») — тоже долг', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('Маркетинг', 'no_credit')]) })
    expect(status.blockers[0]?.kind).toBe('debt')
  })

  it('долг прошлых семестров считается: стипендия не назначается, пока он не закрыт', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('Статистика', '4'), grade('Старый долг', '2', { semester: 3 })]) })
    expect(status.blockers.map((b) => b.kind)).toEqual(['debt'])
  })

  it('тройка в прошлой сессии — не назначена, причина «тройка», пункт 3.2', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('Статистика', '3'), grade('Маркетинг', 'credit')]) })
    expect(status.kind).toBe('none')
    expect(status.blockers.map((b) => b.kind)).toEqual(['three'])
    expect(describeStatus(status)).toMatchObject({ title: 'Не назначена: в прошлой сессии есть тройка', point: '3.2' })
    expect(describeStatus(status).text).toContain('«Статистика»')
  })

  it('тройка из позапрошлой сессии не мешает: считается только последняя сессия', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('Статистика', '5'), grade('Давняя тройка', '3', { semester: 3 })]) })
    expect(status.kind).toBe('academic')
  })

  it('долг и тройка вместе: первой причиной стоит долг, обе в списке', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('Статистика', '3'), grade('Эконометрика', '2')]) })
    expect(status.blockers.map((b) => b.kind)).toEqual(['debt', 'three'])
    expect(describeStatus(status).title).toBe('Не назначена: есть долг')
  })

  it('платная основа — не назначена, причина «платная основа», пункт 3.1; оценки не важны', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('Статистика', '5'), grade('Эконометрика', '5')]), basis: 'paid' })
    expect(status).toMatchObject({ kind: 'none', excellent: false })
    expect(status.blockers.map((b) => b.kind)).toEqual(['paid_basis'])
    expect(describeStatus(status)).toMatchObject({ title: 'Не назначена: платная основа обучения', point: '3.1' })
    // Бюджет, указанный явно, ведёт себя как умолчание.
    expect(evaluateScholarship({ grades: withCurrent([grade('Статистика', '5')]), basis: 'budget' }).kind).toBe('academic')
  })

  it('итогов прошлой сессии нет — не назначена: назначать не по чему', () => {
    const status = evaluateScholarship({ grades: [grade('Микроэкономика', 'pending', { semester: 1 })] })
    expect(status.kind).toBe('none')
    expect(status.sessionSemester).toBeNull()
    expect(status.blockers.map((b) => b.kind)).toEqual(['no_results'])
    expect(describeStatus(status).title).toBe('Не назначена: нет итогов прошлой сессии')
    expect(evaluateScholarship({ grades: [] }).kind).toBe('none')
  })

  it('«отлично»: все экзамены прошлой сессии на 5 (зачёты не мешают) — условие по оценкам для повышенной выполнено', () => {
    const excellent = evaluateScholarship({ grades: withCurrent([grade('А', '5'), grade('Б', '5'), grade('В', 'credit')]) })
    expect(excellent.excellent).toBe(true)
    // Одна четвёрка — уже нет.
    expect(evaluateScholarship({ grades: withCurrent([grade('А', '5'), grade('Б', '4')]) }).excellent).toBe(false)
    // Только зачёты — экзаменов нет, «отлично» не из чего.
    expect(evaluateScholarship({ grades: withCurrent([grade('В', 'credit')]) }).excellent).toBe(false)
    // Не назначена — не «отлично».
    expect(evaluateScholarship({ grades: withCurrent([grade('А', '5'), grade('Б', '2')]) }).excellent).toBe(false)
  })

  it('повышенную функция не назначает: даже при всех «5» вид стипендии — академическая', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('А', '5'), grade('Б', '5')]) })
    expect(describeStatus(status).title).toBe('Назначена академическая')
  })
})

describe('что сделать', () => {
  const ctx = { today: TODAY, sessionEnd: '2027-01-13' }

  it('назначена или платная основа — делать нечего', () => {
    expect(buildTodo(evaluateScholarship({ grades: withCurrent([grade('А', '4')]) }), ctx)).toEqual([])
    expect(buildTodo(evaluateScholarship({ grades: withCurrent([grade('А', '4')]), basis: 'paid' }), ctx)).toEqual([])
  })

  it('долг: строка со ссылкой на дисциплину и датой пересдачи, затем — сдать следующую сессию, дата её конца', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('Эконометрика', '2', { examDate: '2026-11-24' })]) })
    expect(buildTodo(status, ctx)).toEqual([
      { text: 'Закрыть долг по «Эконометрика»: пересдача 24 ноября', href: '/grades/id-Эконометрика' },
      { text: 'Сдать ближайшую сессию без троек и без долгов — она кончается 13 января', href: null },
    ])
  })

  it('дата пересдачи не назначена или прошла — сказано словами', () => {
    const none = buildTodo(evaluateScholarship({ grades: withCurrent([grade('Без даты', '2')]) }), ctx)
    expect(none[0]?.text).toBe('Закрыть долг по «Без даты»: дата пересдачи не назначена')
    const past = buildTodo(evaluateScholarship({ grades: withCurrent([grade('Прошла', '2', { examDate: '2026-11-10' })]) }), ctx)
    expect(past[0]?.text).toBe('Закрыть долг по «Прошла»: пересдача была 10 ноября, новую дату назначит кафедра')
  })

  it('два долга — две строки по порядку дат; тройка и нет дат сессии — одна общая строка без числа', () => {
    const two = buildTodo(
      evaluateScholarship({ grades: withCurrent([grade('Б', '2', { examDate: '2026-11-26' }), grade('А', '2', { examDate: '2026-11-24' })]) }),
      { today: TODAY, sessionEnd: null },
    )
    expect(two.map((l) => l.text)).toEqual([
      'Закрыть долг по «А»: пересдача 24 ноября',
      'Закрыть долг по «Б»: пересдача 26 ноября',
      'Сдать ближайшую сессию без троек и без долгов',
    ])
    const three = buildTodo(evaluateScholarship({ grades: withCurrent([grade('Статистика', '3')]) }), ctx)
    expect(three).toEqual([{ text: 'Сдать ближайшую сессию без троек и без долгов — она кончается 13 января', href: null }])
  })

  it('сессия уже кончилась — даты в строке нет', () => {
    const status = evaluateScholarship({ grades: withCurrent([grade('Статистика', '3')]) })
    expect(buildTodo(status, { today: TODAY, sessionEnd: '2026-06-30' })[0]?.text).toBe('Сдать ближайшую сессию без троек и без долгов')
  })

  it('конец ближайшей сессии — самая поздняя дата контроля текущего семестра', () => {
    const grades = withCurrent([grade('Пересдача', '2', { examDate: '2027-03-01' })])
    expect(nextSessionEnd(grades, 5)).toBe('2027-01-13')
    expect(nextSessionEnd([grade('Х', 'pending', { semester: 5 })], 5)).toBeNull()
    expect(nextSessionEnd(grades, null)).toBeNull()
  })
})

describe('даты и месяцы', () => {
  it('первое число следующего месяца, в том числе через границу года', () => {
    expect(firstOfNextMonth('2026-08-31')).toBe('2026-09-01')
    expect(firstOfNextMonth('2026-12-15')).toBe('2027-01-01')
    expect(firstOfNextMonth('2027-02-01')).toBe('2027-03-01')
  })

  it('начало выплаты — первое число месяца после конца прошлой сессии (п. 3.2)', () => {
    expect(firstOfNextMonth(PREVIOUS_SESSION_END)).toBe('2026-09-01')
  })

  it('подписи: месяц и день с днём недели', () => {
    expect(monthLabel('2026-09')).toBe('Сентябрь 2026')
    expect(monthLabel('2027-01')).toBe('Январь 2027')
    expect(dayWithWeekday('2026-11-25')).toBe('25 ноября, ср')
  })
})

describe('выплаты по месяцам', () => {
  const base = { payFrom: '2026-09-01', termEnd: TERM_END, amount: 4500 }

  it('20 ноября: сентябрь и октябрь выплачены, ноябрь ожидается; ближайшая — 25 ноября; новые сверху', () => {
    const plan = buildPayouts({ ...base, today: '2026-11-20' })
    expect(plan.history.map((p) => [p.month, p.date, p.state])).toEqual([
      ['2026-11', '2026-11-25', 'planned'],
      ['2026-10', '2026-10-25', 'paid'],
      ['2026-09', '2026-09-25', 'paid'],
    ])
    expect(plan.history[0]?.label).toBe('Ноябрь 2026')
    expect(plan.next).toEqual({ date: '2026-11-25', amount: 4500 })
    expect(plan.paidTotal).toBe(9000)
  })

  it('25 числа выплата сегодня: ещё «ожидается» и ближайшая — сегодня; 26 числа — выплачено, ближайшая в следующем месяце', () => {
    const on = buildPayouts({ ...base, today: '2026-11-25' })
    expect(on.history[0]).toMatchObject({ month: '2026-11', state: 'planned' })
    expect(on.next?.date).toBe('2026-11-25')
    const after = buildPayouts({ ...base, today: '2026-11-26' })
    expect(after.history[0]).toMatchObject({ month: '2026-11', state: 'paid' })
    expect(after.next?.date).toBe('2026-12-25')
    expect(after.paidTotal).toBe(13500)
  })

  it('граница года: в январе история идёт с сентября; декабрьская выплата — через год', () => {
    const jan = buildPayouts({ ...base, today: '2027-01-10' })
    expect(jan.history.map((p) => p.month)).toEqual(['2027-01', '2026-12', '2026-11', '2026-10', '2026-09'])
    expect(jan.next?.date).toBe('2027-01-25')
    const dec = buildPayouts({ ...base, today: '2026-12-31' })
    expect(dec.next?.date).toBe('2027-01-25')
  })

  it('начало выплаты ещё впереди: истории нет, ближайшая — первая', () => {
    const plan = buildPayouts({ ...base, today: '2026-08-20' })
    expect(plan.history).toEqual([])
    expect(plan.next?.date).toBe('2026-09-25')
    expect(plan.paidTotal).toBe(0)
  })

  it('семестр кончился: история до последнего месяца, ближайшей выплаты нет', () => {
    const plan = buildPayouts({ ...base, today: '2027-02-10' })
    expect(plan.next).toBeNull()
    // Последний месяц выплаты — январь: февраля в истории нет.
    expect(plan.history[0]?.month).toBe('2027-01')
    expect(plan.history.map((p) => p.month)).not.toContain('2027-02')
    expect(plan.history.every((p) => p.state === 'paid')).toBe(true)
  })

  it('сумма — любая переданная (академическая или повышенная): ни одна не зашита в расчёт', () => {
    const plan = buildPayouts({ ...base, amount: SCHOLARSHIP_ORDER.raised, today: '2026-10-30' })
    expect(plan.history.map((p) => p.amount)).toEqual([SCHOLARSHIP_ORDER.raised, SCHOLARSHIP_ORDER.raised])
    expect(plan.paidTotal).toBe(SCHOLARSHIP_ORDER.raised * 2)
  })
})

describe('повышенная: п. 3.3', () => {
  it('срок подачи — 10 рабочих дней после последнего экзамена, решение — ещё 10 рабочих дней', () => {
    // 13 января 2027 — среда; +10 рабочих — 27 января; ещё +10 — 10 февраля.
    expect(raisedWindow('2027-01-13', TODAY)).toEqual({ lastExam: '2027-01-13', deadline: '2027-01-27', decisionBy: '2027-02-10' })
  })

  it('дат экзаменов нет или срок вышел — окна нет, на экране остаётся общее правило', () => {
    expect(raisedWindow(null, TODAY)).toBeNull()
    expect(raisedWindow('2026-06-30', TODAY)).toBeNull()
  })

  it('последний день срока ещё в окне', () => {
    expect(raisedWindow('2026-11-06', '2026-11-20')?.deadline).toBe('2026-11-20')
    expect(raisedWindow('2026-11-06', '2026-11-21')).toBeNull()
  })

  it('отдельного вида заявки нет: ссылка ведёт в «Вопрос в деканат» с подставленным текстом, он влезает в предел вопроса', () => {
    const href = raisedQuestionHref()
    expect(href.startsWith('/questions/new?text=')).toBe(true)
    expect(decodeURIComponent(href.slice('/questions/new?text='.length))).toBe(RAISED_QUESTION_TEXT)
    expect(RAISED_QUESTION_TEXT).toContain('повышенную')
    expect(Array.from(RAISED_QUESTION_TEXT).length).toBeLessThanOrEqual(1000)
  })
})
