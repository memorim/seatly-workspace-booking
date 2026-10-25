import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import request from 'supertest';

test('database rejects invalid dates and malformed intervals without an API validator', () => {
  const db = createDatabase(':memory:');
  try {
    const insert = db.prepare(
      "INSERT INTO bookings(space_id,guest_name,guest_email,booking_date,start_time,end_time,guests,total_price,status,created_at) VALUES(3,'Audit','audit@example.com',?,?,?,1,950,'confirmed','2026-10-24')",
    );
    for (const [date, start, end] of [
      ['2030-02-30', '10:00', '11:00'],
      ['2030-01-10', '10:00', '09:00'],
      ['2030-01-10', '7:00', '11:00'],
      ['2030-01-10', '10:00', '10:30'],
    ])
      assert.throws(() => insert.run(date, start, end));
  } finally {
    db.close();
  }
});

test('failed response persistence rolls back the booking and leaves the key reusable', async () => {
  const db = createDatabase(':memory:');
  try {
    assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
    const agent = request.agent(createApp(db));
    await agent
      .post('/api/login')
      .send({ email: 'guest@seatly.example', password: 'GuestDemo2026!' });
    db.exec(
      "CREATE TRIGGER audit_fail_response BEFORE UPDATE OF create_result ON bookings BEGIN SELECT RAISE(ABORT,'fixture_write_failure');END;",
    );
    const body = {
        spaceId: 3,
        guestName: 'Audit guest',
        guestEmail: 'audit@example.com',
        bookingDate: '2030-01-10',
        startTime: '10:00',
        endTime: '11:00',
        guests: 1,
      },
      key = 'audit-rollback-123';
    assert.equal(
      (await agent.post('/api/bookings').set('Idempotency-Key', key).send(body)).status,
      503,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM bookings WHERE request_key=?').get('1:' + key)?.n,
      0,
    );
    db.exec('DROP TRIGGER audit_fail_response');
    assert.equal(
      (await agent.post('/api/bookings').set('Idempotency-Key', key).send(body)).status,
      201,
    );
  } finally {
    db.close();
  }
});
