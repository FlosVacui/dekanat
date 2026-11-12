import { randomInt } from 'node:crypto'

// Адрес посетителя в сквозных тестах. На сервере его ставит обратный прокси в заголовок из CLIENT_IP_HEADER
// (ADR-0003). Тестовый стенд (helpers/server.ts) запускает `next start` с этим заголовком, а каждый тест шлёт свой адрес
// тем же заголовком — так на сервере делает прокси. Лимиты входа и записи при этом не меняются и не выключаются.
export const IP_HEADER = 'x-test-client-ip'

const used = new Set<string>()

/** Свежий адрес из частной сети: у каждого теста и каждого входа свои счётчики. Адреса не повторяются в прогоне. */
export function freshAddress(): string {
  for (;;) {
    const ip = `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`
    if (!used.has(ip)) {
      used.add(ip)
      return ip
    }
  }
}

/** Заголовки с адресом посетителя: для `extraHTTPHeaders` контекста браузера и для сырых запросов. */
export function addressHeaders(ip: string = freshAddress()): Record<string, string> {
  return { [IP_HEADER]: ip }
}
