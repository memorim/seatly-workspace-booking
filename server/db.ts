import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { mkdirSync,readFileSync } from 'node:fs';

export type Db = DatabaseSync;

export function createDatabase(filename = resolve('data', 'seatly.db')) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  db.exec('BEGIN IMMEDIATE');
  db.exec(`
    CREATE TABLE IF NOT EXISTS spaces (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, district TEXT NOT NULL,
      address TEXT NOT NULL, capacity INTEGER NOT NULL, hourly_price INTEGER NOT NULL,
      rating REAL NOT NULL, reviews INTEGER NOT NULL, image TEXT NOT NULL,
      accent TEXT NOT NULL, amenities TEXT NOT NULL, description TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, space_id INTEGER NOT NULL REFERENCES spaces(id),
      guest_name TEXT NOT NULL, guest_email TEXT NOT NULL, booking_date TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL, guests INTEGER NOT NULL,
      total_price INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL
    );
  `);
  if (!(db.prepare('PRAGMA table_info(bookings)').all() as { name: string }[]).some(c => c.name === 'user_id')) db.exec('ALTER TABLE bookings ADD COLUMN user_id INTEGER;');
  if (!(db.prepare('PRAGMA table_info(bookings)').all() as {name:string}[]).some(c=>c.name==='expires_at')) db.exec('ALTER TABLE bookings ADD COLUMN expires_at TEXT;');
  db.prepare("UPDATE bookings SET expires_at=? WHERE status='pending' AND expires_at IS NULL").run(new Date(Date.now()+30*60*1000).toISOString());
  db.exec(`CREATE INDEX IF NOT EXISTS bookings_slot ON bookings(space_id, booking_date, status);
    CREATE TRIGGER IF NOT EXISTS prevent_booking_overlap BEFORE INSERT ON bookings
    WHEN NEW.status IN ('pending','confirmed') AND EXISTS (SELECT 1 FROM bookings WHERE space_id=NEW.space_id AND booking_date=NEW.booking_date AND status IN ('pending','confirmed') AND start_time<NEW.end_time AND end_time>NEW.start_time)
    BEGIN SELECT RAISE(ABORT, 'booking_overlap'); END;
    CREATE TRIGGER IF NOT EXISTS prevent_booking_update_overlap BEFORE UPDATE ON bookings
    WHEN NEW.status IN ('pending','confirmed') AND EXISTS (SELECT 1 FROM bookings WHERE id!=NEW.id AND space_id=NEW.space_id AND booking_date=NEW.booking_date AND status IN ('pending','confirmed') AND start_time<NEW.end_time AND end_time>NEW.start_time)
    BEGIN SELECT RAISE(ABORT, 'booking_overlap'); END;`);
  for(const column of ['request_key','request_payload','create_result']){
    if(!(db.prepare('PRAGMA table_info(bookings)').all() as {name:string}[]).some(c=>c.name===column))db.exec(`ALTER TABLE bookings ADD COLUMN ${column} TEXT`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS bookings_request_key ON bookings(request_key)');
  db.exec('CREATE INDEX IF NOT EXISTS bookings_user_status_date ON bookings(user_id,status,booking_date DESC,id DESC);CREATE INDEX IF NOT EXISTS bookings_status_date ON bookings(status,booking_date DESC,id DESC);CREATE INDEX IF NOT EXISTS bookings_expiry ON bookings(status,expires_at);');
  const count = db.prepare('SELECT COUNT(*) count FROM spaces').get() as { count: number };
  if (!count.count) db.exec(`
    INSERT INTO spaces VALUES
      (1, 'Olive Room', 'Переговорная', 'Хамовники', 'Большой Саввинский, 12', 8, 1800, 4.9, 48, 'olive', '#7f9274', '["Экран 55″","Маркерная доска","Кофе","Видеосвязь"]', 'Светлая переговорная с видом на набережную и всем необходимым для командной встречи.'),
      (2, 'Forma Hall', 'Лофт', 'Пресня', 'Звенигородское ш., 3', 24, 3200, 4.8, 31, 'forma', '#ba694e', '["Проектор","Звук","Кухня","Климат"]', 'Трансформируемый зал для воркшопов, презентаций и камерных событий.'),
      (3, 'Quiet Corner', 'Кабинет', 'Арбат', 'Калашный пер., 7', 3, 950, 5.0, 19, 'quiet', '#55716e', '["Монитор","Принтер","Кофе","Тишина"]', 'Тихий закрытый кабинет для созвонов, интервью и глубокой индивидуальной работы.'),
      (4, 'Terra Studio', 'Студия', 'Басманный', 'Покровка, 29', 12, 2400, 4.7, 26, 'terra', '#b99558', '["Циклорама","Импульсный свет","Гримёрная","Wi-Fi"]', 'Минималистичная студия с естественным светом для съёмок и креативных сессий.'),
      (5, 'North Boardroom', 'Переговорная', 'Белорусская', 'Лесная, 20', 14, 2600, 4.9, 62, 'north', '#6f7394', '["Экран 75″","Видеосвязь","Флипчарт","Парковка"]', 'Просторная переговорная для стратегических сессий и встреч с клиентами.'),
      (6, 'Lumen Desk', 'Рабочее место', 'Павелецкая', 'Дербеневская наб., 7', 1, 450, 4.8, 86, 'lumen', '#d08458', '["Монитор","Эргокресло","Локер","24/7"]', 'Закреплённое рабочее место в спокойной зоне современного коворкинга.');
    INSERT INTO bookings (space_id,guest_name,guest_email,booking_date,start_time,end_time,guests,total_price,status,created_at) VALUES
      (1,'Дарья Волкова','demo@seatly.ru','2026-07-06','10:00','12:00',5,3600,'confirmed','2026-07-03T12:10:00'),
      (1,'Олег Миронов','oleg@example.ru','2026-07-06','15:00','17:00',4,3600,'confirmed','2026-07-03T16:40:00'),
      (2,'Studio Demo','team@example.ru','2026-07-07','11:00','14:00',16,9600,'confirmed','2026-07-02T10:00:00');
  `);
  db.exec(readFileSync(new URL('./booking-constraints.sql',import.meta.url),'utf8'));
  db.exec('COMMIT');return db;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');db.close();throw error;}
}

