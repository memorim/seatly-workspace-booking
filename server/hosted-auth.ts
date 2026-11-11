import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Express } from 'express';
import type { PostgresStore } from './postgres.js';
import type { User } from './auth.js';

const derive = promisify(scrypt);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
let activeHashes = 0;
async function passwordHash(password: string, salt: string) {
  if (activeHashes >= 2) throw new Error('Password service busy');
  activeHashes++;
  try {
    return (await derive(password, salt, 64)) as Buffer;
  } finally {
    activeHashes--;
  }
}
export function publicOrigin(value = process.env.SEATLY_PUBLIC_ORIGIN || '') {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('SEATLY_PUBLIC_ORIGIN must be an exact HTTPS origin');
  return url.origin;
}
export async function provisionAccount(
  db: PostgresStore,
  input: { name: string; email: string; password: string; role: string },
) {
  const email = input.email.trim().toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 120 ||
    !['guest', 'owner'].includes(input.role) ||
    input.name.trim().length < 2 ||
    input.name.length > 80 ||
    input.password.length < 20 ||
    input.password.length > 128 ||
    email.endsWith('@seatly.example')
  )
    throw new Error(
      'Provide a name, individual email, guest/owner role and a password of 20–128 characters',
    );
  const salt = randomBytes(16).toString('hex');
  const hash = await passwordHash(input.password, salt);
  // Provisioning never overwrites a password on subsequent starts.
  await db.query(
    'INSERT INTO users(name,email,role,salt,password_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING',
    [input.name.trim(), email, input.role, salt, hash.toString('hex')],
  );
}
export async function takeBudget(db: PostgresStore, key: string, limit: number, interval = 600000) {
  const now = Date.now();
  const result = await db.query(
    `INSERT INTO login_budgets(key,attempts,expires_at) VALUES($1,1,$2)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_budgets.expires_at<=$3 THEN 1 ELSE LEAST(login_budgets.attempts+1,$4) END,
    expires_at=CASE WHEN login_budgets.expires_at<=$3 THEN $2 ELSE login_budgets.expires_at END RETURNING attempts`,
    [digest(key), now + interval, now, limit + 1],
  );
  return result.rows[0].attempts <= limit;
}
export function installHostedAuth(app: Express, db: PostgresStore, origin: string) {
  const hostname = new URL(origin).hostname;
  app.use(async (req, res, next) => {
    if (
      req.hostname !== hostname ||
      (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (req.get('origin') !== origin || req.get('sec-fetch-site') === 'cross-site'))
    )
      return res.status(403).json({ message: 'Недопустимый источник запроса' });
    const token = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('seatly_session='))
      ?.slice(15);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const result = await db.query<User>(
        'SELECT u.id,u.name,u.email,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>$2',
        [digest(token), Date.now()],
      );
      res.locals.user = result.rows[0];
    }
    next();
  });
  app.get('/api/session', (_req, res) =>
    res.json({ user: res.locals.user || null, mode: 'public' }),
  );
  app.post('/api/login', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!email || email.length > 120 || typeof password !== 'string' || password.length > 128)
      return res.status(400).json({ message: 'Укажите почту и пароль' });
    const allowed = await takeBudget(db, 'login-ip:' + req.ip, 30);
    if (!allowed || !(await takeBudget(db, 'login-email:' + email, 10)))
      return res
        .status(429)
        .set('Retry-After', '600')
        .json({ message: 'Слишком много попыток. Повторите через 10 минут' });
    const row = (
      await db.query<User & { salt: string; password_hash: string }>(
        'SELECT * FROM users WHERE email=$1',
        [email],
      )
    ).rows[0];
    const actual = await passwordHash(password, row?.salt || 'missing-account');
    if (!row || !timingSafeEqual(actual, Buffer.from(row.password_hash, 'hex')))
      return res.status(401).json({ message: 'Неверная почта или пароль' });
    const token = randomBytes(32).toString('hex');
    await db.query('DELETE FROM sessions WHERE expires_at<=$1', [Date.now()]);
    await db.query('DELETE FROM login_budgets WHERE expires_at<$1', [Date.now()]);
    await db.query('INSERT INTO sessions VALUES($1,$2,$3)', [
      digest(token),
      row.id,
      Date.now() + 86400000,
    ]);
    res.cookie('seatly_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      path: '/',
      maxAge: 86400000,
    });
    res.json({ id: row.id, name: row.name, email: row.email, role: row.role });
  });
  app.post('/api/logout', async (req, res) => {
    const token = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('seatly_session='))
      ?.slice(15);
    if (token) await db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
    res.clearCookie('seatly_session', {
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      path: '/',
    });
    res.status(204).end();
  });
  app.use('/api/bookings', (_req, res, next) =>
    res.locals.user ? next() : res.status(401).json({ message: 'Войдите в личный кабинет' }),
  );
}
