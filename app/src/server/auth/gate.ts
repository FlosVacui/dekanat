// Предел очереди хеша: одновременно ждут счёта не больше `limit` входов, следующий сразу получает отказ
// (ADR-0003, «Очередь хеша ограничена»). Число — выбор проекта. Без предела поток входов растил бы
// ожидание для всех. Счётчик живёт в памяти одного процесса: это защита ресурса, а не состояние пользователя.

export class BusyError extends Error {
  constructor() {
    super('busy')
    this.name = 'BusyError'
  }
}

export const HASH_QUEUE_LIMIT = 8

export function createGate(limit: number) {
  let pending = 0
  return {
    get pending() {
      return pending
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (pending >= limit) throw new BusyError()
      pending += 1
      try {
        return await task()
      } finally {
        pending -= 1
      }
    },
  }
}

/** Общая очередь входов процесса. */
export const hashGate = createGate(HASH_QUEUE_LIMIT)
