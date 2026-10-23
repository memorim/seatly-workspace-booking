import { z } from 'zod';
import initial from './demo-data.json';
import type { Space, BusySlot, BookingResult } from './types';

const key = 'seatly-browser-demo-v1';
const schema = z.object({
  spaceId: z.number().int().positive(), guestName: z.string().trim().min(2).max(80),
  guestEmail: z.string().email(), bookingDate: z.string().date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), guests: z.number().int().positive(),
});
type Booking = z.infer<typeof schema> & BookingResult;
const bookings = (): Booking[] => JSON.parse(localStorage.getItem(key) || '[]');
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

// ponytail: browser-only storage has no cross-user guarantees; use the Express API for shared bookings.
export const demoApi = {
  spaces: async (): Promise<Space[]> => structuredClone(initial.spaces),
  availability: async (id: number, date: string): Promise<{ date: string; bookings: BusySlot[] }> => ({
    date, bookings: [
      ...initial.bookings.filter(b => b.space_id === id && b.booking_date === date),
      ...bookings().filter(b => b.spaceId === id && b.bookingDate === date).map(b => ({ start_time: b.startTime, end_time: b.endTime })),
    ],
  }),
  book: async (data: object): Promise<BookingResult> => {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error('Проверьте данные бронирования');
    const b = parsed.data;
    const space = initial.spaces.find(s => s.id === b.spaceId);
    if (!space) throw new Error('Пространство не найдено');
    const start = minutes(b.startTime), end = minutes(b.endTime);
    if (start < 480 || end > 1320 || end - start < 60) throw new Error('Выберите минимум час между 08:00 и 22:00');
    if (b.guests > space.capacity) throw new Error(`Максимальная вместимость — ${space.capacity}`);
    const busy = await demoApi.availability(b.spaceId, b.bookingDate);
    if (busy.bookings.some(slot => slot.start_time < b.endTime && slot.end_time > b.startTime)) throw new Error('Это время уже занято');
    const all = bookings();
    const result = { id: Math.max(0, ...all.map(b => b.id)) + 1, totalPrice: (end - start) / 60 * space.hourly_price, status: 'confirmed' };
    localStorage.setItem(key, JSON.stringify([...all, { ...b, ...result }]));
    return result;
  },
};
