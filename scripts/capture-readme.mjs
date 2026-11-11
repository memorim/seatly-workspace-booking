import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createApp } from '../server/app.ts';
import { createDatabase } from '../server/db.ts';

const db = createDatabase(':memory:');
const server = createApp(db, () => {}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const browser = await chromium.launch();
try {
  await mkdir('readme-captures', { recursive: true });
  for (const [name, width, height] of [
    ['desktop', 1920, 1080],
    ['mobile', 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('region', { name: 'Каталог пространств' }).waitFor();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(name + ' page has horizontal overflow');
    await page.locator('.space-card img').first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      [...document.images].some((image) => image.complete && image.naturalWidth > 0),
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: 'readme-captures/' + name + '.png', fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
}
