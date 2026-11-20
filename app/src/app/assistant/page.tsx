import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'
import { StudentShell } from '@/components/student-shell'
import { SubmitButton } from '@/components/submit-button'
import { CrisisNumbers } from '@/app/support/crisis-numbers'
import { VoiceInputButton } from '@/components/voice/voice-input-button'
import { itemHref, type RegItem } from '@/lib/regulations/data'
import { ASSISTANT_EXAMPLES, ASSISTANT_QUESTION_MAX, assistantHref, cleanQuestion, escalationHref, excerpt } from '@/lib/regulations/question'
import { isCrisisText } from '@/lib/support/crisis'
import { PSYCH_SERVICE } from '@/lib/support/data'
import { askRegulations, type AssistantAnswer } from '@/server/ai'
import { requireStudentActor } from '@/server/auth/page-guards'

// «Помощник по правилам» (20.11, идея №21): вопрос по вымышленному «Положению о студентах факультета» и ответ с номерами пунктов.
// Форма обычная, метод GET: работает без скриптов, вопрос лежит в адресе (`?q=`). Читает страницу только студент: гость уходит на вход,
// сотрудник получает 403. Вопрос не сохраняется. Ответ строит `askRegulations`: ИИ включён — пересказ по найденным пунктам, нет — сами пункты.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Помощник по правилам' }

function PointLinks({ items }: { items: readonly RegItem[] }) {
  return (
    <ul data-testid="assistant-points" className="m-0 flex list-none flex-wrap gap-x-[var(--sp-3)] p-0">
      {items.map((item) => (
        <li key={item.num}>
          <Link href={itemHref(item.num)} className="inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-md)] font-bold text-primary">
            п. {item.num}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p data-testid="assistant-note" className="m-0 text-[length:var(--fs-xs)] leading-[1.35] text-muted">
      {children}
    </p>
  )
}

// 20.11, поддержка: вместо ответа — карточка с номерами помощи. Текст здесь постоянный: ИИ в этой теме ничего не пишет.
function HelpCard() {
  return (
    <Card>
      <div className="flex flex-col gap-[var(--sp-2)]" data-testid="assistant-help">
        <CardTitle>Похоже, вам сейчас тяжело. Вы не одни</CardTitle>
        <p className="m-0 text-[length:var(--fs-md)] leading-[1.45]">Если плохо прямо сейчас, позвоните:</p>
        <CrisisNumbers />
        <p className="m-0 text-[length:var(--fs-md)] leading-[1.45]">
          <strong>{PSYCH_SERVICE.title}.</strong> {PSYCH_SERVICE.privacy}.
        </p>
        <Link href="/support" data-testid="assistant-help-support" className="inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-md)] font-bold text-primary">
          Открыть страницу «Поддержка»
        </Link>
      </div>
    </Card>
  )
}

function Result({ result }: { result: AssistantAnswer }) {
  if (result.kind === 'answer') {
    return (
      <Card>
        <div className="flex flex-col gap-[var(--sp-2)]" data-testid="assistant-result" data-kind="answer">
          <CardTitle>Ответ</CardTitle>
          <p data-testid="assistant-answer" className="m-0 whitespace-pre-line text-[length:var(--fs-md)] leading-[1.45]">
            {result.answer}
          </p>
          <PointLinks items={result.cited} />
          <Note>Ответ подготовлен ИИ по положению. Проверьте пункт по ссылке</Note>
        </div>
      </Card>
    )
  }
  if (result.kind === 'found') {
    return (
      <Card>
        <div className="flex flex-col gap-[var(--sp-2)]" data-testid="assistant-result" data-kind="found">
          <CardTitle>Вот что нашлось в положении</CardTitle>
          <ul className="m-0 flex list-none flex-col gap-[var(--sp-3)] p-0">
            {result.items.map((item) => (
              <li key={item.num} data-point={item.num} className="flex flex-col gap-0.5">
                <Link href={itemHref(item.num)} className="inline-flex min-h-[var(--tap)] items-center text-[length:var(--fs-md)] font-bold text-primary">
                  п. {item.num}. {item.title}
                </Link>
                <p className="m-0 text-[length:var(--fs-sm)] leading-[1.4]">{excerpt(item.text)}</p>
              </li>
            ))}
          </ul>
          <Note>Подбор по ключевым словам</Note>
        </div>
      </Card>
    )
  }
  return (
    <Card>
      <div className="flex flex-col gap-[var(--sp-2)]" data-testid="assistant-result" data-kind="none">
        <CardTitle>В положении ответа не нашёл</CardTitle>
        <p className="m-0 text-[length:var(--fs-md)] leading-[1.45]">Попробуйте спросить другими словами или задайте вопрос в деканат.</p>
      </div>
    </Card>
  )
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; help?: string | string[] }> }) {
  // Вход проверяется первым: не вошёл — 307 на вход, сотрудник — 403. Границы ожидания нет: форма должна работать без скриптов.
  const actor = await requireStudentActor()
  const { q, help } = await searchParams
  // 20.11, поддержка: тяжёлый вопрос не доходит ни до модели, ни до поиска по положению, ни до «спросить деканат». Переход на адрес без
  // текста вопроса: он не остаётся в адресной строке и истории браузера. Проверяются все значения параметра, не только первое.
  if ((Array.isArray(q) ? q : [q]).some((value) => isCrisisText(value))) redirect('/assistant?help=1')
  const showHelp = help === '1'
  const question = cleanQuestion(Array.isArray(q) ? q[0] : q)
  const result = question ? await askRegulations(question, actor.userId) : null

  return (
    <StudentShell actor={actor} active="assistant">
      <div className="flex flex-col gap-[var(--gap)]">
        <PageTitle>Помощник по правилам</PageTitle>
        <p className="m-0 max-w-[60ch] text-[length:var(--fs-md)] leading-[1.45]">
          Отвечает на вопросы по{' '}
          <Link href="/rules" className="font-bold text-primary">
            положению о студентах факультета
          </Link>{' '}
          и называет пункты. Это учебный пример, не настоящий документ вуза.
        </p>
        {showHelp ? <HelpCard /> : null}
        <form method="get" action="/assistant" className="flex flex-col gap-[var(--gap)]">
          <Card>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="assistant-question" className="text-[length:var(--fs-sm)] font-bold">
                Ваш вопрос
              </label>
              <textarea
                id="assistant-question"
                name="q"
                required
                rows={3}
                maxLength={ASSISTANT_QUESTION_MAX}
                defaultValue={question}
                aria-describedby="assistant-question-hint"
                className="block min-h-[var(--control-h)] w-full resize-y rounded-control border-2 border-border-strong bg-card px-[var(--sp-4)] py-3 text-[length:var(--fs-md)] leading-[1.4] text-text focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
              />
              {/* 20.11, идея №17: голосовой ввод вопроса; в браузере без распознавания речи кнопки нет. */}
              <VoiceInputButton targetId="assistant-question" />
              <p id="assistant-question-hint" className="text-[length:var(--fs-sm)] text-muted">
                До {ASSISTANT_QUESTION_MAX} знаков. Личные данные в вопросе не нужны
              </p>
            </div>
          </Card>
          <SubmitButton>Спросить</SubmitButton>
        </form>

        {!question && !showHelp ? (
          <section aria-labelledby="assistant-examples" className="flex flex-col gap-[var(--sp-1)]">
            <h2 id="assistant-examples" className="text-[length:var(--fs-sm)] font-bold text-muted">
              Например
            </h2>
            <ul className="m-0 flex list-none flex-col gap-[var(--sp-2)] p-0">
              {ASSISTANT_EXAMPLES.map((example) => (
                <li key={example}>
                  <Link
                    href={assistantHref(example)}
                    // Без предзагрузки: страница с вопросом может вызвать модель, а вызовы считаются.
                    prefetch={false}
                    data-example
                    className="flex min-h-[var(--tap)] items-center rounded-surface border border-border bg-card px-[var(--sp-4)] py-[var(--sp-2)] text-[length:var(--fs-md)] font-semibold text-primary"
                  >
                    {example}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {result ? (
          <>
            <Result result={result} />
            <LinkButton href={escalationHref(question)} variant="ghost" data-testid="assistant-escalate">
              Не помогло — спросить деканат
            </LinkButton>
          </>
        ) : null}
      </div>
    </StudentShell>
  )
}
