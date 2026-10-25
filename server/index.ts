import { assertLocalDemo } from './auth.js';
import { bookingExpiry } from './booking-expiry.js';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { backupSchedule, backupWebhook } from './backup-schedule.js';
assertLocalDemo();
const port = Number(process.env.PORT || 4200),
  file = resolve('data', 'seatly.db'),
  db = createDatabase(file);
const backups = backupSchedule(file, {
  directory: process.env.BACKUP_DIR || undefined,
  intervalMs: Number(process.env.BACKUP_INTERVAL_HOURS || 24) * 3600000,
  retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 7),
  notify: backupWebhook(process.env.BACKUP_ALERT_WEBHOOK_URL, process.env.BACKUP_ALERT_TOKEN),
});
const expiry = bookingExpiry(db);
const server = createApp(db).listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log('API: http://localhost:' + port);
  expiry.start();
  if (process.env.BACKUP_ENABLED !== 'false') backups.start();
});
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    expiry.stop();
    backups.stop();
    server.close(() => db.close());
  });
