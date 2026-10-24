import express, { type Express } from 'express';
import {bookingSchema,slotSchema,priceFor,HOLD_MS} from '../src/booking-rules.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDatabase, type Db } from './db.js';
import { installAuth, type User } from './auth.js';

const parseSpace = (row: Record<string, unknown>) => ({ ...row, amenities: JSON.parse(String(row.amenities)) });

export function createApp(db: Db = createDatabase()): Express {
  const app = express();
  app.use(express.json({ limit: '16kb' })); installAuth(app, db);
  app.use('/api',(_req,_res,next)=>{db.prepare("UPDATE bookings SET status='expired' WHERE status='pending' AND expires_at<=?").run(new Date().toISOString());next();});

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
    const b = parsed.data;
    const space=db.prepare('SELECT * FROM spaces WHERE id=?').get(b.spaceId) as {hourly_price:number;capacity:number}|undefined;
    if(!space)return res.status(404).json({message:'Пространство не найдено'});
    let total:number;try{total=priceFor(space,b);}catch(e){return res.status(400).json({message:e instanceof Error?e.message:'Проверьте время'});}
    const expiresAt=new Date(Date.now()+HOLD_MS).toISOString();
    try {
      db.exec('BEGIN IMMEDIATE');
      const result = db.prepare(`INSERT INTO bookings (space_id,guest_name,guest_email,booking_date,start_time,end_time,guests,total_price,status,created_at,user_id,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.spaceId,b.guestName,b.guestEmail,b.bookingDate,b.startTime,b.endTime,b.guests,total,'pending',new Date().toISOString(),res.locals.user.id,expiresAt);
      db.exec('COMMIT');
      res.status(201).json({ id: Number(result.lastInsertRowid), ...b, totalPrice: total, status: 'pending', expiresAt });
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
    const result = db.prepare("UPDATE bookings SET status='confirmed' WHERE id=? AND status='pending' AND expires_at>?").run(Number(req.params.id),new Date().toISOString());
    if (!result.changes) return res.status(404).json({ message: 'Ожидающее бронирование не найдено' });
    res.json({ id: Number(req.params.id), status: 'confirmed' });
  });

  app.patch('/api/bookings/:id/reschedule',(req,res)=>{
    const parsed=slotSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Проверьте дату, время и количество гостей'});
    const user=res.locals.user as User;
    try{
      db.exec('BEGIN IMMEDIATE');
      const old=db.prepare("SELECT b.*,s.hourly_price,s.capacity FROM bookings b JOIN spaces s ON s.id=b.space_id WHERE b.id=? AND (?='owner' OR b.user_id=?)").get(Number(req.params.id),user.role,user.id) as {id:number;status:string;hourly_price:number;capacity:number}|undefined;
      if(!old){db.exec('ROLLBACK');return res.status(404).json({message:'Бронирование не найдено'});}
      if(!['pending','confirmed'].includes(old.status)){db.exec('ROLLBACK');return res.status(409).json({message:'Перенос доступен для действующей заявки'});}
      const b=parsed.data,total=priceFor(old,b),expiresAt=new Date(Date.now()+HOLD_MS).toISOString();
      db.prepare("UPDATE bookings SET booking_date=?,start_time=?,end_time=?,guests=?,total_price=?,status='pending',expires_at=? WHERE id=?").run(b.bookingDate,b.startTime,b.endTime,b.guests,total,expiresAt,old.id);
      db.exec('COMMIT');return res.json({id:old.id,status:'pending',totalPrice:total,expiresAt});
    }catch(e){if(db.isTransaction)db.exec('ROLLBACK');if(e instanceof RangeError)return res.status(400).json({message:e.message});if(String(e).includes('booking_overlap'))return res.status(409).json({message:'Новое время занято. Исходное бронирование сохранено.'});return res.status(503).json({message:'Не удалось перенести бронирование. Исходные данные сохранены.'});}
  });

  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((_req, res) => res.status(404).json({ message: 'Маршрут не найден' }));
  return app;
}
