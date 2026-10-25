import type { BookingFilters } from './pagination';
import { z } from 'zod';
import initial from './demo-data.json';
import { bookingSchema, slotSchema, priceFor, HOLD_MS } from './booking-rules';
import type { Space, BusySlot, BookingResult, User, Booking as SavedBooking } from './types';

const key = 'seatly-browser-demo-v1';
const schema = bookingSchema;
type Booking = z.infer<typeof schema> &
  BookingResult & {
    userId?: number;
    expiresAt?: string;
    requestKey?: string;
    requestPayload?: string;
    requestResult?: BookingResult;
  };
const bookings = (): Booking[] => {
  const all: Booking[] = JSON.parse(localStorage.getItem(key) || '[]');
  let changed = false;
  for (const b of all)
    if (b.status === 'pending') {
      if (!b.expiresAt) {
        b.expiresAt = new Date(Date.now() + HOLD_MS).toISOString();
        changed = true;
      } else if (b.expiresAt <= new Date().toISOString()) {
        b.status = 'expired';
        changed = true;
      }
    }
  if (changed) localStorage.setItem(key, JSON.stringify(all));
  return all;
};
const active = (b: Booking) => ['pending', 'confirmed'].includes(b.status);
const users: User[] = [
  { id: 1, name: 'Демо-гость', email: 'guest@seatly.example', role: 'guest' },
  { id: 2, name: 'Демо-владелец', email: 'owner@seatly.example', role: 'owner' },
];
const currentUser = () =>
  users.find((u) => u.id === Number(localStorage.getItem('seatly-demo-user'))) || null;

// ponytail: browser-only storage has no cross-user guarantees; use the Express API for shared bookings.
export const demoApi = {
  session: async () => ({ user: currentUser(), mode: 'browser' }),
  login: async (email: string, _password: string): Promise<User> => {
    const user = users.find((u) => u.email === email);
    if (!user) throw new Error('Выберите демонстрационную роль');
    localStorage.setItem('seatly-demo-user', String(user.id));
    return user;
  },
  logout: async () => {
    localStorage.setItem('seatly-demo-user', '');
  },
  bookings: async (): Promise<SavedBooking[]> => {
    const user = currentUser();
    if (!user) throw new Error('Войдите в демо');
    return bookings()
      .filter((b) => user.role === 'owner' || b.userId === user.id)
      .map((b) => ({
        id: b.id,
        space_id: b.spaceId,
        space_name: initial.spaces.find((s) => s.id === b.spaceId)?.name || '',
        booking_date: b.bookingDate,
        start_time: b.startTime,
        end_time: b.endTime,
        total_price: b.totalPrice,
        status: b.status,
        guest_name: b.guestName,
        user_id: b.userId || 0,
        guests: b.guests,
        expires_at: b.expiresAt,
      }));
  },
  bookingPage: async (filters: BookingFilters = {}) => {
    const all = (await demoApi.bookings())
      .filter(
        (b) =>
          (!filters.status || b.status === filters.status) &&
          (!filters.search ||
            `${b.space_name} ${b.guest_name}`
              .toLowerCase()
              .includes(filters.search.toLowerCase().trim())),
      )
      .sort((a, b) => b.booking_date.localeCompare(a.booking_date) || b.id - a.id);
    const limit = filters.limit || 40,
      offset = filters.offset || 0;
    return { items: all.slice(offset, offset + limit), total: all.length, limit, offset };
  },
  cancel: async (id: number) => {
    const user = currentUser();
    const all = bookings();
    const b = all.find((b) => b.id === id);
    if (!user || !b || (user.role !== 'owner' && b.userId !== user.id))
      throw new Error('Бронирование не найдено');
    b.status = 'cancelled';
    localStorage.setItem(key, JSON.stringify(all));
  },
  confirm: async (id: number) => {
    if (currentUser()?.role !== 'owner') throw new Error('Нужна роль владельца');
    const all = bookings();
    const b = all.find((b) => b.id === id && b.status === 'pending');
    if (!b) throw new Error('Ожидающее бронирование не найдено');
    b.status = 'confirmed';
    localStorage.setItem(key, JSON.stringify(all));
  },
  reschedule: async (id: number, data: object) => {
    const user = currentUser(),
      all = bookings(),
      b = all.find((b) => b.id === id);
    if (!user || !b || (user.role !== 'owner' && b.userId !== user.id))
      throw new Error('Бронирование не найдено');
    if (!active(b)) throw new Error('Перенос доступен для действующей заявки');
    const parsed = slotSchema.safeParse(data);
    if (!parsed.success) throw new Error('Проверьте дату, время и количество гостей');
    const slot = parsed.data,
      space = initial.spaces.find((s) => s.id === b.spaceId)!;
    const total = priceFor(space, slot);
    const conflict =
      all.some(
        (other) =>
          other.id !== b.id &&
          other.spaceId === b.spaceId &&
          other.bookingDate === slot.bookingDate &&
          active(other) &&
          other.startTime < slot.endTime &&
          other.endTime > slot.startTime,
      ) ||
      initial.bookings.some(
        (other) =>
          other.space_id === b.spaceId &&
          other.booking_date === slot.bookingDate &&
          other.start_time < slot.endTime &&
          other.end_time > slot.startTime,
      );
    if (conflict) throw new Error('Новое время занято. Исходное бронирование сохранено.');
    Object.assign(b, slot, {
      totalPrice: total,
      status: 'pending',
      expiresAt: new Date(Date.now() + HOLD_MS).toISOString(),
    });
    localStorage.setItem(key, JSON.stringify(all));
  },
  spaces: async (): Promise<Space[]> => structuredClone(initial.spaces),
  availability: async (
    id: number,
    date: string,
  ): Promise<{ date: string; bookings: BusySlot[] }> => ({
    date,
    bookings: [
      ...initial.bookings.filter((b) => b.space_id === id && b.booking_date === date),
      ...bookings()
        .filter((b) => b.spaceId === id && b.bookingDate === date && active(b))
        .map((b) => ({ start_time: b.startTime, end_time: b.endTime })),
    ],
  }),
  book: async (data: object, requestKey?: string): Promise<BookingResult> => {
    const user = currentUser();
    if (!user) throw new Error('Войдите в личный кабинет');
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error('Проверьте данные бронирования');
    const b = parsed.data,
      payload = JSON.stringify(b),
      scope = user.id + ':' + requestKey;
    const prior = requestKey ? bookings().find((b) => b.requestKey === scope) : undefined;
    if (prior) {
      if (prior.requestPayload !== payload)
        throw new Error('Ключ уже использован с другими данными');
      return prior.requestResult!;
    }
    const space = initial.spaces.find((s) => s.id === b.spaceId);
    if (!space) throw new Error('Пространство не найдено');
    const total = priceFor(space, b);
    const busy = await demoApi.availability(b.spaceId, b.bookingDate);
    if (busy.bookings.some((slot) => slot.start_time < b.endTime && slot.end_time > b.startTime))
      throw new Error('Это время уже занято');
    const all = bookings(),
      previous = requestKey ? all.find((b) => b.requestKey === scope) : undefined;
    if (previous) {
      if (previous.requestPayload !== payload)
        throw new Error('Ключ уже использован с другими данными');
      return previous.requestResult!;
    }
    const result = {
      id: Math.max(0, ...all.map((b) => b.id)) + 1,
      totalPrice: total,
      status: 'pending',
      expiresAt: new Date(Date.now() + HOLD_MS).toISOString(),
    };
    localStorage.setItem(
      key,
      JSON.stringify([
        ...all,
        {
          ...b,
          ...result,
          userId: user.id,
          ...(requestKey
            ? { requestKey: scope, requestPayload: payload, requestResult: result }
            : {}),
        },
      ]),
    );
    return result;
  },
};
