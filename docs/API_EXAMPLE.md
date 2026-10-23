# Пример API

Ответ получен при локальном запуске проверяемой версии. Данные демонстрационные.

```http
GET /api/spaces/1/availability?date=2030-01-10 HTTP/1.1
Host: localhost:4200
```

HTTP 200

```json
{
  "date": "2030-01-10",
  "bookings": []
}
```
