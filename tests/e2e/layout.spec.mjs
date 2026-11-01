import { test, expect } from '@playwright/test';

test('mobile catalog pages through spaces without moving the whole page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const previous = page.getByRole('button', { name: 'Предыдущее пространство' });
  const next = page.getByRole('button', { name: 'Следующее пространство' });
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(previous).toBeEnabled();
  await expect
    .poll(() => page.locator('.space-grid').evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await previous.click();
  await expect(previous).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('booking panel follows the effective viewport at desktop 150%', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Выбрать Quiet Corner', exact: true }).click();
  await expect(page.locator('.mobile-booking')).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator('.mobile-booking')).toHaveCount(0);
  await expect(page.locator('.booking-panel')).toBeVisible();
});
