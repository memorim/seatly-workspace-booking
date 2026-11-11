import { createHostedApp } from './hosted-app.js';
import { initializePostgres, postgresStore } from './postgres.js';
import { publicOrigin } from './hosted-auth.js';
import { webHandler } from './web-handler.js';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
let ready: Promise<ReturnType<typeof webHandler>> | undefined;
async function initialize() {
  publicOrigin();
  if (!process.env.DATABASE_URL) throw new Error('Persistent database is required');
  const db = postgresStore(process.env.DATABASE_URL);
  await initializePostgres(db);
  const owners = await db.query("SELECT id FROM users WHERE role='owner' LIMIT 1");
  if (!owners.rowCount) {
    await db.close();
    throw new Error('Provision an owner before publication');
  }
  return webHandler(createHostedApp(db));
}
export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (/^\/photos\/(olive|forma|lumen|quiet|terra|north)\.webp$/.test(path))
      return Response.redirect('https://memorim.github.io/seatly-workspace-booking' + path, 302);
    if (!process.env.SEATLY_PUBLIC_ORIGIN)
      return Response.json({ message: 'Server configuration pending' }, { status: 503 });
    try {
      ready ||= initialize().catch((error) => {
        ready = undefined;
        throw error;
      });
      return await (
        await ready
      )(request);
    } catch {
      console.error({ event: 'seatly_request', status: 'unavailable' });
      return Response.json(
        { message: 'Сервис временно недоступен. Повторите запрос.' },
        { status: 503 },
      );
    }
  },
};
