import { z } from 'zod';
import initial from './demo-data.json';
import type { Space, BusySlot, BookingResult, User, Booking as SavedBooking } from './types';

const key = 'seatly-browser-demo-v1';
const schema = z.object({
  spaceId: z.number().int().positive(), guestName: z.string().trim().min(2).max(80),
  guestEmail: z.string().email(), bookingDate: z.string().date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), guests: z.number().int().positive(),
});
type Booking = z.infer<typeof schema> & BookingResult & { userId?: number };
const bookings = (): Booking[] => JSON.parse(localStorage.getItem(key) || '[]');
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const users: User[] = [{ id: 1, name: 'Демо-гость', email: 'guest@seatly.example', role: 'guest' }, { id: 2, name: 'Демо-владелец', email: 'owner@seatly.example', role: 'owner' }];
const currentUser = () => users.find(u => u.id === Number(localStorage.getItem('seatly-demo-user'))) || null;

// ponytail: browser-only storage has no cross-user guarantees; use the Express API for shared bookings.
export const demoApi = {
  session: async () => ({ user: currentUser(), mode: 'browser' }),
  login: async (email: string, _password: string): Promise<User> => {
    const user = users.find(u => u.email === email);
    if (!user) throw new Error('Выберите демонстрационную роль');
    localStorage.setItem('seatly-demo-user', String(user.id)); return user;
  },
  logout: async () => { localStorage.setItem('seatly-demo-user', ''); },
  bookings: async (): Promise<SavedBooking[]> => {
    const user = currentUser(); if (!user) throw new Error('Войдите в демо');
    return bookings().filter(b => user.role === 'owner' || b.userId === user.id).map(b => ({ id: b.id, space_id: b.spaceId, space_name: initial.spaces.find(s => s.id === b.spaceId)?.name || '', booking_date: b.bookingDate, start_time: b.startTime, end_time: b.endTime, total_price: b.totalPrice, status: b.status, guest_name: b.guestName, user_id: b.userId || 0 }));
  },
  cancel: async (id: number) => {
    const user = currentUser(); const all = bookings(); const b = all.find(b => b.id === id);
    if (!user || !b || (user.role !== 'owner' && b.userId !== user.id)) throw new Error('Бронирование не найдено');
    b.status = 'cancelled'; localStorage.setItem(key, JSON.stringify(all));
  },
  confirm: async (id: number) => {
    if (currentUser()?.role !== 'owner') throw new Error('Нужна роль владельца');
    const all = bookings(); const b = all.find(b => b.id === id && b.status === 'pending');
    if (!b) throw new Error('Ожидающее бронирование не найдено');
    b.status = 'confirmed'; localStorage.setItem(key, JSON.stringify(all));
  },
  spaces: async (): Promise<Space[]> => structuredClone(initial.spaces),
  availability: async (id: number, date: string): Promise<{ date: string; bookings: BusySlot[] }> => ({
    date, bookings: [
      ...initial.bookings.filter(b => b.space_id === id && b.booking_date === date),
      ...bookings().filter(b => b.spaceId === id && b.bookingDate === date && b.status !== 'cancelled').map(b => ({ start_time: b.startTime, end_time: b.endTime })),
    ],
  }),
  book: async (data: object): Promise<BookingResult> => {
    const user = currentUser(); if (!user) throw new Error('Войдите в личный кабинет');
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error('Проверьте данные бронирования');
    const b = parsed.data;
    if (new Date(`${b.bookingDate}T${b.startTime}:00+03:00`).getTime() <= Date.now()) throw new Error('Выберите будущее время по Москве');
    const space = initial.spaces.find(s => s.id === b.spaceId);
    if (!space) throw new Error('Пространство не найдено');
    const start = minutes(b.startTime), end = minutes(b.endTime);
    if (start < 480 || end > 1320 || end - start < 60) throw new Error('Выберите минимум час между 08:00 и 22:00');
    if (b.guests > space.capacity) throw new Error(`Максимальная вместимость — ${space.capacity}`);
    const busy = await demoApi.availability(b.spaceId, b.bookingDate);
    if (busy.bookings.some(slot => slot.start_time < b.endTime && slot.end_time > b.startTime)) throw new Error('Это время уже занято');
    const all = bookings();
    const result = { id: Math.max(0, ...all.map(b => b.id)) + 1, totalPrice: Math.round((end - start) / 60 * space.hourly_price), status: 'pending' };
    localStorage.setItem(key, JSON.stringify([...all, { ...b, ...result, userId: user.id }]));
    return result;
  },
};
