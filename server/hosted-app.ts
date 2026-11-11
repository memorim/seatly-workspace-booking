import { requestLog, safeError, type LogSink } from './observability.js';
import express, { type Express } from 'express';
import { bookingSchema, slotSchema, priceFor, HOLD_MS } from '../src/booking-rules.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PostgresStore } from './postgres.js';
import { installHostedAuth, publicOrigin, takeBudget } from './hosted-auth.js';
import { bookingPageOptions } from '../src/pagination.js';
import type { User } from './auth.js';

const parseSpace = (row: Record<string, unknown>) => ({
  ...row,
  amenities: JSON.parse(String(row.amenities)),
});

export function createHostedApp(store: PostgresStore, log?: LogSink): Express {
  const origin = publicOrigin();
  const db = {
    prepare(sql: string) {
      const query = (args: unknown[]) => {
        let n = 0;
        if (args.length === 1 && args[0] && typeof args[0] === 'object') {
          const named = args[0] as Record<string, unknown>;
          const values: unknown[] = [];
          const text = sql.replace(/\$[a-z_]+/gi, (key) => {
            values.push(named[key]);
            return '$' + values.length;
          });
          return store.query(text, values);
        }
        let text = sql.replace(/\?/g, () => '$' + ++n);
        if (/^INSERT INTO bookings /i.test(text)) text += ' RETURNING id';
        return store.query(text, args);
      };
      return {
        get: async (...args: unknown[]) => (await query(args)).rows[0],
        all: async (...args: unknown[]) => (await query(args)).rows,
        run: async (...args: unknown[]) => {
          const r = await store.transaction(() => query(args));
          return { changes: r.rowCount, lastInsertRowid: r.rows[0]?.id };
        },
      };
    },
  };
  const app = express();
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const revision = /^[a-f0-9]{40}$/i.test(process.env.APP_REVISION || '')
    ? process.env.APP_REVISION
    : process.env.RENDER_GIT_COMMIT || 'local-unversioned';
  app.use('/api/health', (_req, res, next) => {
    res.set('X-App-Revision', revision);
    next();
  });

  app.use(requestLog(log));
  app.use(express.json({ limit: '16kb' }));
  app.set('trust proxy', 1);
  installHostedAuth(app, store, origin);
  app.use('/api', async (_req, _res, next) => {
    await store.transaction(() =>
      store.query(
        "UPDATE bookings SET status='expired' WHERE status='pending' AND expires_at<=$1",
        [new Date().toISOString()],
      ),
    );
    next();
  });

  app.get('/api/health', async (_req, res) => {
    await store.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.get('/api/spaces', async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const district = typeof req.query.district === 'string' ? req.query.district : '';
    const capacity = Number(req.query.capacity || 0);
    const clauses: string[] = [];
    const params: Record<string, string | number> = {};
    if (type && type !== 'Все') {
      clauses.push('type = $type');
      params.$type = type;
    }
    if (district) {
      clauses.push('district = $district');
      params.$district = district;
    }
    if (capacity) {
      clauses.push('capacity >= $capacity');
      params.$capacity = capacity;
    }
    const rows = (await db
      .prepare(
        `SELECT * FROM spaces ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY rating DESC, reviews DESC`,
      )
      .all(params)) as Record<string, unknown>[];
    res.json(rows.map(parseSpace));
  });

  app.get('/api/spaces/:id', async (req, res) => {
    const row = (await db
      .prepare('SELECT * FROM spaces WHERE id = ?')
      .get(Number(req.params.id))) as Record<string, unknown> | undefined;
    if (!row) return res.status(404).json({ message: 'Пространство не найдено' });
    res.json(parseSpace(row));
  });

  app.get('/api/spaces/:id/availability', async (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    if (!bookingSchema.shape.bookingDate.safeParse(date).success)
      return res.status(400).json({ message: 'Укажите корректную дату' });
    if (!(await db.prepare('SELECT id FROM spaces WHERE id = ?').get(Number(req.params.id))))
      return res.status(404).json({ message: 'Пространство не найдено' });
    const bookings = await db
      .prepare(
        `SELECT start_time, end_time FROM bookings WHERE space_id = ? AND booking_date = ? AND status IN ('pending','confirmed') ORDER BY start_time`,
      )
      .all(Number(req.params.id), date);
    res.json({ date, bookings });
  });

  app.get(['/api/bookings', '/api/bookings/page'], async (req, res) => {
    let options;
    try {
      options = bookingPageOptions(new URL(req.originalUrl, 'http://local').searchParams);
    } catch (e) {
      return res.status(400).json({ message: (e as Error).message });
    }
    const user = res.locals.user as User,
      { limit, offset, search, status } = options,
      clauses: string[] = [],
      values: (string | number)[] = [];
    if (user.role !== 'owner') {
      clauses.push('b.user_id=?');
      values.push(user.id);
    }
    if (status) {
      clauses.push('b.status=?');
      values.push(status);
    }
    if (search) {
      clauses.push('(b.guest_name LIKE ? OR s.name LIKE ?)');
      values.push('%' + search + '%', '%' + search + '%');
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '',
      join = ' FROM bookings b JOIN spaces s ON s.id=b.space_id';
    const total = Number(
      (await db.prepare('SELECT COUNT(*) total' + join + where).get(...values))?.total || 0,
    );
    const items = await db
      .prepare(
        'SELECT b.id,b.space_id,b.user_id,b.guest_name,b.booking_date,b.start_time,b.end_time,b.guests,b.total_price,b.status,b.expires_at,s.name space_name,s.address' +
          join +
          where +
          ' ORDER BY b.booking_date DESC,b.id DESC LIMIT ? OFFSET ?',
      )
      .all(...values, limit, offset);
    return res.json(req.path.endsWith('/page') ? { items, total, limit, offset } : items);
  });

  app.post('/api/bookings', async (req, res) => {
    if (!(await takeBudget(store, 'booking:' + res.locals.user.id, 20, 60000)))
      return res
        .status(429)
        .set('Retry-After', '60')
        .json({ message: 'Слишком много попыток бронирования' });
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: 'Проверьте данные бронирования', issues: parsed.error.flatten() });
    const b = parsed.data,
      payload = JSON.stringify(b),
      rawKey = req.get('Idempotency-Key');
    if (rawKey !== undefined && !/^[A-Za-z0-9_-]{8,128}$/.test(rawKey))
      return res.status(400).json({ message: 'Некорректный ключ операции' });
    const key = rawKey ? res.locals.user.id + ':' + rawKey : null;
    try {
      const reply = await store.transaction(async () => {
        if (key) {
          const previous = (await db
            .prepare('SELECT request_payload,create_result FROM bookings WHERE request_key=?')
            .get(key)) as { request_payload: string; create_result: string } | undefined;
          if (previous) {
            return previous.request_payload === payload
              ? { code: 201, body: JSON.parse(previous.create_result) }
              : { code: 409, body: { message: 'Ключ уже использован с другими данными' } };
          }
        }
        const space = (await db.prepare('SELECT * FROM spaces WHERE id=?').get(b.spaceId)) as
          { hourly_price: number; capacity: number } | undefined;
        if (!space) {
          return { code: 404, body: { message: 'Пространство не найдено' } };
        }
        const total = priceFor(space, b),
          expiresAt = new Date(Date.now() + HOLD_MS).toISOString();
        const result = await db
          .prepare(
            `INSERT INTO bookings (space_id,guest_name,guest_email,booking_date,start_time,end_time,guests,total_price,status,created_at,user_id,expires_at,request_key,request_payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            b.spaceId,
            b.guestName,
            b.guestEmail,
            b.bookingDate,
            b.startTime,
            b.endTime,
            b.guests,
            total,
            'pending',
            new Date().toISOString(),
            res.locals.user.id,
            expiresAt,
            key,
            key ? payload : null,
          );
        const response = {
          id: Number(result.lastInsertRowid),
          ...b,
          totalPrice: total,
          status: 'pending',
          expiresAt,
        };
        if (key)
          await db
            .prepare('UPDATE bookings SET create_result=? WHERE id=?')
            .run(JSON.stringify(response), result.lastInsertRowid);
        return { code: 201, body: response };
      });
      res.status(reply.code).json(reply.body);
    } catch (error) {
      if (error instanceof RangeError) return res.status(400).json({ message: error.message });
      if (String(error).includes('booking_overlap'))
        return res.status(409).json({ message: 'Это время уже занято. Выберите другой интервал' });
      res.status(503).json({ message: 'Не удалось сохранить бронирование. Повторите запрос' });
    }
  });

  app.delete('/api/bookings/:id', async (req, res) => {
    const user = res.locals.user as User;
    const result = await db
      .prepare(`UPDATE bookings SET status='cancelled' WHERE id=? AND (?='owner' OR user_id=?)`)
      .run(Number(req.params.id), user.role, user.id);
    if (!result.changes) return res.status(404).json({ message: 'Бронирование не найдено' });
    res.status(204).end();
  });
  app.patch('/api/bookings/:id/confirm', async (req, res) => {
    if (res.locals.user.role !== 'owner')
      return res.status(403).json({ message: 'Подтвердить может только владелец' });
    const result = await db
      .prepare(
        "UPDATE bookings SET status='confirmed' WHERE id=? AND status='pending' AND expires_at>?",
      )
      .run(Number(req.params.id), new Date().toISOString());
    if (!result.changes)
      return res.status(404).json({ message: 'Ожидающее бронирование не найдено' });
    res.json({ id: Number(req.params.id), status: 'confirmed' });
  });

  app.patch('/api/bookings/:id/reschedule', async (req, res) => {
    const parsed = slotSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: 'Проверьте дату, время и количество гостей' });
    const user = res.locals.user as User;
    try {
      const reply = await store.transaction(async () => {
        const old = (await db
          .prepare(
            "SELECT b.*,s.hourly_price,s.capacity FROM bookings b JOIN spaces s ON s.id=b.space_id WHERE b.id=? AND (?='owner' OR b.user_id=?)",
          )
          .get(Number(req.params.id), user.role, user.id)) as
          { id: number; status: string; hourly_price: number; capacity: number } | undefined;
        if (!old) {
          return { code: 404, body: { message: 'Бронирование не найдено' } };
        }
        if (!['pending', 'confirmed'].includes(old.status)) {
          return { code: 409, body: { message: 'Перенос доступен для действующей заявки' } };
        }
        const b = parsed.data,
          total = priceFor(old, b),
          expiresAt = new Date(Date.now() + HOLD_MS).toISOString();
        await db
          .prepare(
            "UPDATE bookings SET booking_date=?,start_time=?,end_time=?,guests=?,total_price=?,status='pending',expires_at=? WHERE id=?",
          )
          .run(b.bookingDate, b.startTime, b.endTime, b.guests, total, expiresAt, old.id);
        return { code: 200, body: { id: old.id, status: 'pending', totalPrice: total, expiresAt } };
      });
      return res.status(reply.code).json(reply.body);
    } catch (e) {
      if (e instanceof RangeError) return res.status(400).json({ message: e.message });
      if (String(e).includes('booking_overlap'))
        return res
          .status(409)
          .json({ message: 'Новое время занято. Исходное бронирование сохранено.' });
      return res
        .status(503)
        .json({ message: 'Не удалось перенести бронирование. Исходные данные сохранены.' });
    }
  });

  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api(?:\/|$)|\/assets\/|\/photos\/).*/, (_req, res) =>
      res.sendFile(resolve(dist, 'index.html')),
    );
  }
  app.use((_req, res) => res.status(404).json({ message: 'Маршрут не найден' }));
  app.use(safeError);
  return app;
}
