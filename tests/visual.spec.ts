import { test, expect } from '@playwright/test';

const pages = [
  { name: 'Home', path: '/' },
  { name: 'About', path: '/about/' },
  { name: 'Services', path: '/services/' },
  { name: 'Blog', path: '/blog/' },
  { name: 'Contact', path: '/contact/' },
];

for (const page of pages) {
  test(`${page.name} page renders correctly`, async ({ page: browserPage }) => {
    await browserPage.goto(page.path);
    await expect(browserPage).toHaveTitle(/Mila Business Solutions/);
    await expect(browserPage.locator('nav')).toBeVisible();
    await expect(browserPage.locator('footer')).toBeVisible();
    await browserPage.screenshot({
      path: `test-results/${page.name.toLowerCase()}.png`,
      fullPage: true,
    });
  });
}

test('404 page shows return home button', async ({ page }) => {
  await page.goto('/nonexistent-page/');
  await expect(page.locator('text=404')).toBeVisible();
  await expect(page.locator('text=Return Home')).toBeVisible();
});
