import express, { type Express } from 'express';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDatabase, type Db } from './db.js';
import { installAuth, type User } from './auth.js';

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
  app.use(express.json({ limit: '16kb' })); installAuth(app, db);

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
    const bookings = db.prepare(`SELECT start_time, end_time FROM bookings WHERE space_id = ? AND booking_date = ? AND status IN ('pending','confirmed') ORDER BY start_time`).all(Number(req.params.id), date);
    res.json({ date, bookings });
  });

  app.get('/api/bookings', (_req, res) => {
    const user = res.locals.user as User;
    const bookings = db.prepare(`SELECT b.*, s.name space_name, s.address FROM bookings b JOIN spaces s ON s.id=b.space_id WHERE (?='owner' OR b.user_id=?) ORDER BY booking_date DESC, start_time`).all(user.role, user.id);
    res.json(bookings);
  });

  app.post('/api/bookings', (req, res) => {
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Проверьте данные бронирования', issues: parsed.error.flatten() });
    const b = parsed.data; const start = minutes(b.startTime); const end = minutes(b.endTime);
    if (new Date(`${b.bookingDate}T${b.startTime}:00+03:00`).getTime() <= Date.now()) return res.status(400).json({ message: 'Выберите будущее время по Москве' });
    if (start < 8 * 60 || end > 22 * 60 || end - start < 60) return res.status(400).json({ message: 'Бронирование доступно с 08:00 до 22:00, минимум на один час' });
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(b.spaceId) as { hourly_price: number; capacity: number } | undefined;
    if (!space) return res.status(404).json({ message: 'Пространство не найдено' });
    if (b.guests > space.capacity) return res.status(400).json({ message: `Максимальная вместимость — ${space.capacity}` });
    const total = Math.round(((end - start) / 60) * space.hourly_price);
    try {
      db.exec('BEGIN IMMEDIATE');
      const result = db.prepare(`INSERT INTO bookings (space_id,guest_name,guest_email,booking_date,start_time,end_time,guests,total_price,status,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(b.spaceId,b.guestName,b.guestEmail,b.bookingDate,b.startTime,b.endTime,b.guests,total,'pending',new Date().toISOString(),res.locals.user.id);
      db.exec('COMMIT');
      res.status(201).json({ id: Number(result.lastInsertRowid), ...b, totalPrice: total, status: 'pending' });
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      if (String(error).includes('booking_overlap')) return res.status(409).json({ message: 'Это время уже занято. Выберите другой интервал' });
      res.status(503).json({ message: 'Не удалось сохранить бронирование. Повторите запрос' });
    }
  });

  app.delete('/api/bookings/:id', (req, res) => {
    const user = res.locals.user as User;
    const result = db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=? AND (?='owner' OR user_id=?)`).run(Number(req.params.id), user.role, user.id);
    if (!result.changes) return res.status(404).json({ message: 'Бронирование не найдено' });
    res.status(204).end();
  });
  app.patch('/api/bookings/:id/confirm', (req, res) => {
    if (res.locals.user.role !== 'owner') return res.status(403).json({ message: 'Подтвердить может только владелец' });
    const result = db.prepare("UPDATE bookings SET status='confirmed' WHERE id=? AND status='pending'").run(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ message: 'Ожидающее бронирование не найдено' });
    res.json({ id: Number(req.params.id), status: 'confirmed' });
  });

  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((_req, res) => res.status(404).json({ message: 'Маршрут не найден' }));
  return app;
}
