export interface Space {
  id: number; name: string; type: string; district: string; address: string;
  capacity: number; hourly_price: number; rating: number; reviews: number;
  image: string; accent: string; amenities: string[]; description: string;
}
export interface BusySlot { start_time: string; end_time: string }
export interface BookingResult { id: number; totalPrice: number; status: string }

