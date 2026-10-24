import { demoApi } from './demo-api';
import type { Booking, BookingResult, BusySlot, Space, User } from './types';
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch((import.meta.env.VITE_API_BASE?url.replace(/^\/api/,import.meta.env.VITE_API_BASE):url), { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || 'Не удалось выполнить запрос');
  return response.status === 204 ? undefined as T : response.json();
}
const serverApi = {
  session: () => request<{ user: User | null; mode: string; authenticated?:boolean }>('/api/session'),
  login: (email: string, password: string) => request<User>('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/api/logout', { method: 'POST' }),
  bookings: () => request<Booking[]>('/api/bookings'),
  cancel: (id: number) => request<void>(`/api/bookings/${id}`, { method: 'DELETE' }),
  confirm: (id: number) => request(`/api/bookings/${id}/confirm`, { method: 'PATCH' }),
  reschedule:(id:number,body:object)=>request(`/api/bookings/${id}/reschedule`,{method:'PATCH',body:JSON.stringify(body)}),
  spaces: () => request<Space[]>('/api/spaces'),
  availability: (id: number, date: string) => request<{ date: string; bookings: BusySlot[] }>(`/api/spaces/${id}/availability?date=${date}`),
  book: (data: object) => request<BookingResult>('/api/bookings', { method: 'POST', body: JSON.stringify(data) }),
};


export const api = import.meta.env.VITE_DEMO_MODE === 'true' ? demoApi : serverApi;
