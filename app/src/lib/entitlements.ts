// «Вам положено» на экране «Сегодня» (20.11). Чистая функция: данные и «сегодня» приходят аргументами, базы и часов нет.
// Строка бывает только по правилу, которое есть в вымышленном положении (`regulations/data.ts`), и всегда со ссылкой на пункт.
// Правил три; условия — те же расчёты, что на «Стипендии» и в «Ждёт вас», новых данных нет:
// - повышенная стипендия (п. 3.3): все экзамены прошлой сессии сданы на «отлично» (`evaluateScholarship().excellent`), срок подачи — `raisedWindow`;
// - долг (п. 2.2): неявка на экзамен по уважительной причине долгом не считается, если принести документ за три рабочих дня;
// - материальная помощь (п. 3.5): стипендия не назначена из-за долга или тройки, а открытой заявки на помощь нет.
// Решение о стипендии и помощи принимает комиссия; строка говорит «можно подать», а не «назначено».
import { formatDayMonth } from './dates'
import { findItem, itemHref } from './regulations/data'
import { evaluateScholarship, nextSessionEnd, raisedWindow, type ScholarshipGrade } from './scholarship'

export type EntitlementKind = 'raised_scholarship' | 'debt_valid_reason' | 'financial_aid'

export interface EntitlementRow {
  key: string
  kind: EntitlementKind
  /** Главная строка: что можно сделать. */
  title: string
  /** Пояснение под ней. */
  detail: string
  /** Номер пункта положения, на который опирается строка. */
  point: string
  /** Подпись ссылки на пункт: «п. 3.3. Повышенная стипендия за достижения». */
  pointLabel: string
  /** Адрес пункта в положении: `/rules#p-3-3`. */
  pointHref: string
  /** Куда ведёт кнопка: `/scholarship`, `/grades/<дисциплина>`, `/requests/new?type=financial_aid`. */
  href: string
  /** Глагол кнопки. */
  action: string
}

/** Заявка для правил: вид и статус. */
export interface EntitlementRequest {
  kind: string
  status: string
}

/** Открытая заявка: ещё не выдана и не отклонена. */
const OPEN_STATUSES: readonly string[] = ['submitted', 'in_progress', 'ready']

function pointOf(num: string): { point: string; pointLabel: string; pointHref: string } | null {
  const item = findItem(num)
  return item ? { point: num, pointLabel: `п. ${num}. ${item.title}`, pointHref: itemHref(num) } : null
}

/**
 * Что студенту положено: строки по порядку «повышенная, долг, материальная помощь». Пусто — блока на экране нет.
 * Правило, пункта которого нет в положении, строку не даёт.
 */
export function buildEntitlements(input: {
  grades: readonly ScholarshipGrade[]
  requests: readonly EntitlementRequest[]
  today: string
}): EntitlementRow[] {
  const { grades, requests, today } = input
  const rows: EntitlementRow[] = []
  const status = evaluateScholarship({ grades })

  // Повышенная стипендия: условие по оценкам выполнено. Сессия известна, а срок подачи (10 рабочих дней по п. 3.3) вышел — строки нет.
  const sessionEnd = nextSessionEnd(grades, status.currentSemester)
  const window = raisedWindow(sessionEnd, today)
  const raisedPoint = pointOf('3.3')
  if (status.excellent && raisedPoint && (window !== null || sessionEnd === null)) {
    rows.push({
      key: 'raised',
      kind: 'raised_scholarship',
      title: window ? `Можно подать на повышенную стипендию до ${formatDayMonth(window.deadline)}` : 'Можно подать на повышенную стипендию',
      detail: `Все экзамены сессии ${status.sessionSemester} семестра сданы на «отлично». Заявление и портфолио подаёте в деканат, решение принимает комиссия`,
      ...raisedPoint,
      href: '/scholarship',
      action: 'Открыть «Стипендию»',
    })
  }

  // Долг: п. 2.2 — неявка по уважительной причине долгом не считается.
  const debt = status.blockers.find((b) => b.kind === 'debt')
  const debtPoint = pointOf('2.2')
  if (debt && debtPoint) {
    const names = debt.items.map((i) => `«${i.name}»`).join(', ')
    rows.push({
      key: 'debt',
      kind: 'debt_valid_reason',
      title: 'Можно сдать долг по уважительной причине',
      detail: `Если вы пропустили экзамен по болезни или другой уважительной причине (${names}), принесите документ в деканат в течение трёх рабочих дней после даты экзамена: неявка не будет долгом`,
      ...debtPoint,
      // Пункт положения уже стоит ссылкой в строке; кнопка ведёт к самому долгу: одна дисциплина — на неё, несколько — на «Успеваемость».
      href: debt.items.length === 1 && debt.items[0] ? `/grades/${debt.items[0].disciplineId}` : '/grades',
      action: debt.items.length === 1 ? 'Открыть дисциплину' : 'Открыть успеваемость',
    })
  }

  // Материальная помощь: п. 3.5 — трудная жизненная ситуация. Строка только тем, у кого стипендия не назначена из-за долга или тройки,
  // и пока нет открытой заявки на помощь (иначе она предлагала бы подать вторую).
  const lostStipend = status.blockers.some((b) => b.kind === 'debt' || b.kind === 'three')
  const hasOpenAid = requests.some((r) => r.kind === 'financial_aid' && OPEN_STATUSES.includes(r.status))
  const aidPoint = pointOf('3.5')
  if (lostStipend && !hasOpenAid && aidPoint) {
    rows.push({
      key: 'financial_aid',
      kind: 'financial_aid',
      title: 'Можно подать на материальную помощь',
      detail: 'Если у вас трудная жизненная ситуация: болезнь, рождение ребёнка, пожар, кража, низкий доход семьи. Помощь разовая, не чаще двух раз за учебный год',
      ...aidPoint,
      href: '/requests/new?type=financial_aid',
      action: 'Подать заявление',
    })
  }

  return rows
}
