import { test, expect } from '@playwright/test';
async function login(page, role) {
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Демонстрационный аккаунт').selectOption(role + '@seatly.example');
  await modal
    .getByLabel('Пароль', { exact: true })
    .fill(role === 'guest' ? 'GuestDemo2026!' : 'OwnerDemo2026!');
  await modal.getByRole('button', { name: 'Войти в аккаунт', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Закрыть личный кабинет' }).click();
}
test('guest booking, independent owner confirmation and cancellation survive reload', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto('/');
  await login(page, 'guest');
  await page.getByRole('button', { name: 'Выбрать Quiet Corner', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Бронирование' });
  const date = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  await panel.getByLabel('Дата бронирования').fill(date);
  await panel.getByRole('button', { name: 'Забронировать', exact: true }).click();
  await panel.getByRole('button', { name: /Отправить заявку/ }).click();
  await expect(
    panel.getByRole('heading', { name: 'Ожидает подтверждения владельцем' }),
  ).toBeVisible();
  const ownerContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage();
  await owner.goto('/');
  await login(owner, 'owner');
  await owner.getByRole('button', { name: 'Демо-владелец', exact: true }).click();
  const ownerDialog = owner.getByRole('dialog');
  await ownerDialog.getByRole('button', { name: /Подтвердить бронирование/ }).click();
  await expect(
    ownerDialog.locator('.booking-record').getByText('Ожидает подтверждения', { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Демо-гость', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.locator('.booking-record').getByText('Подтверждено', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: /Перенести бронирование/ }).click();
  await dialog.getByLabel('Новое начало', { exact: true }).fill('14:00');
  await dialog.getByLabel('Новое окончание', { exact: true }).fill('15:30');
  await dialog.getByRole('button', { name: 'Сохранить перенос', exact: true }).click();
  await expect(
    dialog.locator('.booking-record').getByText('Ожидает подтверждения', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog
      .locator('.booking-record')
      .filter({ hasText: 'Ожидает подтверждения' })
      .getByText(/14:00–15:30/),
  ).toBeVisible();
  await dialog.getByRole('button', { name: /Отменить бронирование/ }).click();
  await expect(
    dialog.locator('.booking-record').getByText('Отменено', { exact: true }).last(),
  ).toBeVisible();
  await ownerContext.close();
});
test('a failed catalog request is visible and can be retried', async ({ page }) => {
  await page.route('**/api/spaces', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Тестовая недоступность' }),
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Тестовая недоступность');
  await page.unroute('**/api/spaces');
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Выбрать Quiet Corner', exact: true }),
  ).toBeVisible();
});
