// Резервные наборы для жюри (ADR-0003, «Тестовые аккаунты»; черновик данных, раздел 7). Два набора с составом основного:
// те же пары, оценки, заявки и объявления, но свои ФИО, логины, названия групп и названия факультетов. Название группы
// в базе уникально, а объявления адресуются по тексту факультета, поэтому у резерва свои и группы, и факультеты.
// Логины и пароли резервов в git не лежат: их задают переменные окружения (имена — в .env.example, значения — нигде в репозитории).
// Пароль не короче 20 знаков. Ни имя входа, ни пароль не попадают в сообщения об ошибках и в вывод команд.
import type pg from 'pg'
import { MAIN_COHORT } from './seed-data'
import { seedCohort, type CohortSpec } from './seed-lib'

export const MIN_RESERVE_PASSWORD_LENGTH = 20

export interface ReserveDef {
  n: 1 | 2
  cohort: string
  /** В базе имени сотрудника нет (черновик, 2.1); здесь оно только для памяти. */
  staffName: string
  studentNames: [string, string]
  groups: [string, string]
  faculties: [string, string]
}

export const RESERVES: readonly ReserveDef[] = [
  {
    n: 1,
    cohort: 'reserve-1',
    staffName: 'Ермакова Ольга Петровна',
    studentNames: ['Кудрявцев Глеб Олегович', 'Сафина Дарина Ринатовна'],
    groups: ['ПЭ-24-04', 'ПИ-25-02'],
    faculties: ['Факультет прикладной экономики', 'Факультет программной инженерии'],
  },
  {
    n: 2,
    cohort: 'reserve-2',
    staffName: 'Голубев Андрей Викторович',
    studentNames: ['Миронов Егор Ильич', 'Лаптева Ксения Сергеевна'],
    groups: ['ОЭ-24-05', 'ИС-25-03'],
    faculties: ['Факультет отраслевой экономики', 'Факультет информационных систем'],
  },
]

export interface ReserveAccount {
  login: string
  password: string
}

export interface ReserveAccounts {
  staff: ReserveAccount
  students: [ReserveAccount, ReserveAccount]
}

export class ReserveConfigError extends Error {}

/** Имена переменных набора: логин и пароль сотрудника и двух студентов. */
export function reserveEnvNames(n: number): { staff: [string, string]; students: [[string, string], [string, string]] } {
  return {
    staff: [`RESERVE_${n}_STAFF_LOGIN`, `RESERVE_${n}_STAFF_PASSWORD`],
    students: [
      [`RESERVE_${n}_STUDENT_1_LOGIN`, `RESERVE_${n}_STUDENT_1_PASSWORD`],
      [`RESERVE_${n}_STUDENT_2_LOGIN`, `RESERVE_${n}_STUDENT_2_PASSWORD`],
    ],
  }
}

const normalizeLogin = (login: string) => login.trim().toLowerCase()

/**
 * Учётные записи набора из окружения. Нет переменной или пароль короче 20 знаков — `ReserveConfigError` с именами
 * переменных; значений в сообщении нет. Логины внутри набора не повторяются и не совпадают с логинами основного набора.
 */
export function readReserveAccounts(env: Readonly<Record<string, string | undefined>>, n: number): ReserveAccounts {
  const names = reserveEnvNames(n)
  const problems: string[] = []
  const read = ([loginName, passwordName]: [string, string]): ReserveAccount => {
    const login = normalizeLogin(env[loginName] ?? '')
    const password = env[passwordName] ?? ''
    if (!login) problems.push(`${loginName}: не задана`)
    else if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(login)) problems.push(`${loginName}: логин из латинских букв, цифр, точки, дефиса и подчёркивания, 3–64 знака`)
    if (!password) problems.push(`${passwordName}: не задана`)
    else if ([...password].length < MIN_RESERVE_PASSWORD_LENGTH) problems.push(`${passwordName}: короче ${MIN_RESERVE_PASSWORD_LENGTH} знаков`)
    return { login, password }
  }
  const staff = read(names.staff)
  const students: [ReserveAccount, ReserveAccount] = [read(names.students[0]), read(names.students[1])]
  const logins = [staff.login, ...students.map((s) => s.login)].filter(Boolean)
  if (new Set(logins).size !== logins.length) problems.push(`набор ${n}: логины внутри набора должны различаться`)
  const mainLogins = new Set([MAIN_COHORT.staff.login, ...MAIN_COHORT.students.map((s) => s.login)].map(normalizeLogin))
  if (logins.some((l) => mainLogins.has(l))) problems.push(`набор ${n}: логин совпадает с логином основного набора`)
  if (problems.length > 0) throw new ReserveConfigError(`Резервный набор ${n}: ${problems.join('; ')}`)
  return { staff, students }
}

/** Все выбранные наборы сразу: до записи в базу проверены все, и логины не повторяются между наборами. */
export function readReserveSets(
  env: Readonly<Record<string, string | undefined>>,
  numbers: readonly number[],
): { def: ReserveDef; accounts: ReserveAccounts }[] {
  const errors: string[] = []
  const sets: { def: ReserveDef; accounts: ReserveAccounts }[] = []
  for (const n of numbers) {
    const def = RESERVES.find((r) => r.n === n)
    if (!def) {
      errors.push(`Набора резерва ${n} нет: есть ${RESERVES.map((r) => r.n).join(' и ')}`)
      continue
    }
    try {
      sets.push({ def, accounts: readReserveAccounts(env, n) })
    } catch (error) {
      if (!(error instanceof ReserveConfigError)) throw error
      errors.push(error.message)
    }
  }
  const all = sets.flatMap((s) => [s.accounts.staff.login, ...s.accounts.students.map((a) => a.login)])
  if (new Set(all).size !== all.length) errors.push('Логины разных резервных наборов должны различаться')
  if (errors.length > 0) throw new ReserveConfigError(errors.join('\n'))
  return sets
}

function mapStrings<T>(value: T, replace: (s: string) => string): T {
  if (typeof value === 'string') return replace(value) as T
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, replace)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, replace)])) as T
  }
  return value
}

/** Набор резерва из основного: другие ФИО, логины, названия групп и факультетов — в том числе в адресатах и текстах объявлений. */
export function buildReserveCohort(main: CohortSpec, def: ReserveDef, accounts: ReserveAccounts): CohortSpec {
  const pairs: [string, string][] = []
  main.groups.forEach((g, i) => {
    pairs.push([g.faculty, def.faculties[i]!], [g.name, def.groups[i]!])
  })
  main.students.forEach((s, i) => {
    pairs.push([s.fullName, def.studentNames[i]!], [s.login, accounts.students[i]!.login])
  })
  pairs.push([main.staff.login, accounts.staff.login])
  // Длинные названия первыми: короткое не должно портить длинное.
  pairs.sort((a, b) => b[0].length - a[0].length)
  const replace = (text: string) => pairs.reduce((acc, [from, to]) => acc.split(from).join(to), text)

  const spec = mapStrings(structuredClone(main), replace)
  spec.cohort = def.cohort
  spec.passwordPublished = false
  spec.staff = { login: accounts.staff.login, password: accounts.staff.password }
  spec.students.forEach((s, i) => {
    s.login = accounts.students[i]!.login
    s.password = accounts.students[i]!.password
    s.fullName = def.studentNames[i]!
    // Метки резервам не нужны: тесты с ними не работают (черновик, раздел 7).
    s.markers = { profile: def.studentNames[i]!.split(' ')[0]!, schedule: '—', grades: '—', requests: '—', notifications: '—' }
  })
  return spec
}

/** Заполнение резервов: записывает наборы, счётчики входа не сбрасывает, основной набор не трогает. */
export async function seedReserves(
  client: pg.Client | pg.PoolClient,
  sets: { def: ReserveDef; accounts: ReserveAccounts }[],
  today: string,
  timezone?: string,
): Promise<void> {
  for (const { def, accounts } of sets) {
    await seedCohort(client, buildReserveCohort(MAIN_COHORT, def, accounts), today, { mode: 'full', resetLoginCounters: false, timezone })
  }
}

/** Резерв, который есть в базе, но не освежён: набор и причина. Причина называет переменные, значений в ней нет. */
export interface SkippedReserve {
  n: number
  cohort: string
  reason: string
}

export interface RefreshReservesReport {
  /** Номера освежённых наборов. */
  refreshed: number[]
  /** Резервы в базе, пропущенные из-за переменных окружения. Резерва, которого в базе нет, здесь нет: освежать нечего. */
  skipped: SkippedReserve[]
}

/**
 * «Освежить» резервы, которые уже есть в базе и чьи переменные заданы. Набора в базе нет — он пропускается без сообщения:
 * освежение учётных записей не создаёт. Есть в базе, а переменных нет или они не подходят — набор пропускается, но попадает
 * в `skipped`: ночной запуск не должен молча оставлять резервы со старыми датами.
 */
export async function refreshReservesReport(
  client: pg.Client | pg.PoolClient,
  env: Readonly<Record<string, string | undefined>>,
  today: string,
  timezone?: string,
): Promise<RefreshReservesReport> {
  const report: RefreshReservesReport = { refreshed: [], skipped: [] }
  for (const def of RESERVES) {
    const present = await client.query(`SELECT 1 FROM users WHERE cohort = $1 LIMIT 1`, [def.cohort])
    if (present.rowCount === 0) continue
    let accounts: ReserveAccounts
    try {
      accounts = readReserveAccounts(env, def.n)
    } catch (error) {
      if (error instanceof ReserveConfigError) {
        // Сообщение ошибки — имена переменных и что с ними не так, значений в нём нет (тест seed-cohort.test.ts).
        report.skipped.push({ n: def.n, cohort: def.cohort, reason: error.message.replace(/^Резервный набор \d+: /, '') })
        continue
      }
      throw error
    }
    await seedCohort(client, buildReserveCohort(MAIN_COHORT, def, accounts), today, { mode: 'refresh', timezone })
    report.refreshed.push(def.n)
  }
  return report
}

/** Номера освежённых наборов; о пропущенных молчит — для вывода команды есть `refreshReservesReport`. */
export async function refreshReserves(
  client: pg.Client | pg.PoolClient,
  env: Readonly<Record<string, string | undefined>>,
  today: string,
  timezone?: string,
): Promise<number[]> {
  return (await refreshReservesReport(client, env, today, timezone)).refreshed
}

/** По строке на каждый пропущенный резерв: имя набора и причина. */
export function describeSkippedReserves(skipped: readonly SkippedReserve[]): string[] {
  return skipped.map((s) => `Резерв «${s.cohort}» есть в базе, но не освежён — переменные окружения: ${s.reason}.`)
}

/** Что команда `db:seed:reserve` сообщает после записи: повторный запуск возвращает резерв к исходному состоянию. */
export const RESERVE_RERUN_NOTE =
  'Повторный запуск возвращает резерв к исходному состоянию: заявки, их историю и уведомления, созданные под аккаунтами резерва, он стирает. ' +
  'Чтобы только перенести даты на сегодня и ничего не стирать, нужна команда db:refresh.'
