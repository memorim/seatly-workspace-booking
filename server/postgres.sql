CREATE TABLE IF NOT EXISTS spaces (
 id BIGINT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, district TEXT NOT NULL,
 address TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity>0), hourly_price INTEGER NOT NULL CHECK(hourly_price>0),
 rating DOUBLE PRECISION NOT NULL, reviews INTEGER NOT NULL, image TEXT NOT NULL,
 accent TEXT NOT NULL, amenities TEXT NOT NULL, description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('guest','owner')), salt TEXT NOT NULL, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_budgets (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
 id BIGSERIAL PRIMARY KEY, space_id BIGINT NOT NULL REFERENCES spaces(id),
 guest_name TEXT NOT NULL, guest_email TEXT NOT NULL, booking_date TEXT NOT NULL,
 start_time TEXT NOT NULL, end_time TEXT NOT NULL, guests INTEGER NOT NULL CHECK(guests>0),
 total_price INTEGER NOT NULL CHECK(total_price>0),
 status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelled','expired')),
 created_at TEXT NOT NULL, user_id BIGINT NOT NULL REFERENCES users(id), expires_at TEXT,
 request_key TEXT UNIQUE, request_payload TEXT, create_result TEXT
);
CREATE INDEX IF NOT EXISTS bookings_slot ON bookings(space_id,booking_date,status);
CREATE INDEX IF NOT EXISTS bookings_user_date ON bookings(user_id,booking_date DESC,id DESC);
CREATE INDEX IF NOT EXISTS bookings_expiry ON bookings(status,expires_at);
CREATE OR REPLACE FUNCTION seatly_booking_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(73194012);
 IF NEW.status IN ('pending','confirmed') THEN
  IF NEW.booking_date !~ '^\d{4}-\d{2}-\d{2}$' OR (NEW.booking_date::date)::text<>NEW.booking_date
   OR NEW.start_time !~ '^[0-2][0-9]:[0-5][0-9]$' OR NEW.end_time !~ '^[0-2][0-9]:[0-5][0-9]$'
   OR NEW.start_time<'08:00' OR NEW.end_time>'22:00'
   OR NEW.end_time::time-NEW.start_time::time<interval '1 hour'
   OR NEW.guests>(SELECT capacity FROM spaces WHERE id=NEW.space_id)
  THEN RAISE EXCEPTION 'booking_values_invalid'; END IF;
  IF EXISTS (SELECT 1 FROM bookings b WHERE b.id<>NEW.id AND b.space_id=NEW.space_id
    AND b.booking_date=NEW.booking_date AND b.status IN ('pending','confirmed')
    AND b.start_time<NEW.end_time AND b.end_time>NEW.start_time)
  THEN RAISE EXCEPTION 'booking_overlap'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER seatly_booking_guard BEFORE INSERT OR UPDATE ON bookings
 FOR EACH ROW EXECUTE FUNCTION seatly_booking_guard();
