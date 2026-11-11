import { redirect } from 'next/navigation'
import { Card, PageTitle } from '@/components/card'
import { LinkButton } from '@/components/link-button'
import { StudentShell } from '@/components/student-shell'
import { SubmitButton } from '@/components/submit-button'
import { REQUEST_KIND_INFO, isRequestKind } from '@/lib/requests'
import { requireStudentActor } from '@/server/auth/page-guards'
import { createRequestAction } from './actions'

// Э-7 «Новая заявка»: вид, срок изготовления, где и как получить. Полей для правки нет: значения по умолчанию.
export const dynamic = 'force-dynamic'

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const actor = await requireStudentActor()
  const { type } = await searchParams
  if (!isRequestKind(type)) redirect('/requests')
  const info = REQUEST_KIND_INFO[type]
  return (
    <StudentShell actor={actor} active="requests">
      <PageTitle>Новая заявка</PageTitle>
      <Card>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-neutral-700">Вид</dt>
            <dd className="text-base font-semibold">{info.title}</dd>
          </div>
          <div>
            <dt className="text-neutral-700">Срок изготовления</dt>
            <dd>{info.productionTime}</dd>
          </div>
          <div>
            <dt className="text-neutral-700">Где и как получить</dt>
            <dd>{info.pickup}</dd>
          </div>
        </dl>
      </Card>
      <form action={createRequestAction} className="mt-4 flex flex-col gap-2">
        <input type="hidden" name="kind" value={type} />
        <SubmitButton>Отправить</SubmitButton>
        <LinkButton href="/requests" variant="secondary">
          Назад к заявкам
        </LinkButton>
      </form>
    </StudentShell>
  )
}
