import type { Db } from './db.js';
import { writeLog, type LogSink } from './observability.js';

export function expireBookings(db: Db, now = new Date().toISOString()) {
  return db
    .prepare("UPDATE bookings SET status='expired' WHERE status='pending' AND expires_at<=?")
    .run(now).changes;
}

// API requests still enforce expiration; this timer only keeps stored status current during idle periods.
export function bookingExpiry(
  db: Db,
  {
    now = () => new Date().toISOString(),
    log = writeLog,
  }: { now?: () => string; log?: LogSink } = {},
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = () => {
    try {
      expireBookings(db, now());
    } catch {
      log({ event: 'booking_expiry', status: 'unavailable' });
    }
  };
  return {
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, 30000);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
