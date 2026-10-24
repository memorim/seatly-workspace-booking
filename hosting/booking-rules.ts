import {z} from 'zod';
export const HOLD_MS=30*60*1000;
export const slotSchema=z.object({bookingDate:z.string().date(),startTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),guests:z.number().int().positive()}).strict();
export const bookingSchema=slotSchema.extend({spaceId:z.number().int().positive(),guestName:z.string().trim().min(2).max(80),guestEmail:z.string().email()}).strict();
export function priceFor(space:{hourly_price:number;capacity:number},slot:z.infer<typeof slotSchema>){
 const minutes=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3));const start=minutes(slot.startTime),end=minutes(slot.endTime);
 if(new Date(`${slot.bookingDate}T${slot.startTime}:00+03:00`).getTime()<=Date.now())throw new RangeError('Выберите будущее время по Москве');
 if(start<480||end>1320||end-start<60)throw new RangeError('Выберите минимум час между 08:00 и 22:00');
 if(slot.guests>space.capacity)throw new RangeError(`Максимальная вместимость — ${space.capacity}`);
 return Math.round((end-start)/60*space.hourly_price);
}
