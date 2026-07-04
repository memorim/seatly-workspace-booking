import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

const app = createApp(createDatabase(':memory:'));
const valid = { spaceId: 1, guestName: 'Иван Петров', guestEmail: 'ivan@example.ru', bookingDate: '2026-07-08', startTime: '10:00', endTime: '12:00', guests: 4 };

describe('Seatly API', () => {
  it('returns and filters spaces', async () => {
    const all = await request(app).get('/api/spaces');
    assert.equal(all.status, 200); assert.equal(all.body.length, 6);
    const filtered = await request(app).get('/api/spaces?type=Переговорная');
    assert.equal(filtered.body.length, 2);
  });
  it('calculates booking price', async () => {
    const response = await request(app).post('/api/bookings').send(valid);
    assert.equal(response.status, 201); assert.equal(response.body.totalPrice, 3600);
  });
  it('rejects overlapping bookings', async () => {
    const response = await request(app).post('/api/bookings').send({ ...valid, guestEmail: 'second@example.ru', startTime: '11:00', endTime: '13:00' });
    assert.equal(response.status, 409);
  });
  it('checks room capacity', async () => {
    const response = await request(app).post('/api/bookings').send({ ...valid, spaceId: 3, bookingDate: '2026-07-09', guests: 8 });
    assert.equal(response.status, 400);
  });
});

