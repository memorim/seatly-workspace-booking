import { test, expect } from '@playwright/test';

test('booking panel follows the effective viewport at desktop 150%', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Выбрать Quiet Corner', exact: true }).click();
  await expect(page.locator('.mobile-booking')).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator('.mobile-booking')).toHaveCount(0);
  await expect(page.locator('.booking-panel')).toBeVisible();
});
