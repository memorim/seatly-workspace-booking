import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { expireBookings, bookingExpiry } from '../server/booking-expiry.js';

const slot = {
  spaceId: 3,
  guestName: 'Restart fixture',
  guestEmail: 'fixture@example.test',
  bookingDate: '2030-12-10',
  startTime: '10:00',
  endTime: '11:00',
  guests: 1,
};
test('idle cleanup expires only overdue pending holds, is repeatable, stops and tolerates a DB error', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const db = createDatabase(':memory:');
  let now = '2026-10-25T00:00:00.000Z';
  const logs: object[] = [];
  const scheduler = bookingExpiry(db, { now: () => now, log: (event) => logs.push(event) });
  try {
    db.prepare(
      "INSERT INTO bookings(space_id,guest_name,guest_email,booking_date,start_time,end_time,guests,total_price,status,created_at,expires_at) VALUES(3,'Fixture','a@example.test','2030-12-10','10:00','11:00',1,950,'pending','now',?)",
    ).run('2026-10-25T00:00:10.000Z');
    scheduler.start();
    scheduler.start();
    assert.equal(
      db.prepare("SELECT status FROM bookings WHERE guest_name='Fixture'").get()?.status,
      'pending',
    );
    now = '2026-10-25T00:00:30.000Z';
    t.mock.timers.tick(30000);
    assert.equal(
      db.prepare("SELECT status FROM bookings WHERE guest_name='Fixture'").get()?.status,
      'expired',
    );
    assert.equal(expireBookings(db, now), 0);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM bookings WHERE status='confirmed'").get()?.n,
      3,
    );
    db.close();
    t.mock.timers.tick(30000);
    assert.equal(logs.length, 1);
    scheduler.stop();
    t.mock.timers.tick(60000);
    assert.equal(logs.length, 1);
  } finally {
    scheduler.stop();
    if (db.isOpen) db.close();
  }
});

test('SQLITE_BUSY returns a safe error without consuming a key; sessions/replay/expiry survive reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'seatly-restart-')),
    file = join(dir, 'fixture.sqlite');
  let db = createDatabase(file),
    blocker;
  try {
    let app = createApp(db, () => {});
    const agent = request.agent(app);
    const login = await agent
      .post('/api/login')
      .send({ email: 'guest@seatly.example', password: 'GuestDemo2026!' });
    assert.equal(login.status, 200);
    const cookie = String(login.headers['set-cookie'][0]).split(';')[0];
    blocker = createDatabase(file);
    db.exec('PRAGMA busy_timeout=1');
    blocker.exec('BEGIN IMMEDIATE');
    const failed = await agent
      .post('/api/bookings')
      .set('Idempotency-Key', 'restart-fixture-key')
      .send(slot);
    assert.equal(failed.status, 503);
    assert.doesNotMatch(JSON.stringify(failed.body), /SQLITE|database|SELECT|UPDATE/);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM bookings WHERE request_key='1:restart-fixture-key'").get()
        ?.n,
      0,
    );
    blocker.exec('ROLLBACK');
    blocker.close();
    blocker = undefined;
    const first = await agent
      .post('/api/bookings')
      .set('Idempotency-Key', 'restart-fixture-key')
      .send(slot);
    assert.equal(first.status, 201);
    db.prepare('UPDATE bookings SET expires_at=? WHERE id=?').run(
      '2000-01-01T00:00:00.000Z',
      first.body.id,
    );
    db.close();
    db = createDatabase(file);
    app = createApp(db, () => {});
    const replay = await request(app)
      .post('/api/bookings')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'restart-fixture-key')
      .send(slot);
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, first.body);
    assert.equal(
      db.prepare('SELECT status FROM bookings WHERE id=?').get(first.body.id)?.status,
      'expired',
    );
    const changed = await request(app)
      .post('/api/bookings')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'restart-fixture-key')
      .send({ ...slot, endTime: '12:00' });
    assert.equal(changed.status, 409);
    const next = await request(app)
      .post('/api/bookings')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'new-after-expiration')
      .send(slot);
    assert.equal(next.status, 201);
    assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  } finally {
    if (blocker?.isTransaction) blocker.exec('ROLLBACK');
    blocker?.close();
    if (db.isOpen) db.close();
    assert.ok(realpathSync(dir).startsWith(realpathSync(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  }
});
