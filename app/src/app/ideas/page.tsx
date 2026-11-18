import type { ReactNode } from 'react'
import { PageTitle } from '@/components/card'
import { IdeaCard } from '@/components/ideas/idea-card'
import { StudentShell } from '@/components/student-shell'
import { requireStudentActor } from '@/server/auth/page-guards'

// «Идеи и планы» (макет М6): что команда добавила бы в кабинет при большем сроке. Только для студента: гость уходит на вход,
// сотрудник получает отказ, как на других страницах студента (решение участника А, DECISIONS смена 36). Данных страница не читает,
// кроме каркаса; тексты — в коде. В карточках нет ссылок и кнопок: это планы, а не работающие функции.
export const dynamic = 'force-dynamic'

const IDEAS: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: (
      <>
        <path d="M4 5h16v11H10l-4 4v-4H4z" />
        <path d="M8 10h8" />
      </>
    ),
    title: 'Помощник по правилам деканата',
    text: 'Отвечает на частые вопросы по положениям вуза и подсказывает, куда обратиться',
  },
  {
    icon: (
      <>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v4h4" />
        <path d="M12.5 17v-5M10 14l2.5-2.5L15 14" />
      </>
    ),
    title: 'Сдача работ в кабинете',
    text: 'Файл отчёта прямо на странице предмета, статус проверки и баллы от преподавателя',
  },
  {
    icon: (
      <>
        <path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15z" />
        <path d="M10 21.5h4" />
      </>
    ),
    title: 'Напоминания по времени',
    text: 'За день до срока работы и утром в день экзамена — в ленте и на телефоне',
  },
  {
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01" />
      </>
    ),
    title: 'Спросить деканат',
    text: 'Вопрос сотруднику по теме и ответ в том же кабинете',
  },
]

export default async function IdeasPage() {
  const actor = await requireStudentActor()
  return (
    <StudentShell actor={actor} active="ideas">
      <PageTitle>Идеи и планы</PageTitle>
      <p className="mb-[var(--gap)] max-w-[60ch] text-[length:var(--fs-md)] leading-[1.45]">
        Что мы добавили бы в кабинет, будь у нас больше времени. Это планы, а не работающие функции
      </p>
      <ul className="m-0 grid list-none grid-cols-1 gap-[var(--gap)] p-0 lg:grid-cols-2">
        {IDEAS.map((idea) => (
          <li key={idea.title}>
            <IdeaCard icon={idea.icon} title={idea.title} text={idea.text} />
          </li>
        ))}
      </ul>
    </StudentShell>
  )
}
