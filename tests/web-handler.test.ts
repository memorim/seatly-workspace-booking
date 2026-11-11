import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { webHandler } from '../server/web-handler.js';

test('Neon web adapter preserves JSON, private cookies, binary assets and bounded bodies', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/api/login', (req, res) => {
    assert.equal(req.hostname, 'seatly.example');
    assert.equal(req.body.email, 'guest@example.test');
    res.cookie('seatly_session', 'private', { secure: true, httpOnly: true, sameSite: 'strict' });
    res.json({ role: 'guest' });
  });
  app.get('/image', (_req, res) => res.type('png').send(Buffer.from([137, 80, 78, 71, 0, 255])));
  app.delete('/api/session', (_req, res) => res.status(204).end());
  const handle = webHandler(app);
  const response = await handle(
    new Request('https://seatly.example/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': 'attacker.example' },
      body: JSON.stringify({ email: 'guest@example.test' }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { role: 'guest' });
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/);
  const image = await handle(new Request('https://seatly.example/image'));
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [137, 80, 78, 71, 0, 255]);
  assert.equal(
    (await handle(new Request('https://seatly.example/api/session', { method: 'DELETE' }))).status,
    204,
  );
  assert.equal(
    (
      await handle(
        new Request('https://seatly.example/api/login', {
          method: 'POST',
          body: 'x'.repeat(17000),
        }),
      )
    ).status,
    413,
  );
});
