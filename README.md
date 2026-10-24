# Seatly — бронирование рабочих пространств

Выбор помещения, заявка на бронирование, подтверждение владельцем и отмена.

**Проект:** Самостоятельная разработка.

![CI](https://github.com/memorim/seatly-workspace-booking/actions/workflows/ci.yml/badge.svg)

[Серверное демо](https://memorim-flowboard-live.amusedcorgi34.chatgpt.site/seatly/index.html) · [Браузерное демо](https://memorim.github.io/seatly-workspace-booking/) · [Разбор проекта](docs/CASE_STUDY.md) · [Видео: около минуты](docs/walkthrough.webm)

![Компьютерная версия](docs/desktop.png)

<img src="docs/mobile.png" width="320" alt="Мобильная версия">

[Короткий сценарий GIF](docs/demo.gif)

## Что работает
- Поиск по названию и району, фильтры по типу и вместимости, избранное.
- Будущая дата, время по Москве, доступность, цена с точностью до минуты.
- Серверные сессии, кабинеты гостя и владельца, личный список бронирований.
- Заявка → ожидание до 30 минут → подтверждение, отмена или истечение срока.
- Перенос заявки с новым расчётом цены и повторным подтверждением; конфликт оставляет исходную бронь.
- Адаптивные формы, загрузка, ошибки с повтором и пустые результаты.

## Запуск и проверка
Node.js 24.18.0, pnpm 11.7.0. Стек: React, TypeScript, Vite, Express, SQLite, Zod.

```bash
npm install --global pnpm@11.7.0
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
pnpm build
pnpm start
```

## Технические решения
- `BEGIN IMMEDIATE` и триггеры SQLite защищают от пересечений при записи, включая прямой SQL и другие соединения. Соседние интервалы разрешены.
- Pending и confirmed занимают место; cancelled и expired не участвуют. Ожидание ограничено 30 минутами, истёкшие резервы освобождаются при следующем API-запросе.
- Цена и владелец заявки определяются сервером. Гость не видит и не отменяет чужие заявки.
- Пароли хешируются scrypt; непрозрачные сессии хранятся по SHA-256, cookie HttpOnly/SameSite; выход отзывает сессию.

[API и конфигурация](docs/TECHNICAL.md) · [Пример API](docs/API_EXAMPLE.md) · [Результаты проверок](docs/VERIFICATION.md)

[Сценарии проверок](docs/SYNTHETIC_TESTING.md) · [Замеры](docs/SYNTHETIC_METRICS.json) · [Подготовка к собеседованию](docs/INTERVIEW.md)

`pnpm measure` повторяет локальное измерение HTTP. `pnpm build:hosted` создаёт клиент для `/seatly/` и `/api/seatly`; API адаптер размещён вместе с демонстрацией Flowboard. `hosting/` содержит выдержки серверного адаптера и схемы, не самостоятельный deploy-проект.

## Надёжность и эксплуатация

[Повторные запросы, большие данные и журнал](docs/ROUND3.md) · [Резервные копии по расписанию](docs/SCHEDULED_BACKUPS.md).

## Проверки и обновления
CI проверяет проект и ссылки на локальные материалы. Dependabot предлагает обновления зависимостей и Actions. [История изменений](CHANGELOG.md).

[Контракты API и обновление базы](docs/COMPATIBILITY.md): `pnpm test:contract && pnpm test:upgrade`.
