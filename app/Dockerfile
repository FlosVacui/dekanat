# Образ приложения. НЕ ЗАПУСКАЛСЯ: на ноутбуке разработки Docker нет, первая проверка — пакет 2.5 на сервере.
# Контекст сборки — корень репозитория: docker build -f app/Dockerfile .
# Секретов в образе нет: ни ARG, ни ENV с паролями, ни файла окружения (ADR-0004). Значения передаются при запуске.
FROM node:24-bookworm-slim AS base
WORKDIR /srv/app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY app/package.json app/package-lock.json ./
RUN npm ci

FROM deps AS build
COPY app/ ./
# Сборка без файла окружения: конфигурация читается лениво, при запуске.
RUN node ./node_modules/next/dist/bin/next build

# Рабочий образ. Полные зависимости оставлены нарочно: next.config.ts транспилируется на старте,
# а тот же образ запускает миграции и вымышленные данные (tsx, drizzle). Размер образа не оптимизировался.
FROM build AS runtime
ENV NODE_ENV=production
# Файлы после COPY и сборки принадлежат root, а процесс идёт от node: кэшу Next.js нужна запись (IMP-016, пункт 3).
RUN mkdir -p .next/cache && chown -R node:node .next/cache
USER node
EXPOSE 3000
CMD ["node", "./node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
