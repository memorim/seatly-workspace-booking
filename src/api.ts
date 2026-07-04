import type { BookingResult, BusySlot, Space } from './types';
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || 'Не удалось выполнить запрос');
  return response.status === 204 ? undefined as T : response.json();
}
export const api = {
  spaces: () => request<Space[]>('/api/spaces'),
  availability: (id: number, date: string) => request<{ date: string; bookings: BusySlot[] }>(`/api/spaces/${id}/availability?date=${date}`),
  book: (data: object) => request<BookingResult>('/api/bookings', { method: 'POST', body: JSON.stringify(data) }),
};

