import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
test('synthetic contenders, atomic rescheduling, expiry and access', async (t) => {
  const db = createDatabase(':memory:'),
    app = createApp(db),
    server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
  });
  const guest = request.agent(server),
    owner = request.agent(server);
  await guest
    .post('/api/login')
    .send({ email: 'guest@seatly.example', password: 'GuestDemo2026!' });
  await owner
    .post('/api/login')
    .send({ email: 'owner@seatly.example', password: 'OwnerDemo2026!' });
  const payload = {
    spaceId: 1,
    guestName: 'Synthetic guest',
    guestEmail: 'test@example.com',
    bookingDate: '2030-02-10',
    startTime: '10:00',
    endTime: '11:00',
    guests: 2,
  };
  const contenders = await Promise.all(
    Array.from({ length: 50 }, () => guest.post('/api/bookings').send(payload)),
  );
  assert.equal(contenders.filter((r) => r.status === 201).length, 1);
  assert.equal(contenders.filter((r) => r.status === 409).length, 49);
  const id = contenders.find((r) => r.status === 201)!.body.id;
  assert.equal((await owner.patch(`/api/bookings/${id}/confirm`)).status, 200);
  const other = await guest
    .post('/api/bookings')
    .send({ ...payload, startTime: '12:00', endTime: '13:00' });
  assert.equal(other.status, 201);
  const slot = {
    bookingDate: payload.bookingDate,
    startTime: '12:00',
    endTime: '13:00',
    guests: 2,
  };
  assert.equal((await guest.patch(`/api/bookings/${id}/reschedule`).send(slot)).status, 409);
  const preserved = db.prepare('SELECT start_time,status FROM bookings WHERE id=?').get(id);
  assert.equal(preserved?.start_time, '10:00');
  assert.equal(preserved?.status, 'confirmed');
  const moved = await guest
    .patch(`/api/bookings/${id}/reschedule`)
    .send({ ...slot, startTime: '14:00', endTime: '15:30' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.totalPrice, 2700);
  assert.equal(moved.body.status, 'pending');
  assert.ok(Date.parse(moved.body.expiresAt) > Date.now());
  assert.equal(
    (await request(server).patch(`/api/bookings/${id}/reschedule`).send(slot)).status,
    401,
  );
  assert.equal(
    (await guest.patch(`/api/bookings/${id}/reschedule`).send({ ...slot, guests: 100 })).status,
    400,
  );
  db.prepare('UPDATE bookings SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', id);
  const available = await guest.get('/api/spaces/1/availability?date=' + payload.bookingDate);
  assert.equal(
    available.body.bookings.some((b: { start_time: string }) => b.start_time === '14:00'),
    false,
  );
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(id)?.status, 'expired');
  assert.equal((await owner.patch(`/api/bookings/${id}/confirm`)).status, 404);
  assert.equal((await guest.patch(`/api/bookings/${id}/reschedule`).send(slot)).status, 409);
  assert.equal(
    (await guest.post('/api/bookings').send({ ...payload, startTime: '14:00', endTime: '15:30' }))
      .status,
    201,
  );
});
