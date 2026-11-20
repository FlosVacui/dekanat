import { Card, CardTitle, PageTitle } from '@/components/card'
import { SelectField } from '@/components/requests/select-field'
import { StaffShell } from '@/components/staff-shell'
import { SubmitButton } from '@/components/submit-button'
import { formatDate, todayIn } from '@/lib/dates'
import { requireStaffActor } from '@/server/auth/page-guards'
import { getConfig } from '@/server/config'
import {
  ANNOUNCEMENTS_PER_DAY,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  canPostAnnouncements,
  listCohortAnnouncements,
  listCohortAudiences,
} from '@/server/dal/staff'
import { createAnnouncementAction } from './actions'

// Объявления сотрудника (20.11, блиц): форма «группа или весь поток», заголовок до 120 знаков, текст до 2000; ниже — отправленные за 30 дней.
// Студенты видят объявление в ленте «Объявления». Форма — обычная, работает без скриптов; исход приходит параметром `?result=`.
export const dynamic = 'force-dynamic'

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  ok: { text: 'Объявление отправлено. Студенты увидят его в ленте «Объявления»', ok: true },
  invalid: { text: `Проверьте поля: заголовок до ${ANNOUNCEMENT_TITLE_MAX} знаков и текст до ${ANNOUNCEMENT_BODY_MAX} знаков, оба не пустые`, ok: false },
  audience: { text: 'Выберите группу или поток из списка', ok: false },
  unavailable: { text: 'Отправка объявлений сейчас выключена: у приложения нет права записи', ok: false },
  limit: { text: `Сегодня уже отправлено ${ANNOUNCEMENTS_PER_DAY} объявлений. Попробуйте позже`, ok: false },
}

const fieldClass =
  'block w-full rounded-control border-2 border-border-strong bg-card px-[var(--sp-4)] text-[length:var(--fs-md)] text-text focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus'

export default async function StaffAnnouncementsPage({ searchParams }: { searchParams: Promise<{ result?: string | string[] }> }) {
  const actor = await requireStaffActor()
  const raw = (await searchParams).result
  const key = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
  const message = Object.hasOwn(MESSAGES, key) ? MESSAGES[key] : undefined
  const [audiences, sent, canPost] = await Promise.all([listCohortAudiences(actor), listCohortAnnouncements(actor), canPostAnnouncements(actor)])
  const tz = getConfig().timezone
  return (
    <StaffShell juryMode={getConfig().juryMode}>
      <PageTitle>Объявления</PageTitle>
      <div className="flex flex-col gap-[var(--gap)] lg:grid lg:grid-cols-2 lg:items-start">
        <Card>
          <CardTitle>Новое объявление</CardTitle>
          {message ? (
            <p
              role="status"
              data-testid="announcement-result"
              className={`mb-[var(--sp-3)] text-[length:var(--fs-sm)] font-bold ${message.ok ? 'text-success' : 'text-error'}`}
            >
              {message.text}
            </p>
          ) : null}
          {canPost ? (
            <form action={createAnnouncementAction} className="flex flex-col gap-[var(--gap)]">
              <SelectField id="announcement-audience" name="audience" label="Кому">
                <optgroup label="Группа">
                  {audiences.groups.map((g) => (
                    <option key={g.id} value={`group:${g.id}`}>
                      {g.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Весь поток">
                  {audiences.faculties.map((f) => (
                    <option key={f} value={`faculty:${f}`}>
                      {f}
                    </option>
                  ))}
                </optgroup>
              </SelectField>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="announcement-title" className="text-[length:var(--fs-sm)] font-bold">
                  Заголовок
                </label>
                <input
                  id="announcement-title"
                  name="title"
                  type="text"
                  required
                  maxLength={ANNOUNCEMENT_TITLE_MAX}
                  autoComplete="off"
                  aria-describedby="announcement-title-hint"
                  className={`${fieldClass} min-h-[var(--control-h)]`}
                />
                <p id="announcement-title-hint" className="text-[length:var(--fs-sm)] text-muted">
                  До {ANNOUNCEMENT_TITLE_MAX} знаков
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="announcement-body" className="text-[length:var(--fs-sm)] font-bold">
                  Текст
                </label>
                <textarea
                  id="announcement-body"
                  name="body"
                  required
                  rows={6}
                  maxLength={ANNOUNCEMENT_BODY_MAX}
                  aria-describedby="announcement-body-hint"
                  className={`${fieldClass} min-h-[var(--control-h)] resize-y py-3 leading-[1.4]`}
                />
                <p id="announcement-body-hint" className="text-[length:var(--fs-sm)] text-muted">
                  До {ANNOUNCEMENT_BODY_MAX} знаков. Не больше {ANNOUNCEMENTS_PER_DAY} объявлений в сутки
                </p>
              </div>
              <SubmitButton>Отправить объявление</SubmitButton>
            </form>
          ) : (
            <p data-testid="announcement-disabled" className="text-[length:var(--fs-sm)] text-muted">
              Отправка объявлений сейчас выключена: у приложения нет права записи. Ниже — объявления, которые уже отправлены.
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Отправлено за 30 дней</CardTitle>
          {sent.length === 0 ? (
            <p className="text-[length:var(--fs-sm)] text-muted">За 30 дней объявлений не было</p>
          ) : (
            <ul data-testid="announcement-list" className="flex flex-col gap-[var(--sp-3)]">
              {sent.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 border-b border-border pb-[var(--sp-3)] last:border-b-0 last:pb-0">
                  <span className="text-[length:var(--fs-md)] font-bold [overflow-wrap:anywhere]">{a.title}</span>
                  <span className="text-[length:var(--fs-sm)] text-muted">
                    {formatDate(todayIn(tz, a.publishedAt))}, {a.audience}
                  </span>
                  <span className="whitespace-pre-wrap text-[length:var(--fs-sm)] leading-[1.4] [overflow-wrap:anywhere]">{a.body}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </StaffShell>
  )
}
