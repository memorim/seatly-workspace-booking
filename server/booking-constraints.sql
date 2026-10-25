-- Canonical dates/times are required for lexicographic interval comparisons.
-- Existing historical rows are preserved; cancelled rows remain recoverable.
CREATE TRIGGER IF NOT EXISTS booking_values_insert BEFORE INSERT ON bookings
WHEN NEW.status IN ('pending','confirmed') AND (
  NEW.booking_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  OR date(NEW.booking_date,'+0 days') IS NOT NEW.booking_date
  OR length(NEW.start_time)!=5 OR length(NEW.end_time)!=5
  OR NEW.start_time NOT GLOB '[0-2][0-9]:[0-5][0-9]'
  OR NEW.end_time NOT GLOB '[0-2][0-9]:[0-5][0-9]'
  OR NEW.start_time<'08:00' OR NEW.end_time>'22:00'
  OR (CAST(substr(NEW.end_time,1,2) AS INTEGER)*60+CAST(substr(NEW.end_time,4,2) AS INTEGER))
     -(CAST(substr(NEW.start_time,1,2) AS INTEGER)*60+CAST(substr(NEW.start_time,4,2) AS INTEGER))<60
  OR typeof(NEW.guests)!='integer' OR NEW.guests<1
  OR NEW.guests>(SELECT capacity FROM spaces WHERE id=NEW.space_id)
  OR typeof(NEW.total_price)!='integer' OR NEW.total_price<1
)
BEGIN SELECT RAISE(ABORT,'booking_values_invalid'); END;

CREATE TRIGGER IF NOT EXISTS booking_values_update BEFORE UPDATE ON bookings
WHEN NEW.status IN ('pending','confirmed') AND (
  NEW.booking_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  OR date(NEW.booking_date,'+0 days') IS NOT NEW.booking_date
  OR length(NEW.start_time)!=5 OR length(NEW.end_time)!=5
  OR NEW.start_time NOT GLOB '[0-2][0-9]:[0-5][0-9]'
  OR NEW.end_time NOT GLOB '[0-2][0-9]:[0-5][0-9]'
  OR NEW.start_time<'08:00' OR NEW.end_time>'22:00'
  OR (CAST(substr(NEW.end_time,1,2) AS INTEGER)*60+CAST(substr(NEW.end_time,4,2) AS INTEGER))
     -(CAST(substr(NEW.start_time,1,2) AS INTEGER)*60+CAST(substr(NEW.start_time,4,2) AS INTEGER))<60
  OR typeof(NEW.guests)!='integer' OR NEW.guests<1
  OR NEW.guests>(SELECT capacity FROM spaces WHERE id=NEW.space_id)
  OR typeof(NEW.total_price)!='integer' OR NEW.total_price<1
)
BEGIN SELECT RAISE(ABORT,'booking_values_invalid'); END;
