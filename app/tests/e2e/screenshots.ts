// Снимки экранов на 360 и на 1280 пикселей. Запуск: npm run screenshots.
// Пакет 2.4: каждый экран М0. Пакет 3.1: экран входа с отказами «неверная пара» и «подождите» (login-invalid, login-wait).
// Пакет 3.2: расписание — день с переносом, день с отменой, неделя, пустой день (schedule-day-moved, -cancelled, schedule-week, -empty).
// Пакет 3.3: успеваемость — «Семестр», «Сессия», дисциплина с долгом, дисциплина впереди (grades-semester, grades-session, grades-discipline-debt, grades-discipline-ahead).
// Пакет 3.5: уведомления — лента «Все» (notifications), «Новости и объявления» (notifications-news), «Напоминания» (notifications-reminders), после «Отметить все прочитанными» (notifications-all-read).
// Пакет 3.6: экран «Сегодня» — `today` на 360 и 1280 px (папку задаёт SCREENSHOT_DIR).
// Пакет 3.7: состояние «ошибка» — today-error, schedule-error, staff-requests-error (отказ базы вызывает запрос владельца: отзыв права чтения, helpers/db.ts).
// Пакет 3.7, заход 2: состояние «загрузка» — schedule-loading (границу ожидания `<Suspense>` внутри страницы держит блокировка
// таблицы `lessons`, которую берёт владелец, helpers/db.ts, `holdTableLock`; файлов loading.tsx в пакете нет).
// Редизайн, заход А: «Сегодня» (`today`) и расписание, вид «День» с изменениями (schedule-day-room-teacher, -moved, -cancelled), 360 и 1280 px.
// Снимки кладутся в docs/evidence/screenshots/<дата прогона>-3.3/ (папку можно задать SCREENSHOT_DIR); прежние папки (например, 2026-11-14-3.2) не трогаются.
// Снимать не всё, а часть экранов: SCREENSHOT_ONLY — регулярное выражение по имени снимка без ширины (например, ^grades-). Не задано — снимаются все.
// Имя говорит, что на снимке: 360-schedule-day.png. Неудачный снимок не удаляется: его имя начинается с fail-.
// Данные — вымышленный основной набор (ТР-5, ТР-11). Адрес посетителя шлётся заголовком, как это делает прокси.
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAIN_COHORT } from '../../db/seed-data'
import { todayIn } from '../../src/lib/dates'
import { addressHeaders, freshAddress } from './helpers/address'
import { fillLogin } from './helpers/auth'
import {
  REVOCABLE_TABLES,
  holdPair,
  holdTableLock,
  releaseAllLocks,
  resetFeedToSeed,
  restoreRead,
  revokeRead,
  type RevocableTable,
  type TableLock,
} from './helpers/db'
import { planGrades } from './helpers/grades-plan'
import { dayPath, planSchedule } from './helpers/schedule-plan'
import { BASE_URL, startServer, stopServer } from './helpers/server'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const date = process.env.SCREENSHOT_DATE ?? todayIn('Europe/Moscow')
const outDir = process.env.SCREENSHOT_DIR ?? join(REPO_ROOT, 'docs', 'evidence', 'screenshots', `${date}-3.3`)
const only = process.env.SCREENSHOT_ONLY ? new RegExp(process.env.SCREENSHOT_ONLY) : null

const [student1] = MAIN_COHORT.students
if (!student1) throw new Error('В основном наборе нет студента')
const { login: studentLogin, password: studentPassword } = student1

type Width = 360 | 1280
const WIDTHS: Width[] = [360, 1280]

async function newContext(browser: Browser, width: Width, ip?: string): Promise<BrowserContext> {
  // У каждого контекста свой адрес посетителя: лимиты входа не меняются, а снимки не мешают друг другу.
  const extraHTTPHeaders = addressHeaders(ip)
  return browser.newContext(
    width === 360
      ? { baseURL: BASE_URL, extraHTTPHeaders, viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' }
      : { baseURL: BASE_URL, extraHTTPHeaders, viewport: { width: 1280, height: 800 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' },
  )
}

const schedulePlan = planSchedule(todayIn('Europe/Moscow'))
// Пакет 3.3: дисциплины для снимков ищутся по данным плана набора (состояние), а не по названию или дню недели.
const gradesPlan = planGrades(todayIn('Europe/Moscow'), student1.login)

let failed = 0

function failMissing(name: string, why: string): void {
  failed += 1
  console.error(`FAIL ${name}: ${why}`)
}

/** Нужного дня в данных в этот день запуска нет: снимок не делается, чужой экран под этим именем не снимается. Это не отказ прогона. */
function skipMissing(name: string, why: string): void {
  console.log(`SKIP ${name}: ${why}`)
}

/**
 * Снимок всей страницы. Окно на время снимка растягивается до высоты страницы: так нижняя панель вкладок остаётся
 * внизу, а не повисает посреди снимка, как при fullPage.
 */
async function captureWholePage(page: Page, path: string): Promise<void> {
  const original = page.viewportSize()
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  if (original && height > original.height) await page.setViewportSize({ width: original.width, height })
  try {
    await page.screenshot({ path })
  } finally {
    if (original) await page.setViewportSize(original)
  }
}

async function shoot(page: Page, width: Width, name: string, path: string): Promise<void> {
  if (only && !only.test(name)) return
  try {
    const response = await page.goto(path)
    if (!response || response.status() >= 400) throw new Error(`ответ ${response?.status()} на ${path}`)
    await page.waitForLoadState('networkidle')
    // Горизонтальной прокрутки быть не должно: снимок с ней — неудачный.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) throw new Error(`горизонтальная прокрутка на ${overflow} px`)
    await captureWholePage(page, join(outDir, `${width}-${name}.png`))
    console.log(`ok   ${width}-${name}.png`)
  } catch (error) {
    failed += 1
    await captureWholePage(page, join(outDir, `fail-${width}-${name}.png`)).catch(() => undefined)
    console.error(`FAIL ${width}-${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Снимок страницы в том виде, как она сейчас стоит в браузере (без перехода): экран входа после отказа. */
async function shootCurrent(page: Page, width: Width, name: string, expectedText: RegExp): Promise<void> {
  if (only && !only.test(name)) return
  try {
    const alert = page.locator('form').getByRole('alert')
    await alert.waitFor({ state: 'visible' })
    const text = (await alert.textContent()) ?? ''
    if (!expectedText.test(text)) throw new Error(`на экране «${text}», ждали ${expectedText}`)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) throw new Error(`горизонтальная прокрутка на ${overflow} px`)
    await captureWholePage(page, join(outDir, `${width}-${name}.png`))
    console.log(`ok   ${width}-${name}.png`)
  } catch (error) {
    failed += 1
    await captureWholePage(page, join(outDir, `fail-${width}-${name}.png`)).catch(() => undefined)
    console.error(`FAIL ${width}-${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Снимок состояния «ошибка» (пакет 3.7): у базы отзывается право чтения таблицы, страница открывается, на ней ждём карточку
 * `role="alert"`, снимок, право возвращается в `finally`. Ответ страницы здесь 500, поэтому `shoot` с его проверкой кода не подходит.
 */
async function shootError(page: Page, width: Width, name: string, path: string, table: RevocableTable): Promise<void> {
  if (only && !only.test(name)) return
  try {
    await revokeRead(table)
    await page.goto(path)
    await page.locator('main').getByRole('alert').waitFor({ state: 'visible' })
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) throw new Error(`горизонтальная прокрутка на ${overflow} px`)
    await captureWholePage(page, join(outDir, `${width}-${name}.png`))
    console.log(`ok   ${width}-${name}.png`)
  } catch (error) {
    failed += 1
    await captureWholePage(page, join(outDir, `fail-${width}-${name}.png`)).catch(() => undefined)
    console.error(`FAIL ${width}-${name}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await restoreRead(table)
  }
}

/**
 * Снимок состояния «загрузка» (пакет 3.7, заход 2): владелец блокирует таблицу, которую читает экран, страница открывается,
 * ждём карточку `role="status"` (первую секунду её не видно), снимок, блокировка снимается в `finally`. На время снимка включён запрет
 * на движение: полосы стоят, пульс не попадает в кадр на середине. Анимации не отключаются совсем: иначе строка «Загрузка идёт дольше
 * обычного» (её скрывает анимация на 10 секунд) попала бы на снимок сразу.
 */
async function shootLoading(page: Page, width: Width, name: string, path: string, table: RevocableTable): Promise<void> {
  if (only && !only.test(name)) return
  let lock: TableLock | null = null
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    lock = await holdTableLock(table, 8000)
    await page.goto(path, { waitUntil: 'commit' })
    await page.locator('main [role="status"]').waitFor({ state: 'visible' })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) throw new Error(`горизонтальная прокрутка на ${overflow} px`)
    await page.screenshot({ path: join(outDir, `${width}-${name}.png`) })
    console.log(`ok   ${width}-${name}.png`)
  } catch (error) {
    failed += 1
    await page.screenshot({ path: join(outDir, `fail-${width}-${name}.png`) }).catch(() => undefined)
    console.error(`FAIL ${width}-${name}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await lock?.release()
    await page.emulateMedia({ reducedMotion: null }).catch(() => undefined)
  }
}

async function submitWrongLogin(page: Page, password: string): Promise<void> {
  await fillLogin(page, studentLogin, password)
  const answered = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/login')
  await page.getByRole('button', { name: 'Войти' }).click()
  await answered
  await page.getByRole('button', { name: 'Войти' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => !(document.querySelector('button[type=submit]') as HTMLButtonElement | null)?.disabled)
}

async function loginVia(page: Page, login: string, password: string): Promise<void> {
  await page.goto('/login')
  await fillLogin(page, login, password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await page.waitForURL((url) => url.pathname !== '/login')
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const server = await startServer()
  const browser = await chromium.launch()
  try {
    for (const width of WIDTHS) {
      // Экран входа — без сессии.
      const anon = await newContext(browser, width)
      const anonPage = await anon.newPage()
      await anonPage.goto(`${BASE_URL}/login`)
      await shoot(anonPage, width, 'login', `${BASE_URL}/login`)
      await anon.close()

      // Экран входа с отказами (пакет 3.1): «неверная пара», затем пять неверных подряд и «подождите».
      const refusedIp = freshAddress()
      const refused = await newContext(browser, width, refusedIp)
      const refusedPage = await refused.newPage()
      await refusedPage.goto(`${BASE_URL}/login`)
      await submitWrongLogin(refusedPage, 'неверный-пароль-1')
      await shootCurrent(refusedPage, width, 'login-invalid', /^Неверный логин или пароль$/)
      for (let attempt = 2; attempt <= 5; attempt += 1) await submitWrongLogin(refusedPage, `неверный-пароль-${attempt}`)
      // Ожидание после пятой попытки выставляется запросом к базе: шестая не зависит от того, успеет ли браузер за секунду.
      await holdPair(refusedIp, studentLogin, 30)
      await submitWrongLogin(refusedPage, 'неверный-пароль-6')
      await shootCurrent(refusedPage, width, 'login-wait', /^Слишком много попыток\. Повторите через \d+ с$/)
      await refused.close()

      // Студент.
      const studentContext = await newContext(browser, width)
      const page = await studentContext.newPage()
      await loginVia(page, studentLogin, studentPassword)
      await page.goto(`${BASE_URL}/requests`)
      const firstRequest = await page.locator('a[href^="/requests/"]:not([href^="/requests/new"])').first().getAttribute('href')
      // Пакет 3.6: «Сегодня» на дизайн-системе (снимок `today`). Прочитанность ставится «как после db:seed», чтобы блок «Объявления»
      // был с плашкой «Новых: N», а не пустым; какой блок пуст в день запуска, зависит от набора и дня, и это видно на снимке.
      if (!only || only.test('today')) await resetFeedToSeed(studentLogin)
      await shoot(page, width, 'today', `${BASE_URL}/`)
      await shoot(page, width, 'schedule-day', `${BASE_URL}/schedule`)
      // Пакет 3.2: дни ищутся по данным плана набора, а не по номеру дня недели (helpers/schedule-plan.ts).
      if (schedulePlan.movedSameDay) await shoot(page, width, 'schedule-day-moved', `${BASE_URL}${dayPath(schedulePlan.movedSameDay.date)}`)
      else failMissing('schedule-day-moved', 'в окне нет переноса внутри дня')
      if (schedulePlan.cancelled) await shoot(page, width, 'schedule-day-cancelled', `${BASE_URL}${dayPath(schedulePlan.cancelled.date)}`)
      else failMissing('schedule-day-cancelled', 'в окне нет отменённой пары')
      // Редизайн, заход А (макет М2-Б): смена аудитории и замена преподавателя стоят в одном дне — один снимок на оба; перенос и отмена — снимки выше.
      if (!schedulePlan.roomChanged) failMissing('schedule-day-room-teacher', 'в окне нет смены аудитории')
      else if (!schedulePlan.teacherChanged) failMissing('schedule-day-room-teacher', 'в окне нет замены преподавателя')
      else if (schedulePlan.roomChanged.date !== schedulePlan.teacherChanged.date) {
        failMissing('schedule-day-room-teacher', `смена аудитории (${schedulePlan.roomChanged.date}) и замена преподавателя (${schedulePlan.teacherChanged.date}) в разные дни`)
      } else await shoot(page, width, 'schedule-day-room-teacher', `${BASE_URL}${dayPath(schedulePlan.roomChanged.date)}`)
      await shoot(page, width, 'schedule-week', `${BASE_URL}/schedule?view=week`)
      if (schedulePlan.emptyDate) await shoot(page, width, 'schedule-day-empty', `${BASE_URL}${dayPath(schedulePlan.emptyDate)}`)
      else skipMissing(`${width}-schedule-day-empty`, `в окне семи дней от ${schedulePlan.today} нет дня без пар и переносов; снимок не делается`)
      await shoot(page, width, 'grades-semester', `${BASE_URL}/grades`)
      await shoot(page, width, 'grades-session', `${BASE_URL}/grades?view=session`)
      const debtDiscipline = gradesPlan.rows.find((r) => r.state === 'debt')
      if (debtDiscipline) await shoot(page, width, 'grades-discipline-debt', `${BASE_URL}/grades/${debtDiscipline.id}`)
      else failMissing('grades-discipline-debt', 'у студента нет дисциплины с долгом')
      const aheadDiscipline = gradesPlan.rows.find((r) => r.state === 'admitted' && r.controlKind === 'exam')
      if (aheadDiscipline) await shoot(page, width, 'grades-discipline-ahead', `${BASE_URL}/grades/${aheadDiscipline.id}`)
      else failMissing('grades-discipline-ahead', 'у студента нет экзамена впереди с допуском')
      await shoot(page, width, 'requests', `${BASE_URL}/requests`)
      await shoot(page, width, 'request-new', `${BASE_URL}/requests/new?type=dean_certificate`)
      if (firstRequest) await shoot(page, width, 'request-detail', `${BASE_URL}${firstRequest}`)
      else {
        failed += 1
        console.error('FAIL request-detail: у студента нет заявок')
      }
      await shoot(page, width, 'notifications', `${BASE_URL}/notifications`)
      // Пакет 3.5: лента с фильтрами и после «Отметить все прочитанными». Прочитанность ставится «как после db:seed» до снимков
      // и после них, чтобы остальные снимки и следующие прогоны видели число у колокольчика из набора. Лента «Все» — снимок
      // `notifications` выше. Пустого состояния в основном наборе нет: у обоих студентов в обеих лентах есть записи.
      if (!only || ['notifications-news', 'notifications-reminders', 'notifications-all-read'].some((name) => only.test(name))) {
        await resetFeedToSeed(studentLogin)
        await shoot(page, width, 'notifications-news', `${BASE_URL}/notifications?filter=news`)
        await shoot(page, width, 'notifications-reminders', `${BASE_URL}/notifications?filter=reminders`)
        if (!only || only.test('notifications-all-read')) {
          try {
            await page.goto(`${BASE_URL}/notifications`)
            await page.getByRole('button', { name: 'Отметить все прочитанными', exact: true }).click()
            await page.waitForURL(`${BASE_URL}/notifications`)
            await page.getByText('Непрочитанных: 0', { exact: true }).waitFor({ state: 'visible' })
            await shoot(page, width, 'notifications-all-read', `${BASE_URL}/notifications`)
          } catch (error) {
            failMissing(`${width}-notifications-all-read`, error instanceof Error ? error.message : String(error))
          }
        }
        await resetFeedToSeed(studentLogin)
        skipMissing(`${width}-notifications-empty`, 'в основном наборе у студентов нет пустой ленты и пустого фильтра; данные не меняются, снимок не делается')
      }
      await shoot(page, width, 'profile', `${BASE_URL}/profile`)
      // Пакет 3.7: «ошибка» на «Сегодня» и на расписании. Обе страницы читают таблицу `lessons`.
      await shootError(page, width, 'today-error', `${BASE_URL}/`, 'lessons')
      await shootError(page, width, 'schedule-error', `${BASE_URL}/schedule`, 'lessons')
      // Пакет 3.7, заход 2: «загрузка» на расписании. У «Сегодня» границы ожидания нет: она ломала чужой сквозной тест
      // (tests/e2e/notifications.spec.ts, С-16), страница возвращена к прежнему виду, снимка `today-loading` нет.
      await shootLoading(page, width, 'schedule-loading', `${BASE_URL}/schedule`, 'lessons')
      await studentContext.close()

      // Сотрудник.
      const staffContext = await newContext(browser, width)
      const staffPage = await staffContext.newPage()
      await loginVia(staffPage, MAIN_COHORT.staff.login, MAIN_COHORT.staff.password)
      await shoot(staffPage, width, 'staff-requests', `${BASE_URL}/staff/requests`)
      const links = await staffPage.locator('a[href^="/staff/requests/"]').all()
      let target: string | null = null
      for (const link of links) {
        // Для снимка нужна заявка в статусе «Подана»: у неё видны кнопки перехода.
        if ((await link.innerText()).includes('Статус: Подана')) {
          target = await link.getAttribute('href')
          break
        }
      }
      target ??= (await links[0]?.getAttribute('href')) ?? null
      if (target) await shoot(staffPage, width, 'staff-request-detail', `${BASE_URL}${target}`)
      await shootError(staffPage, width, 'staff-requests-error', `${BASE_URL}/staff/requests`, 'requests')
      await staffContext.close()
    }
  } finally {
    // Право чтения возвращено в `finally` каждого снимка; здесь ещё раз для всех таблиц, на случай обрыва между отзывом и возвратом.
    await releaseAllLocks()
    for (const table of REVOCABLE_TABLES) await restoreRead(table)
    await browser.close()
    await stopServer(server)
  }
  console.log(failed === 0 ? `Готово: ${outDir}` : `Неудачных снимков: ${failed}. Они сохранены с префиксом fail-.`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
