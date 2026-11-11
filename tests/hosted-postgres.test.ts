import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { postgresStore, initializePostgres, postgresOptions } from '../server/postgres.js';
import { provisionAccount, publicOrigin } from '../server/hosted-auth.js';
import { createHostedApp } from '../server/hosted-app.js';

test('public hosting requires an exact HTTPS origin and verified remote database TLS', () => {
  for (const value of [
    'http://example.com',
    'https://u:p@example.com',
    'https://example.com/path',
    'https://example.com?x=1',
  ])
    assert.throws(() => publicOrigin(value));
  assert.equal(
    postgresOptions('postgresql://u:p@example.com/db?sslmode=disable').ssl &&
      (
        postgresOptions('postgresql://u:p@example.com/db?sslmode=disable').ssl as {
          rejectUnauthorized: boolean;
        }
      ).rejectUnauthorized,
    true,
  );
});

test(
  'hosted PostgreSQL isolates accounts, serializes retries, preserves sessions and enforces booking constraints',
  { skip: !process.env.SEATLY_TEST_DATABASE_URL },
  async () => {
    const url = process.env.SEATLY_TEST_DATABASE_URL!;
    let db = postgresStore(url);
    const second = postgresStore(url);
    const origin = 'https://seatly.example.test',
      previous = process.env.SEATLY_PUBLIC_ORIGIN;
    process.env.SEATLY_PUBLIC_ORIGIN = origin;
    const password = 'A private test password ' + randomUUID();
    const suffix = randomUUID();
    try {
      await initializePostgres(db);
      assert.equal(
        (await db.query("SELECT id FROM users WHERE email LIKE '%@seatly.example'")).rowCount,
        0,
      );
      const accounts = [
        {
          name: 'First guest',
          role: 'guest',
          email: 'first-' + suffix + '@example.test',
          password,
        },
        {
          name: 'Other guest',
          role: 'guest',
          email: 'second-' + suffix + '@example.test',
          password,
        },
        {
          name: 'Owner check',
          role: 'owner',
          email: 'owner-' + suffix + '@example.test',
          password,
        },
      ];
      for (const account of accounts) await provisionAccount(db, account);
      await provisionAccount(db, {
        ...accounts[0],
        password: 'Must not overwrite existing credentials',
      });
      let app = createHostedApp(db, () => {});
      const app2 = createHostedApp(second, () => {});
      const login = async (index: number) => {
        const r = await request(app)
          .post('/api/login')
          .set('Host', 'seatly.example.test')
          .set('Origin', origin)
          .send({ email: accounts[index].email, password });
        assert.equal(r.status, 200);
        const cookie = r.headers['set-cookie'][0];
        assert.match(cookie, /HttpOnly/);
        assert.match(cookie, /Secure/);
        assert.match(cookie, /SameSite=Strict/);
        return cookie.split(';')[0];
      };
      const cookies = [await login(0), await login(1), await login(2)];
      const headers = (i = 0) => ({
        Host: 'seatly.example.test',
        Origin: origin,
        Cookie: cookies[i],
      });
      assert.equal(
        (await request(app).get('/api/bookings').set('Host', 'seatly.example.test')).status,
        401,
      );
      assert.equal(
        (await request(app).get('/api/session').set('Host', 'attacker.example')).status,
        403,
      );
      assert.equal(
        (
          await request(app)
            .post('/api/login')
            .set('Host', 'seatly.example.test')
            .send({ email: accounts[0].email, password })
        ).status,
        403,
      );
      const body = {
        spaceId: 1,
        guestName: 'Fixture Guest',
        guestEmail: 'fixture@example.test',
        bookingDate: '2035-01-10',
        startTime: '10:00',
        endTime: '12:00',
        guests: 2,
      };
      const key = randomUUID();
      const submit = (server = app) =>
        request(server).post('/api/bookings').set(headers()).set('Idempotency-Key', key).send(body);
      const created = await Promise.all([submit(), submit(app2)]);
      assert.deepEqual(
        created.map((r) => r.status),
        [201, 201],
      );
      assert.deepEqual(created[0].body, created[1].body);
      const id = created[0].body.id;
      assert.equal((await request(app).get('/api/bookings').set(headers(1))).body.length, 0);
      assert.equal(
        (
          await request(app)
            .delete('/api/bookings/' + id)
            .set(headers(1))
        ).status,
        404,
      );
      assert.equal(
        (await request(app).patch(`/api/bookings/${id}/confirm`).set(headers())).status,
        403,
      );
      assert.equal(
        (await request(app).patch(`/api/bookings/${id}/confirm`).set(headers(2))).status,
        200,
      );
      assert.equal(
        (await request(app2).post('/api/bookings').set(headers(1)).send(body)).status,
        409,
      );
      await assert.rejects(
        () => db.query('UPDATE bookings SET guests=1000 WHERE id=$1', [id]),
        /booking_values_invalid/,
      );
      await assert.rejects(() =>
        db.query("UPDATE bookings SET booking_date='2035-02-30' WHERE id=$1", [id]),
      );
      const moved = await request(app)
        .patch(`/api/bookings/${id}/reschedule`)
        .set(headers())
        .send({ bookingDate: '2035-01-11', startTime: '12:00', endTime: '14:00', guests: 2 });
      assert.equal(moved.status, 200);
      assert.equal(moved.body.status, 'pending');
      await db.close();
      db = postgresStore(url);
      await initializePostgres(db);
      app = createHostedApp(db, () => {});
      assert.equal((await request(app).get('/api/bookings').set(headers())).body[0].id, id);
      assert.deepEqual((await submit()).body, created[0].body);
      assert.equal(
        (
          await request(app)
            .delete('/api/bookings/' + id)
            .set(headers())
        ).status,
        204,
      );
      assert.equal((await request(app).post('/api/logout').set(headers())).status, 204);
      assert.equal((await request(app).get('/api/bookings').set(headers())).status, 401);
    } finally {
      await db.close();
      await second.close();
      if (previous === undefined) delete process.env.SEATLY_PUBLIC_ORIGIN;
      else process.env.SEATLY_PUBLIC_ORIGIN = previous;
    }
  },
);
