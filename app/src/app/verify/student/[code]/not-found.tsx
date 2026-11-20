import { Card } from '@/components/card'

// Неверный, изменённый и неизвестный код выглядят одинаково: ответ 404 и эта строка, без подробностей.
export default function VerifyStudentNotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-[var(--pad-x)] py-[var(--sp-4)]">
      <Card className="flex flex-col gap-[var(--sp-3)]">
        <h1 data-testid="verify-result" className="text-[length:var(--h1-size)] font-bold leading-[1.15] text-error">
          Студенческий билет не найден
        </h1>
        <p className="text-[length:var(--fs-sm)] text-muted">Проверьте, что QR-код считан целиком и билет выдан в этой системе.</p>
        <p className="text-[length:var(--fs-sm)] font-bold">Прототип. Данные вымышленные</p>
      </Card>
    </main>
  )
}
