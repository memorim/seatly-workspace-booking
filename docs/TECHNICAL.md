# Устройство Seatly

## Запуск
Node.js 24, pnpm 11. `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm start`. Интерфейс и API работают на одном origin, порт 4200. Режим разработки: `pnpm dev`.

SQLite хранится в `data/seatly.db`, каталог создаётся автоматически. Не удаляйте его для обновления. Добавление user_id, таблиц пользователей и сессий выполняется совместимо при старте; старые записи сохраняются.

## Контракт
- POST /api/login — email/password; сервер устанавливает HttpOnly cookie.
- GET /api/session; POST /api/logout.
- GET /api/spaces; GET /api/spaces/:id/availability?date=YYYY-MM-DD — только интервалы, без контактов.
- GET /api/bookings — свои заявки; владельцу доступны все.
- POST /api/bookings — spaceId, guestName, guestEmail, bookingDate, startTime, endTime, guests. Ответ 201; пересечение 409; ошибка хранения 503.
- PATCH /api/bookings/:id/confirm — только владелец, pending → confirmed.
- DELETE /api/bookings/:id — отмена, повторная отмена существующей заявки возвращает 204.

Время бронирования — Москва. Pending и confirmed блокируют интервал. Триггеры проверяют пересечение по строгим неравенствам; окончание предыдущего в момент начала следующего разрешено. BEGIN IMMEDIATE захватывает блокировку записи до вставки, WAL и busy_timeout уменьшают конфликты читателей/писателей.

Ограничения: публичные учебные аккаунты, нет регистрации, оплаты и уведомлений. Ограничитель входа хранится в памяти процесса. Это локальный серверный пример, не готовый коммерческий сервис.
