import Image from 'next/image'
import { headers, cookies } from 'next/headers'
import { Suspense } from 'react'
import { Card, CardTitle, PageTitle } from '@/components/card'
import { LoadingCard } from '@/components/states/loading-card'
import { StudentFrame } from '@/components/states/shell-parts'
import { StudentShell } from '@/components/student-shell'
import { SubmitButton } from '@/components/submit-button'
import { logoutAction } from '@/app/login/actions'
import { baseUrlFrom, qrPath, studentTicketCode } from '@/lib/certificate'
import { requireStudentActor } from '@/server/auth/page-guards'
import type { Actor } from '@/server/auth/session'
import { getConfig } from '@/server/config'
import { getMyProfile, hasMyAvatar } from '@/server/dal/student'
import { deleteAvatarAction } from './actions'
import { AVATAR_NOTICES, isAvatarNoticeKey } from './avatar-rules'
import { AvatarForm } from './avatar-form'
import { SettingsCard } from './settings-card'
import { TicketCard } from './ticket-card'
import { UI_COOKIE, parseUi } from './ui-settings'

// Э-10 «Профиль»: ФИО, факультет, направление, курс, группа; кнопка «Выйти» (ЯД-1).
// 20.11, блиц: фото профиля, электронный студенческий билет с QR, настройки отображения.
export const dynamic = 'force-dynamic'

type Param = string | string[] | undefined

const UI_NOTICES = {
  saved: { text: 'Настройки сохранены.', tone: 'ok' },
  bad: { text: 'Не удалось сохранить настройки: выберите тему и размер из списка.', tone: 'error' },
} as const

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

function Notice({ text, tone }: { text: string; tone: 'ok' | 'error' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid="profile-notice"
      className={`rounded-control px-[var(--sp-3)] py-[var(--sp-2)] text-[length:var(--fs-sm)] font-bold ${tone === 'error' ? 'bg-error-bg text-error' : 'bg-success-bg text-success'}`}
    >
      {text}
    </p>
  )
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ avatar?: Param; ui?: Param }> }) {
  // Вход проверяется выше границы ожидания: после начала потока отказ уже не получил бы код 307 или 403 (пакет 3.7).
  const actor = await requireStudentActor()
  const params = await searchParams

  return (
    <Suspense
      fallback={
        <StudentFrame data={null} active={null}>
          <LoadingCard label="Загружаем профиль…" />
        </StudentFrame>
      }
    >
      <ProfileContent actor={actor} avatarKey={params.avatar} uiKey={params.ui} />
    </Suspense>
  )
}

// Читает данные экрана и рисует его. Внутри границы нет redirect(), notFound(), forbidden() и denyRecord().
async function ProfileContent({ actor, avatarKey, uiKey }: { actor: Actor; avatarKey: Param; uiKey: Param }) {
  const [profile, hasAvatar, store, h] = await Promise.all([getMyProfile(actor), hasMyAvatar(actor), cookies(), headers()])
  if (!profile) throw new Error('Профиль студента не найден')
  const rows: [string, string][] = [
    ['ФИО', profile.fullName],
    ['Факультет', profile.faculty],
    ['Направление', profile.programme],
    ['Курс', String(profile.course)],
    ['Группа', profile.groupName],
  ]

  // Код билета подписан секретом; номер студента — из сессии. Адрес в QR — из заголовка Host, как в печатной справке.
  const { certificateSecret } = getConfig()
  // QR ведёт на публичный адрес сайта: за прокси заголовок Host мог прийти как localhost (20.11, телефон не открывал ссылку).
  const base = getConfig().publicBaseUrl ?? baseUrlFrom(h.get('host'), h.get('x-forwarded-proto'))
  const verifyUrl = certificateSecret && base ? `${base}/verify/student/${studentTicketCode(actor.userId, certificateSecret)}` : null
  const qr = verifyUrl ? qrPath(verifyUrl) : null

  const avatarNotice = isAvatarNoticeKey(avatarKey) ? AVATAR_NOTICES[avatarKey] : null
  const uiNotice = typeof uiKey === 'string' && Object.hasOwn(UI_NOTICES, uiKey) ? UI_NOTICES[uiKey as keyof typeof UI_NOTICES] : null

  return (
    <StudentShell actor={actor} active={null}>
      <PageTitle>Профиль</PageTitle>
      <div className="flex flex-col gap-[var(--gap)]">
        <Card>
          <div className="mb-[var(--sp-3)] flex items-center gap-[var(--sp-3)]">
            {hasAvatar ? (
              <Image
                data-testid="profile-avatar"
                src="/profile/avatar"
                alt="Ваше фото"
                width={96}
                height={96}
                unoptimized
                className="size-24 flex-none rounded-full bg-avatar-bg object-cover"
              />
            ) : (
              <span
                data-testid="profile-initials"
                aria-hidden="true"
                className="grid size-24 flex-none place-items-center rounded-full bg-avatar-bg text-[length:var(--fs-xl)] font-extrabold text-avatar-fg"
              >
                {initials(profile.fullName)}
              </span>
            )}
            <p className="min-w-0 text-[length:var(--fs-sm)] text-muted">
              {hasAvatar ? 'Фото видно только вам.' : 'Фото не загружено: вместо него — инициалы.'}
            </p>
          </div>
          <dl className="flex flex-col gap-[var(--gap)]">
            {rows.map(([name, value]) => (
              <div key={name}>
                <dt className="text-[length:var(--fs-sm)] text-muted">{name}</dt>
                <dd className="text-[length:var(--fs-md)] font-bold">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardTitle>Фото профиля</CardTitle>
          <div className="flex flex-col gap-[var(--sp-3)]">
            {avatarNotice ? <Notice {...avatarNotice} /> : null}
            <AvatarForm />
            {hasAvatar ? (
              <form action={deleteAvatarAction}>
                <SubmitButton variant="ghost" className="w-full">
                  Удалить фото
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </Card>

        <TicketCard ticket={{ fullName: profile.fullName, faculty: profile.faculty, programme: profile.programme, course: profile.course, groupName: profile.groupName, qr, verifyUrl }} />

        {uiNotice ? <Notice {...uiNotice} /> : null}
        <SettingsCard current={parseUi(store.get(UI_COOKIE)?.value)} />

        <form action={logoutAction}>
          <SubmitButton variant="ghost" className="w-full">
            Выйти
          </SubmitButton>
        </form>
      </div>
    </StudentShell>
  )
}
