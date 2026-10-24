export interface Space {
  id: number; name: string; type: string; district: string; address: string;
  capacity: number; hourly_price: number; rating: number; reviews: number;
  image: string; accent: string; amenities: string[]; description: string;
}
export interface BusySlot { start_time: string; end_time: string }
export interface BookingResult { id: number; totalPrice: number; status: string;expiresAt?:string }
export interface User { id: number; name: string; email: string; role: 'guest' | 'owner' }
export interface Booking { id: number; space_id: number; space_name: string; booking_date: string; start_time: string; end_time: string; total_price: number; status: string; expires_at?:string|null; guest_name: string;guests:number; user_id: number }


export interface Page<T>{items:T[];total:number;limit:number;offset:number}
