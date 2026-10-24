import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Express } from 'express';
import type { Db } from './db.js';

export interface User { id: number; name: string; email: string; role: 'guest' | 'owner' }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function installAuth(app: Express, db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);`);
  for (const u of [{ id: 1, name: 'Демо-гость', email: 'guest@seatly.example', role: 'guest', password: 'GuestDemo2026!' }, { id: 2, name: 'Демо-владелец', email: 'owner@seatly.example', role: 'owner', password: 'OwnerDemo2026!' }]) {
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(u.id)) {
      const salt = randomBytes(16).toString('hex');
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(u.id, u.name, u.email, u.role, salt, scryptSync(u.password, salt, 64).toString('hex'));
    }
  }
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && req.get('origin') !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ message: 'Недопустимый источник запроса' });
    const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('seatly_session='))?.slice(15);
    if (token) res.locals.user = db.prepare('SELECT u.id,u.name,u.email,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token), Date.now());
    next();
  });
  app.get('/api/session', (_req, res) => res.json({ user: res.locals.user ?? null, mode: 'server' }));
  // ponytail: a per-process login limit is sufficient for this local demo; use a shared limiter before multiple public replicas.
  const failures = new Map<string, { count: number; until: number }>();
  app.post('/api/login', (req, res) => {
    const key = req.ip || 'local'; const now = Date.now();
    for (const [k, value] of failures) if (value.until < now) failures.delete(k);
    const failed = failures.get(key);
    if (failed && failed.count >= 10) return res.status(429).json({ message: 'Слишком много попыток. Повторите через 10 минут' });
    if (typeof req.body?.email !== 'string' || req.body.email.length > 120 || typeof req.body.password !== 'string' || req.body.password.length > 128) return res.status(400).json({ message: 'Укажите почту и пароль' });
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(req.body.email.trim().toLowerCase()) as (User & { salt: string; password_hash: string }) | undefined;
    const actual = scryptSync(req.body.password, u?.salt || 'missing-account', 64);
    if (!u || !timingSafeEqual(actual, Buffer.from(u.password_hash, 'hex'))) {
      failures.set(key, { count: (failed?.count || 0) + 1, until: now + 600_000 });
      return res.status(401).json({ message: 'Неверная почта или пароль' });
    }
    failures.delete(key); db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), u.id, now + 86_400_000);
    res.cookie('seatly_session', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 86_400_000, path: '/' });
    res.json({ id: u.id, name: u.name, email: u.email, role: u.role });
  });
  app.post('/api/logout', (req, res) => {
    const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('seatly_session='))?.slice(15);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
    res.clearCookie('seatly_session', { path: '/', httpOnly: true, sameSite: 'strict', secure: req.secure }); res.status(204).end();
  });
  app.use('/api/bookings', (_req, res, next) => res.locals.user ? next() : res.status(401).json({ message: 'Войдите в личный кабинет' }));
}
