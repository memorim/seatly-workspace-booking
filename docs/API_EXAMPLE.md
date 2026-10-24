# Пример: создать бронирование

Сначала выполните POST /api/login и сохраните cookie. Пример для POSIX shell; дату замените на будущую.

```sh
curl -c cookies.txt -H 'Content-Type: application/json' -d '{"email":"guest@seatly.example","password":"GuestDemo2026!"}' http://localhost:4200/api/login
curl -b cookies.txt -H 'Content-Type: application/json' -d '{"spaceId":3,"guestName":"Демо Гость","guestEmail":"guest@example.com","bookingDate":"2030-01-10","startTime":"10:00","endTime":"11:30","guests":2}' http://localhost:4200/api/bookings
```

```json
{"id":4,"spaceId":3,"guestName":"Демо Гость","guestEmail":"guest@example.com","bookingDate":"2030-01-10","startTime":"10:00","endTime":"11:30","guests":2,"totalPrice":1425,"status":"pending"}
```

id назначается базой и может отличаться. Цена вычисляется сервером. Пересекающаяся повторная заявка вернёт 409; соседний интервал разрешён.
