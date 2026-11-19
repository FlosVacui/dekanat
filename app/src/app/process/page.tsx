import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { JuryPanel } from '@/components/jury/jury-panel'
import { StaffShell } from '@/components/staff-shell'
import { StudentShell } from '@/components/student-shell'
import { getCurrentActor } from '@/server/auth/cookie'
import { getConfig } from '@/server/config'

// «Как это сделано» (идея №90). Страница открыта всем: данных вуза и данных пользователя на ней нет, только факты о проекте.
// Вошедший студент видит её в своей оболочке, сотрудник — в своей, гость — на простой странице со ссылкой «Войти».
// Числа посчитаны один раз по файлам репозитория на 19.11.2026 и записаны текстом: страница ничего не читает ни из базы, ни с диска.
// Как считали — в отчёте исполнителя; при правке файлов репозитория числа обновляются вручную.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Как это сделано' }

const REPO = 'https://github.com/FlosVacui/dekanat/blob/main/'
const COUNTED_ON = '19.11.2026'

const ROLES: { name: string; code: string; what: string }[] = [
  { name: 'Оркестратор', code: 'основная сессия', what: 'план, задания, приёмка, коммиты, учёт, журнал, передача смены' },
  { name: 'Исследователь', code: 'researcher', what: 'ресерч со ссылкой и датой у каждого вывода' },
  { name: 'Дизайнер', code: 'designer', what: 'дизайн-система, экраны, состояния' },
  { name: 'Разработчик', code: 'builder', what: 'функция по заданию вместе с тестами' },
  { name: 'Ревьюер', code: 'reviewer', what: 'ревью кода и документов со свежим контекстом' },
  { name: 'Аудитор безопасности', code: 'security-auditor', what: 'независимая проверка защиты, атакующие тесты' },
  { name: 'Проверка на телефоне', code: 'mobile-qa', what: 'сценарии на 360 и 390 px, снимки, доступность' },
  { name: '«Жюри»', code: 'jury', what: 'оценка по четырём критериям конкурса и что нужно до 10' },
  { name: 'Ревьюер промптов', code: 'prompt-reviewer', what: 'ясность и полнота правил, ролей и заданий' },
  { name: 'Проверка фактов', code: 'fact-checker', what: 'сверка утверждений с журналом, git и реестром' },
  { name: 'Исполнитель прогонов', code: 'runner', what: 'тесты, сборка, линтер, сводка логов' },
]

const AI_ERRORS: { title: string; caught: string }[] = [
  {
    title: 'Ревьюер-субагент написал, что в репозитории нет файла .env.example',
    caught: 'Оркестратор сверил это с git ls-files: файл есть. Субагент его не видел из-за правила доступа, которое написали в той же смене.',
  },
  {
    title: 'Передача смены утверждала, что CONTRIBUTING.md не переписан',
    caught: 'Следующая смена открыла файл и проверила поиском по репозиторию: файл уже переписан. С тех пор утверждение из передачи проверяется по файлу.',
  },
  {
    title: 'Сквозной тест зелёный, но одна из проверок не выполняется ни разу',
    caught: 'Ревьюер пересчитал по плану набора данных и сам замерил зону касания: в нужном состоянии таких карточек нет, проверка шла ноль раз.',
  },
]

const TOOLS_AI = [
  'Claude Code (модели Fable 5.2, Opus 5.5 и Sonnet 5.5)',
  'субагенты Claude Code по ролям',
  'встроенный браузер Claude',
  'WebFetch и WebSearch',
  'Qwen 3.7, режим Deep Research — независимая проверка отчётов',
]
const TOOLS_OTHER = [
  'git, GitHub и gh',
  'uv и pytest',
  'gitleaks и pre-commit',
  'Node.js, Next.js, Drizzle ORM, Vitest, ESLint',
  'Playwright с Chromium',
  'PostgreSQL',
  'Docker и Caddy',
  'OpenSSH',
  'PingWin',
  'Яндекс Формы',
  'pandoc',
]

const FILES: { path: string; what: string }[] = [
  { path: 'docs/PROCESS.md', what: 'как мы работаем: роли, зоны, смены, ворота' },
  { path: 'docs/history/JOURNAL.md', what: 'журнал работ: запись на каждую смену' },
  { path: 'docs/evidence/ai-errors.md', what: 'журнал ошибок ИИ' },
  { path: 'prompts/INDEX.md', what: 'реестр промптов' },
  { path: 'docs/evidence/tools.md', what: 'перечень инструментов' },
]

function Facts({ children }: { children: ReactNode }) {
  return <ul className="m-0 flex list-disc flex-col gap-[var(--sp-1)] pl-[var(--sp-4)] text-[length:var(--fs-md)] leading-[1.45]">{children}</ul>
}

function ProcessContent() {
  return (
    <div className="flex flex-col gap-[var(--sp-3)]">
      <div>
        <PageTitle>Как это сделано</PageTitle>
        <p className="m-0 text-[length:var(--fs-md)] leading-[1.45]">
          Кабинет сделали три студента вместе с ИИ. Ниже — факты о работе. Числа посчитаны по файлам репозитория на {COUNTED_ON}.
        </p>
        <p
          data-testid="repo-note"
          className="mt-[var(--sp-2)] rounded-control bg-primary-soft px-[var(--sp-3)] py-[var(--sp-2)] text-[length:var(--fs-sm)] font-bold"
        >
          Репозиторий откроется 21.11. До этого ссылки на файлы не откроются.
        </p>
      </div>

      <Card>
        <CardTitle>Как работала команда</CardTitle>
        <div className="flex flex-col gap-[var(--sp-2)]">
          <Facts>
            <li>
              Команда — три студента Губкинского университета, участники А, Б и В. Работали сменами: одна смена — одна или несколько записей в журнале.
            </li>
            <li data-testid="fact-journal">
              В журнале на {COUNTED_ON} — <b>69 записей</b>. У 63 из них указана смена: это <b>43 разные смены</b> — 36 основных, со 2-й по 37-ю, и 7 смен участников Б и В.
              Ещё 6 записей без номера смены: первая сессия 10.11 и пять параллельных сессий участника А.
            </li>
            <li>Субагент не коммитит и ничего не публикует. Ревью делает другой агент со свежим контекстом.</li>
          </Facts>
          <h3 className="m-0 mt-[var(--sp-2)] text-[length:var(--fs-md)] font-bold">Роли</h3>
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {ROLES.map((role) => (
              <li key={role.code} className="py-[var(--sp-2)] text-[length:var(--fs-sm)] leading-[1.4] [overflow-wrap:anywhere]">
                <b className="text-[length:var(--fs-md)]">{role.name}</b> <span className="text-muted">({role.code})</span>
                <br />
                {role.what}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <CardTitle>Ошибки ИИ</CardTitle>
        <div className="flex flex-col gap-[var(--sp-2)]">
          <p data-testid="fact-errors" className="m-0 text-[length:var(--fs-md)] leading-[1.45]">
            В журнале ошибок на {COUNTED_ON} — <b>200 записей</b>. Записи не удаляют и не смягчают. Три примера:
          </p>
          <ol className="m-0 flex list-none flex-col gap-[var(--sp-2)] p-0">
            {AI_ERRORS.map((item) => (
              <li key={item.title} className="rounded-control border border-border p-[var(--sp-3)] text-[length:var(--fs-sm)] leading-[1.4] [overflow-wrap:anywhere]">
                <b className="block text-[length:var(--fs-md)] leading-[1.3]">{item.title}</b>
                <span className="mt-1 block">
                  <b>Как поймали.</b> {item.caught}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </Card>

      <Card>
        <CardTitle>Промпты</CardTitle>
        <p data-testid="fact-prompts" className="m-0 text-[length:var(--fs-md)] leading-[1.45]">
          В реестре на {COUNTED_ON} — <b>136 записей</b>: 78 заданий исполнителям, 52 передачи смены, 1 стартовый промпт, 2 промпта самого продукта и 3 запроса во внешнюю нейросеть.
          В реестре только итоговые версии.
        </p>
      </Card>

      <Card>
        <CardTitle>Инструменты</CardTitle>
        <div className="flex flex-col gap-[var(--sp-2)]">
          <p data-testid="fact-tools" className="m-0 text-[length:var(--fs-md)] leading-[1.45]">
            В перечне на {COUNTED_ON} — <b>66 строк</b>: 24 с ИИ и 42 без ИИ. Основные:
          </p>
          <h3 className="m-0 text-[length:var(--fs-md)] font-bold">С ИИ</h3>
          <Facts>
            {TOOLS_AI.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </Facts>
          <h3 className="m-0 text-[length:var(--fs-md)] font-bold">Без ИИ</h3>
          <Facts>
            {TOOLS_OTHER.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </Facts>
        </div>
      </Card>

      <Card>
        <CardTitle>Файлы в репозитории</CardTitle>
        <p className="m-0 mb-[var(--sp-2)] text-[length:var(--fs-sm)] text-muted">Репозиторий откроется 21.11.</p>
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {FILES.map((file) => (
            <li key={file.path} className="py-[var(--sp-2)] text-[length:var(--fs-sm)] leading-[1.4]">
              <a
                href={`${REPO}${file.path}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[var(--tap)] items-center font-bold text-primary underline [overflow-wrap:anywhere]"
              >
                {file.path}
                <span className="sr-only"> (откроется в новой вкладке)</span>
              </a>
              <br />
              {file.what}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

export default async function ProcessPage() {
  const actor = await getCurrentActor()
  if (actor?.role === 'student') {
    return (
      <StudentShell actor={actor} active={null}>
        <ProcessContent />
      </StudentShell>
    )
  }
  if (actor?.role === 'staff') {
    return (
      <StaffShell juryMode={getConfig().juryMode}>
        <ProcessContent />
      </StaffShell>
    )
  }
  // Гость: страница без шапки со знаком, со ссылкой на вход; панель сценария стоит и здесь.
  return (
    <>
      <main className="mx-auto w-full max-w-3xl px-[var(--pad-x)] py-[var(--sp-4)]">
        <ProcessContent />
        <div className="mt-[var(--sp-3)] flex justify-center">
          <Link
            href="/login"
            className="inline-flex min-h-[var(--tap)] items-center justify-center rounded-pill bg-primary-soft px-[var(--sp-4)] text-[length:var(--fs-md)] font-bold text-primary"
          >
            Войти
          </Link>
        </div>
      </main>
      <JuryPanel />
    </>
  )
}
