# ВН-03: логотип «Деканат в кармане» — промпты для генератора изображений

Оркестратор заполнил файл. Участник копирует промпт в генератор, а результат кладёт в папку `ВН-03/` рядом — как есть, без правок. Название генератора, версия и дата записываются: они идут в перечень инструментов и в `THIRD_PARTY.md`.

| | |
|---|---|
| Пакет | 2.2 |
| Куда отправить | Генератор изображений — не Claude. Лучше тот, что отдаёт вектор SVG. Отдаёт только картинку — тоже годится: знак потом перерисует кодом SVG субагент `designer` |
| Зачем | Первый раунд сделал субагент `designer` кодом SVG: [D-2.2-logo](../design/D-2.2-logo.md). Знаки вышли чистыми, но обычными; три из шести читаются слабо — [ошибка Б-6](../evidence/ai-errors.md). Участник Б 12.11.2026 попросил промпты для другой модели: нужен знак ярче и с характером |
| Что вернуть | По каждой идее — четыре картинки 1024×1024 или SVG. Имя файла: номер идеи и номер попытки, например `1-2.png`. Рядом — точный текст промпта, если он менялся |
| Кто и когда отправил | Не отправлен. Заполняет участник: кто, генератор и версия, ДД.ММ.ГГГГ |
| Что разрешено и что нет | Со слов участника Б 12.11.2026: «участник А разрешил обойти условие по нейтральности логотипов». Оркестратор понял это так: снят запрет задания [B-2.2-logo](../briefs/B-2.2-logo.md) на образы, связанные с вузом и отраслью, — пламя, капля и подобное; знак может быть ярким. **Не снято и участником не снимается:** официальный логотип вуза не используется и не копируется — требование задания конкурса ТР-7; сайт не выдаёт себя за официальный сервис — ТР-6. Понял неверно — участник поправит, запись изменится |

## Правила отправки
1. **Официальный знак вуза в генератор не загружается** — ни картинкой-образцом, ни ссылкой, ни словами «как у такого-то вуза». Это было бы копированием: ТР-7.
2. **Названия вузов и имена людей в промпт не пишутся.**
3. **Условия генератора.** До отправки открой страницу условий использования генератора и проверь: можно ли брать результат в свой проект, чьи права на картинку, нужна ли подпись. Ссылку и дату пришли в сессию: строка пойдёт в `THIRD_PARTY.md`. По памяти условия не записываются: требование ТР-8.
4. **Текст в картинке не просим.** Генераторы портят кириллицу. Название «Деканат в кармане» мы наберём сами шрифтом дизайн-системы.
5. **По четыре попытки на идею.** Что отправлено и что пришло — сохраняется целиком, и неудачные попытки тоже: жюри смотрит на настоящую работу с ИИ.

## Запрос

Шесть идей. Каждый промпт самодостаточный: копируется целиком. Английский текст — для большинства генераторов; русский — ниже.

### 1. Шапочка-карман — несёт название
```
Minimalist flat vector logo mark, app icon for a mobile student portal called "Dean's Office in Your Pocket". A shirt pocket seen from the front, and its pointed flap is a graduation cap: one fused, clever silhouette. A single small orange tassel hangs from the cap as the only accent. Bold geometric shapes, thick uniform strokes, generous negative space, perfectly centered, instantly readable at 16 pixels. Two colors only: deep cobalt blue #2563EB and vivid orange #EA580C, on a pure white background. Confident, friendly, witty — the kind of mark a top branding studio would ship. No text, no letters, no gradients, no shadows, no 3D, no mockup, no photo, single mark only.
```

### 2. Колокольчик в шапочке — «деканат приходит сам»
```
Minimalist flat vector logo mark, app icon for a mobile student portal that notifies students by itself. A notification bell wearing a graduation cap, fused into one simple silhouette; the bell's clapper is a single orange dot. Bold geometric shapes, thick uniform strokes, generous negative space, perfectly centered, instantly readable at 16 pixels. Two colors only: deep cobalt blue #2563EB and vivid orange #EA580C, on a pure white background. Confident, friendly, witty — the kind of mark a top branding studio would ship. No text, no letters, no gradients, no shadows, no 3D, no mockup, no photo, single mark only.
```

### 3. Карман-улыбка — самый лаконичный
```
Minimalist flat vector logo mark, app icon for a mobile student portal called "Dean's Office in Your Pocket". A rounded pocket shape seen from the front; the curved seam of its opening reads as a calm, confident smile. One small orange dot above the seam, like a notification. Nothing else. Bold geometric shapes, thick uniform strokes, generous negative space, perfectly centered, instantly readable at 16 pixels. Two colors only: deep cobalt blue #2563EB and vivid orange #EA580C, on a pure white background. Iconic and memorable, as simple as the best app icons. No text, no letters, no gradients, no shadows, no 3D, no mockup, no photo, single mark only.
```

### 4. Дверь-сообщение — деканат без очереди
```
Minimalist flat vector logo mark, app icon for a mobile student portal that replaces queues at the dean's office. A half-open door whose negative space forms a speech bubble; a warm orange wedge of light spills out of the doorway. Bold geometric shapes, thick uniform strokes, generous negative space, perfectly centered, instantly readable at 16 pixels. Two colors only: deep cobalt blue #2563EB and vivid orange #EA580C, on a pure white background. Clever negative-space design, the kind of mark a top branding studio would ship. No text, no letters, no gradients, no shadows, no 3D, no mockup, no photo, single mark only.
```

### 5. Буква «Д» как карман — монограмма
```
Minimalist flat vector monogram logo, app icon. The Cyrillic capital letter "Д" drawn as a shirt pocket: a trapezoid body standing on a wide flat base with two short feet pointing down, and a pointed pocket flap inside the body cut out as negative space. One small orange button on the flap as the only accent. Bold geometric shapes, thick uniform strokes, perfectly symmetrical and centered, instantly readable at 16 pixels. Two colors only: deep cobalt blue #2563EB and vivid orange #EA580C, on a pure white background. Smart and timeless, like a classic modernist monogram. No other letters, no words, no gradients, no shadows, no 3D, no mockup, no photo, single mark only.
```

### 6. Пламя в кармане — тема вуза, с оговоркой
```
Minimalist flat vector logo mark, app icon for a student portal of an oil and gas university. A simple pocket shape, and rising out of it a single bold flame that is also a drop: round at the bottom, pointed at the top. The flame is vivid orange, the pocket is deep cobalt blue. Bold geometric shapes, thick uniform strokes, generous negative space, perfectly centered, instantly readable at 16 pixels. Two colors only: #2563EB and #EA580C, on a pure white background. Energetic, proud, modern. No derricks, no shields, no wreaths, no globes, no text, no letters, no gradients, no shadows, no 3D, no mockup, no photo, single mark only.
```
Оговорка к идее 6: это единственная идея, которая может оказаться похожей на официальный знак вуза. До выбора оркестратор с участником сравнивают результат с оригиналом; похоже — идея снимается.

### Хвост для Midjourney
Добавь в конец любого промпта:
```
--ar 1:1 --style raw --no text, letters, words, gradient, shadow, 3d, mockup, photo
```

### Русская рамка — для генераторов, которые лучше понимают русский
Вставь на место `<ИДЕЯ>` одну из шести строк ниже.
```
Минималистичный плоский векторный логотип, значок мобильного приложения для студентов «Деканат в кармане». <ИДЕЯ> Крупные геометрические формы, толстые линии одной толщины, много воздуха, знак по центру, читается в размере 16 пикселей. Только два цвета: насыщенный синий #2563EB и яркий оранжевый #EA580C, чисто-белый фон. Остроумно и уверенно, уровень сильной брендинговой студии. Без текста, без букв, без градиентов, без теней, без объёма, без макета, без фотографии, один знак.
```
1. `Нагрудный карман спереди, а его острый клапан — это шапочка выпускника: один слитный силуэт. Единственный акцент — маленькая оранжевая кисточка шапочки.`
2. `Колокольчик уведомлений в шапочке выпускника, один простой силуэт; язычок колокольчика — оранжевая точка.`
3. `Скруглённый карман спереди; изогнутый шов его края читается как спокойная улыбка. Над швом одна маленькая оранжевая точка — уведомление. Больше ничего.`
4. `Приоткрытая дверь, а просвет двери образует пузырь сообщения; из проёма падает тёплый оранжевый клин света.`
5. `Заглавная кириллическая буква «Д» в виде кармана: трапеция на широком основании с двумя короткими ножками, внутри вырезан острый клапан кармана. Единственный акцент — маленькая оранжевая пуговица. Других букв нет.` — в рамке убери слова «без букв».
6. `Простой карман, из него поднимается одно крупное пламя, оно же капля: круглое снизу, острое сверху. Пламя оранжевое, карман синий. Без вышек, щитов, венков и глобусов.`

### Второй шаг — довести лучший вариант
Отправь в тот же диалог или вместе с выбранной картинкой:
```
Take this exact logo mark and refine it. Keep the silhouette and the idea. Remove every detail that is not needed to recognise it. Make all strokes thicker and equal. Make it perfectly symmetrical and optically balanced. Then show the result on one white sheet in a single row: at 256 px, 64 px, 32 px and 16 px, and next to it a one-color black version. Flat vector, no gradients, no shadows, no text.
```

## Ответ
**12.11.2026, смена Б-3.** Участник Б принёс одну картинку: [owl-as-received.webp](ВН-03/owl-as-received.webp), 1024×1024 — сова в шапочке выпускника, тело в форме щита, на кисточке шапочки — микросхема. Сказал: «логотип для дизайна готов».

Чего нет: названия генератора и версии, текста промпта, даты генерации, других попыток, ссылки на условия использования. Такой идеи среди шести промптов этого файла нет: промпт был другой. Эти сведения участник пришлёт — тогда они будут записаны здесь, в [перечне инструментов](../evidence/tools.md) и в `THIRD_PARTY.md`. Пока стоит «не названо»; ничего не додумывается.

## Что сделали с ответом
**12.11.2026.** Оркестратор разовым скриптом на Python с библиотекой Pillow перевёл картинку в PNG, обрезал поля и сделал фон прозрачным: `docs/design/logo/owl/owl-512.png`, `owl-128.png`, `owl-512-white.png`. Сам знак не менялся. Тем же скриптом сняты цвета: синий `#194CA6`, оранжевый `#E9661C`, золотой `#D5AF53`. Знак отдан в задание [B-2.2-variants](../briefs/B-2.2-variants.md) — макеты интерфейса.

Не сделано: вектор SVG; уменьшенная версия для значка вкладки — на 16 пикселях глаза, клюв и микросхема сольются; сравнение с официальным знаком вуза словами — ТР-7. Замечание оркестратора: тело совы — в форме щита, а щит — геральдический образ; при сравнении на это смотреть первым.

Прежний план: участник выбирает одну картинку; субагент `designer` перерисовывает её кодом SVG по правилам задания [B-2.2-logo](../briefs/B-2.2-logo.md) — три файла, проверка на 16 пикселях; оркестратор с участником сравнивают знак с официальным знаком вуза словами — требование ТР-7; генератор и его условия записываются в `THIRD_PARTY.md` и в [перечень инструментов](../evidence/tools.md).
