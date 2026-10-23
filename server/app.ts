import express, { type Express } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDatabase, type Db } from './db.js';

const bookingSchema = z.object({
  spaceId: z.number().int().positive(), guestName: z.string().trim().min(2).max(80),
  guestEmail: z.string().email(), bookingDate: z.string().date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  guests: z.number().int().positive(),
});

const parseSpace = (row: Record<string, unknown>) => ({ ...row, amenities: JSON.parse(String(row.amenities)) });
const minutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };

export function createApp(db: Db = createDatabase()): Express {
  const app = express();
  app.use(cors()); app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/spaces', (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const district = typeof req.query.district === 'string' ? req.query.district : '';
    const capacity = Number(req.query.capacity || 0);
    const clauses: string[] = []; const params: Record<string, string | number> = {};
    if (type && type !== 'Все') { clauses.push('type = $type'); params.$type = type; }
    if (district) { clauses.push('district = $district'); params.$district = district; }
    if (capacity) { clauses.push('capacity >= $capacity'); params.$capacity = capacity; }
    const rows = db.prepare(`SELECT * FROM spaces ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY rating DESC, reviews DESC`).all(params) as Record<string, unknown>[];
    res.json(rows.map(parseSpace));
  });

  app.get('/api/spaces/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM spaces WHERE id = ?').get(Number(req.params.id)) as Record<string, unknown> | undefined;
    if (!row) return res.status(404).json({ message: 'Пространство не найдено' });
    res.json(parseSpace(row));
  });

  app.get('/api/spaces/:id/availability', (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    if (!bookingSchema.shape.bookingDate.safeParse(date).success) return res.status(400).json({ message: 'Укажите корректную дату' });
    if (!db.prepare('SELECT id FROM spaces WHERE id = ?').get(Number(req.params.id))) return res.status(404).json({ message: 'Пространство не найдено' });
    const bookings = db.prepare(`SELECT start_time, end_time FROM bookings WHERE space_id = ? AND booking_date = ? AND status = 'confirmed' ORDER BY start_time`).all(Number(req.params.id), date);
    res.json({ date, bookings });
  });

  app.get('/api/bookings', (_req, res) => {
    const bookings = db.prepare(`SELECT b.*, s.name space_name, s.address FROM bookings b JOIN spaces s ON s.id=b.space_id ORDER BY booking_date, start_time`).all();
    res.json(bookings);
  });

  app.post('/api/bookings', (req, res) => {
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Проверьте данные бронирования', issues: parsed.error.flatten() });
    const b = parsed.data; const start = minutes(b.startTime); const end = minutes(b.endTime);
    if (start < 8 * 60 || end > 22 * 60 || end - start < 60) return res.status(400).json({ message: 'Бронирование доступно с 08:00 до 22:00, минимум на один час' });
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(b.spaceId) as { hourly_price: number; capacity: number } | undefined;
    if (!space) return res.status(404).json({ message: 'Пространство не найдено' });
    if (b.guests > space.capacity) return res.status(400).json({ message: `Максимальная вместимость — ${space.capacity}` });
    const conflict = db.prepare(`SELECT id FROM bookings WHERE space_id = ? AND booking_date = ? AND status = 'confirmed' AND start_time < ? AND end_time > ?`).get(b.spaceId, b.bookingDate, b.endTime, b.startTime);
    if (conflict) return res.status(409).json({ message: 'Это время уже занято. Выберите другой интервал' });
    const total = ((end - start) / 60) * space.hourly_price;
    const result = db.prepare(`INSERT INTO bookings (space_id,guest_name,guest_email,booking_date,start_time,end_time,guests,total_price,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(b.spaceId,b.guestName,b.guestEmail,b.bookingDate,b.startTime,b.endTime,b.guests,total,'confirmed',new Date().toISOString());
    res.status(201).json({ id: Number(result.lastInsertRowid), ...b, totalPrice: total, status: 'confirmed' });
  });

  app.delete('/api/bookings/:id', (req, res) => {
    const result = db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed'`).run(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ message: 'Активное бронирование не найдено' });
    res.status(204).end();
  });

  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((_req, res) => res.status(404).json({ message: 'Маршрут не найден' }));
  return app;
}
