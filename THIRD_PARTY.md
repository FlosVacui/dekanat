# Сторонние материалы и лицензии

Задание разрешает сторонние библиотеки, шрифты, иконки и изображения только с лицензией, которая это допускает (требование ТР-8). Здесь записано всё стороннее. Строка добавляется в том же коммите, что и сам материал.

Свой код команды открытой лицензии не имеет: по Регламенту права на материалы работы переходят организатору при отправке (требование РГ-3).

## В продукте
Продукт — папка `app/`, первый код появился 11.11.2026 (пакет 2.4). Версии закреплены в `app/package-lock.json`. Версия и лицензия каждой прямой зависимости сверены 11.11.2026 командой `npm view <пакет> version license dist-tags repository.url` и файлом лицензии на странице проекта (ссылка в колонке «Файл лицензии»). Зависимости зависимостей здесь не перечислены.

| Что | Вид | Версия | Лицензия | Файл лицензии | Где используется | Сверено |
|---|---|---|---|---|---|---|
| Next.js | библиотека | 16.4.6 | MIT | [license.md](https://github.com/vercel/next.js/blob/canary/license.md) | Каркас приложения, страницы и действия на сервере. Версия не ниже 16.4.5 по ADR-0001; метка `latest` указывает на 16.4.6, не на предвыпускную | 11.11.2026 |
| React, React DOM | библиотека | 19.3.1 | MIT | [LICENSE](https://github.com/facebook/react/blob/main/LICENSE) | Интерфейс | 11.11.2026 |
| Drizzle ORM | библиотека | 0.45.4 | Apache-2.0 | [LICENSE](https://github.com/drizzle-team/drizzle-orm/blob/main/LICENSE) | Запросы к базе в слое доступа `app/src/server/dal/` | 11.11.2026 |
| node-postgres (`pg`) | библиотека | 8.23.1 | MIT | [LICENSE](https://github.com/brianc/node-postgres/blob/master/LICENSE) | Драйвер PostgreSQL под Drizzle и скриптами `app/db/` | 11.11.2026 |
| server-only | библиотека | 0.0.1 | MIT по метаданным пакета | Файла лицензии в пакете нет. Не проверено: лежит ли пакет в репозитории React. Лицензия React — [LICENSE](https://github.com/facebook/react/blob/main/LICENSE) | Метка «только на сервере» у `config.ts` и слоя доступа | 11.11.2026 |
| clsx | библиотека | 2.1.1 | MIT | [license](https://github.com/lukeed/clsx/blob/master/license) | Сборка списка классов кнопок | 11.11.2026 |
| tailwind-merge | библиотека | 3.7.0 | MIT | [LICENSE.md](https://github.com/dcastil/tailwind-merge/blob/main/LICENSE.md) | Слияние классов Tailwind | 11.11.2026 |
| class-variance-authority | библиотека | 0.7.1 | Apache-2.0 | [LICENSE](https://github.com/joe-bell/cva/blob/main/LICENSE) | Варианты кнопки | 11.11.2026 |
| Tailwind CSS, @tailwindcss/postcss | инструмент сборки | 4.3.5 | MIT | [LICENSE](https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE) | Сборка стилей; готовый CSS входит в продукт | 11.11.2026 |
| PostCSS | инструмент сборки | 8.5.32 | MIT | [LICENSE](https://github.com/postcss/postcss/blob/main/LICENSE) | Обработка стилей при сборке | 11.11.2026 |

**Выбор библиотеки запросов** (ADR-0002; условия: лицензия подтверждена на странице проекта, стабильная версия, запросы с параметрами, миграции файлами в git). Выбран Drizzle ORM. Prisma не выбрана: метка `latest` у пакета `prisma` указывает на 8.0.0-rc.33, это предвыпускная версия. У Drizzle лицензия подтверждена файлом LICENSE на странице проекта; метка `latest` — 0.45.4, ветка 1.0 помечена `beta` и не используется. Запросы идут с параметрами, миграции — SQL-файлами в `app/db/migrations/`.

Компоненты shadcn/ui в этой версии не копировались: кнопка написана заново в духе shadcn. Появится копия — строка здесь в том же коммите.

Виды: библиотека, шрифт, набор иконок, изображение, данные, инструмент сборки. Шрифтов, иконок и изображений в продукте пока нет.

## Инструменты разработки
Эти программы запускаются при разработке и в CI. В прототип, который открывает жюри, они не входят.

| Что | Для чего | Лицензия | Сверено |
|---|---|---|---|
| uv | Запуск скриптов `tools/` | не сверено | — |
| PyYAML | Чтение и запись учёта | не сверено | — |
| openpyxl | Сборка Excel-графика | не сверено | — |
| pytest | Тесты инструментов | не сверено | — |
| pre-commit | Хуки перед коммитом | не сверено | — |
| gitleaks | Поиск секретов | не сверено | — |
| ruff | Стиль скриптов Python | не сверено | — |
| GitHub Actions: `actions/checkout`, `astral-sh/setup-uv`, `gitleaks/gitleaks-action` | CI | не сверено | — |
| ESLint 10.14.0 | Линтер кода продукта и тестов | MIT, [LICENSE](https://github.com/eslint/eslint/blob/main/LICENSE) | 11.11.2026 |
| eslint-config-next 16.4.6 | Правила линтера для Next.js | MIT по метаданным пакета; файла лицензии у пакета нет, лежит в репозитории Next.js — [license.md](https://github.com/vercel/next.js/blob/canary/license.md) | 11.11.2026 |
| TypeScript 6.0.3 | Проверка типов. Метка `latest` указывает на 7.0.2, но typescript-eslint 8.72.2 принимает только версии ниже 6.1, поэтому закреплена 6.0.3 | Apache-2.0, [LICENSE.txt](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) | 11.11.2026 |
| Vitest 5.1.0 | Модульные тесты | MIT, [LICENSE](https://github.com/vitest-dev/vitest/blob/main/LICENSE) | 11.11.2026 |
| tsx 4.23.15 | Запуск скриптов `app/db/` на TypeScript | MIT, [LICENSE](https://github.com/privatenumber/tsx/blob/master/LICENSE) | 11.11.2026 |
| drizzle-kit 0.31.11 | Создание файлов миграций из схемы | MIT по метаданным пакета и `package.json` в репозитории. Отдельного файла лицензии у drizzle-kit нет; в корне репозитория — [Apache-2.0](https://github.com/drizzle-team/drizzle-orm/blob/main/LICENSE). Расхождение не разобрано | 11.11.2026 |
| @playwright/test 1.65.0 | Сквозной тест на экране 360×800 и снимки экранов (`app/tests/e2e/`). Метка `latest` — 1.65.0; `next` и `beta` — предвыпускные, не используются | Apache-2.0, [LICENSE](https://github.com/microsoft/playwright/blob/main/LICENSE) — файл открыт 11.11.2026, версия 1.65.0 в ветке `v1.65.0` тот же | 11.11.2026 |
| Chromium для Playwright (`playwright install chromium`) | Браузер для сквозного теста; скачивается в кэш пользователя, в репозиторий и в образ не входит | не проверено: лицензии сборки Chromium, которую скачивает Playwright, не сверялись | — |
| @types/node 24.19.2, @types/react 19.3.0, @types/react-dom 19.3.0, @types/pg 8.23.1 | Описания типов | MIT, [LICENSE](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE) | 11.11.2026 |

Лицензии инструментов `tools/` и CI по страницам самих проектов ещё не сверены. Сверка — в пакете 5.4; в колонку «Сверено» пишется дата и ссылка на файл лицензии. До сверки лицензия по памяти не записывается.

## Перенесено из другого проекта команды
Скрипты `tools/`, CI и шаблоны документов перенесены из проекта «Стратег» той же команды и поправлены. Это свой код команды, не сторонний.

## Как проверяем
- Пакет с новой зависимостью не принимается без строки здесь.
- В пакете 5.4 таблица сверяется со списком зависимостей продукта.
- Картинки, сделанные ИИ-генератором, записываются с названием генератора и условиями использования.
