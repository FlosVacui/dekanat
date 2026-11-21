import { getCurrentActor } from '@/server/auth/cookie'
import { getCohortStudentAvatar } from '@/server/dal/staff'

// GET /staff/students/<номер>/photo: фото студента для сотрудника. Номер из адреса слой доступа сверяет с набором сотрудника из сессии
// в том же запросе: чужой набор, студент без фото и несуществующий номер дают один ответ — 404.
// Не вошёл — 401, студент — 403. Ответ личный: не кэшируется; тип не угадывается; страница-обёртка запрещает исполнение.
export const dynamic = 'force-dynamic'

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await getCurrentActor()
  if (!actor) return new Response(null, { status: 401, headers: BASE_HEADERS })
  if (actor.role !== 'staff') return new Response(null, { status: 403, headers: BASE_HEADERS })
  const { id } = await context.params
  const avatar = await getCohortStudentAvatar(actor, id)
  if (!avatar) return new Response(null, { status: 404, headers: BASE_HEADERS })
  return new Response(new Uint8Array(avatar.data), {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': avatar.mime,
      'Content-Length': String(avatar.data.length),
      'Content-Disposition': 'inline',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
