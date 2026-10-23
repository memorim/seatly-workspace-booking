import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { demoApi } from '../src/demo-api.ts';

const values = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
} });

describe('browser demonstration', () => {
  it('stores a booking, calculates fractional hours and rejects conflicts or invalid input', async () => {
    const booking = { spaceId: 1, guestName: 'Demo User', guestEmail: 'demo@example.com', bookingDate: '2030-01-10',
      startTime: '10:00', endTime: '11:30', guests: 2 };
    const result = await demoApi.book(booking);
    assert.equal(result.totalPrice, 2700);
    assert.equal((await demoApi.availability(1, booking.bookingDate)).bookings.length, 1);
    await assert.rejects(demoApi.book(booking), /занято/);
    await assert.rejects(demoApi.book({ ...booking, guestEmail: 'invalid' }), /данные/);
    await assert.rejects(demoApi.book({ ...booking, guests: 50 }), /вместимость/);
    await assert.rejects(demoApi.book({ ...booking, endTime: '09:00' }), /минимум/);
  });
});
