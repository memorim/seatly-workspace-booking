import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
const db = createDatabase(':memory:');
const app = createApp(db);
db.exec('BEGIN');
const insert = db.prepare(
  "INSERT INTO bookings(space_id,guest_name,guest_email,booking_date,start_time,end_time,guests,total_price,status,created_at,user_id,expires_at) VALUES (?,?,?,?,?,?,1,1800,?,'2026-10-24T00:00:00Z',1,'2035-01-01T00:00:00Z')",
);
for (let i = 0; i < 10000; i++) {
  const hour = 8 + Math.floor((i % 72) / 6);
  insert.run(
    (i % 6) + 1,
    'Synthetic ' + String(i).padStart(6, '0'),
    'fixture@example.com',
    new Date(Date.UTC(2030, 0, 1 + Math.floor(i / 72))).toISOString().slice(0, 10),
    String(hour).padStart(2, '0') + ':00',
    String(hour + 1).padStart(2, '0') + ':00',
    i % 5 === 0 ? 'cancelled' : 'confirmed',
  );
}
db.exec('COMMIT');
const sql =
    'SELECT id,space_id,booking_date FROM bookings WHERE user_id=? AND status=? ORDER BY booking_date DESC,id DESC LIMIT 40',
  args = [1, 'confirmed'];
const indexSql =
    'CREATE INDEX IF NOT EXISTS bookings_user_status_date ON bookings(user_id,status,booking_date DESC,id DESC);CREATE INDEX IF NOT EXISTS bookings_status_date ON bookings(status,booking_date DESC,id DESC);CREATE INDEX IF NOT EXISTS bookings_expiry ON bookings(status,expires_at);',
  expectedIndex = 'bookings_user_status_date';
const endpoint = '/api/bookings/page';
let options: RequestInit = {};

const measure = () => {
  const times: number[] = [];
  for (let i = 0; i < 60; i++) {
    const start = performance.now();
    const rows = db.prepare(sql).all(...args);
    assert.equal(rows.length, 40);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    p50_ms: Number(times[29].toFixed(4)),
    p95_ms: Number(times[56].toFixed(4)),
    plan: db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args),
  };
};
db.exec(
  'DROP INDEX IF EXISTS bookings_user_status_date;DROP INDEX IF EXISTS bookings_status_date;DROP INDEX IF EXISTS bookings_expiry;',
);
const before = measure();
db.exec(indexSql);
const after = measure();
assert.ok(after.plan.some((row) => String(row.detail).includes(expectedIndex)));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
try {
  const login = await fetch(origin + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'guest@seatly.example', password: 'GuestDemo2026!' }),
  });
  assert.equal(login.status, 200);
  options = { headers: { Cookie: login.headers.get('set-cookie')!.split(';')[0] } };
  const one = await (await fetch(origin + endpoint + '?limit=40&offset=0', options)).json(),
    two = await (await fetch(origin + endpoint + '?limit=40&offset=40', options)).json();
  assert.ok(one.total >= 10000);
  assert.equal(one.items.length, 40);
  assert.equal(two.items.length, 40);
  assert.equal(
    one.items.some((a: { id: number }) => two.items.some((b: { id: number }) => b.id === a.id)),
    false,
  );
  for (const invalid of ['limit=101', 'offset=-1', 'limit=bad', 'status=unknown'])
    assert.equal((await fetch(origin + endpoint + '?' + invalid, options)).status, 400);
  const filtered = await (
    await fetch(origin + endpoint + '?limit=10&search=Synthetic%20009999', options)
  ).json();
  assert.equal(filtered.total, 1);
  const report = {
    kind: 'synthetic-sqlite-scale',
    date: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    synthetic_records: 10000,
    page_size: 40,
    non_overlapping_pages: true,
    filtered_matches: filtered.total,
    before,
    after,
    limits:
      'Fresh in-memory SQLite; query microbenchmark and loopback API correctness, not hosted capacity or real users.',
  };
  await writeFile('docs/SCALE_METRICS.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
}
