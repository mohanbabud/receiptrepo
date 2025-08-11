import { test, expect } from '@playwright/test';

const themes = ['light', 'dark', 'hc'] as const;

for (const theme of themes) {
  test.describe(`Login visual - theme=${theme}`, () => {
    test(`should match snapshot on desktop`, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { name: /sign in|create account/i }).waitFor();
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`login-${theme}-desktop.png`, { fullPage: true });
    });

    test(`should match snapshot on mobile`, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { name: /sign in|create account/i }).waitFor();
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`login-${theme}-mobile.png`, { fullPage: true });
    });
  });
}
