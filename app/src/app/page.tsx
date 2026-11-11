import { redirect } from 'next/navigation'
import { getCurrentActor } from '@/server/auth/cookie'

// Заготовка: экраны М0 — этап 2 пакета 2.4. Здесь только маршрутизация по роли из сессии.
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const actor = await getCurrentActor()
  if (!actor) redirect('/login')
  if (actor.role === 'staff') redirect('/staff/requests')
  return (
    <main className="p-4">
      <h1 className="text-xl font-semibold">Сегодня</h1>
    </main>
  )
}
