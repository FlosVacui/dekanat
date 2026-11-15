// Снимок и возврат прочитанности двух студентов основного набора (пакет 3.5). Тесты ленты и действий отмечают записи;
// следующие файлы работают с теми же аккаунтами, поэтому в конце всё возвращается к тому, что было до них.
import { STUDENT_A, STUDENT_B } from './fixtures'
import { withOwner } from './helpers'

export interface FeedSnapshot {
  readAt: Map<string, Date | null>
  reads: Set<string>
}

const LOGINS = [STUDENT_A.login, STUDENT_B.login]

export async function snapshotFeedState(): Promise<FeedSnapshot> {
  return withOwner(async (c) => {
    const n = await c.query(`select n.id, n.read_at from notifications n join users u on u.id = n.student_id where u.login = any($1)`, [LOGINS])
    const r = await c.query(
      `select r.announcement_id, r.student_id from announcement_reads r join users u on u.id = r.student_id where u.login = any($1)`,
      [LOGINS],
    )
    return {
      readAt: new Map(n.rows.map((row) => [row.id as string, row.read_at as Date | null])),
      reads: new Set(r.rows.map((row) => `${row.announcement_id}:${row.student_id}`)),
    }
  })
}

/** Уведомления — прежний `read_at`; отметки объявлений, которых до тестов не было, удаляются. */
export async function restoreFeedState(before: FeedSnapshot): Promise<void> {
  await withOwner(async (c) => {
    for (const [id, readAt] of before.readAt) {
      await c.query('update notifications set read_at = $2 where id = $1 and read_at is distinct from $2', [id, readAt])
    }
    const now = await c.query(
      `select r.announcement_id, r.student_id from announcement_reads r join users u on u.id = r.student_id where u.login = any($1)`,
      [LOGINS],
    )
    for (const row of now.rows) {
      if (!before.reads.has(`${row.announcement_id}:${row.student_id}`)) {
        await c.query('delete from announcement_reads where announcement_id = $1 and student_id = $2', [row.announcement_id, row.student_id])
      }
    }
  })
}
