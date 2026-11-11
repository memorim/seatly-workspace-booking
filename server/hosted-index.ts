import { createHostedApp } from './hosted-app.js';
import { initializePostgres, postgresStore } from './postgres.js';
import { provisionAccount, publicOrigin } from './hosted-auth.js';

publicOrigin();
if (!process.env.DATABASE_URL) throw new Error('Configure persistent DATABASE_URL');
const db = postgresStore(process.env.DATABASE_URL);
await initializePostgres(db);
// Optional, private first-start provisioning. Existing credentials are never replaced.
if (process.env.SEATLY_BOOTSTRAP_ACCOUNTS) {
  const accounts: unknown = JSON.parse(process.env.SEATLY_BOOTSTRAP_ACCOUNTS);
  if (!Array.isArray(accounts) || accounts.length > 10)
    throw new Error('Invalid bootstrap accounts');
  for (const account of accounts) await provisionAccount(db, account);
}
const owners = await db.query("SELECT COUNT(*) n FROM users WHERE role='owner'");
if (!Number(owners.rows[0].n))
  throw new Error('Provision an individual owner account before publication');
const server = createHostedApp(db).listen(Number(process.env.PORT || 4200), '0.0.0.0');
let expiring = false;
const expiry = setInterval(async () => {
  if (expiring) return;
  expiring = true;
  try {
    await db.transaction(() =>
      db.query("UPDATE bookings SET status='expired' WHERE status='pending' AND expires_at<=$1", [
        new Date().toISOString(),
      ]),
    );
  } catch {
    console.error({ event: 'booking_expiry', status: 'unavailable' });
  } finally {
    expiring = false;
  }
}, 30000);
expiry.unref();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    clearInterval(expiry);
    server.close(() => {
      void db.close();
    });
  });
