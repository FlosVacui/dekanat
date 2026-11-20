import { getCurrentActor } from '@/server/auth/cookie'
import { getMyAvatar } from '@/server/dal/student'

// GET /profile/avatar: фото текущего студента. Адрес один для всех, номера в нём нет: чьё фото отдать, решает сессия.
// Не вошёл — 401, сотрудник — 403, фото нет — 404. Ответ личный: не кэшируется ни браузером, ни прокси; тип не угадывается.
export const dynamic = 'force-dynamic'

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
}

export async function GET(): Promise<Response> {
  const actor = await getCurrentActor()
  if (!actor) return new Response(null, { status: 401, headers: BASE_HEADERS })
  if (actor.role !== 'student') return new Response(null, { status: 403, headers: BASE_HEADERS })
  const avatar = await getMyAvatar(actor)
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
