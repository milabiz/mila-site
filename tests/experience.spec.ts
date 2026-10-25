import { test, expect } from '@playwright/test';

const experiences = ['terminal', 'synthwave', 'blueprint', 'editorial'] as const;

for (const exp of experiences) {
  test(`${exp} experience applies, persists, and keeps layout intact`, async ({ page }, testInfo) => {
    await page.goto('/');
    await page.locator(`#experience [data-exp-choice="${exp}"]`).click();

    await expect(page.locator('html')).toHaveAttribute('data-experience', exp);
    await expect(page.locator(`#experience [data-exp-choice="${exp}"]`)).toHaveAttribute('aria-pressed', 'true');

    // Persists across navigation, applied before paint by the inline script.
    await page.goto('/services/');
    await expect(page.locator('html')).toHaveAttribute('data-experience', exp);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(overflows, `${exp} overflows horizontally`).toBe(false);

    await page.goto('/');
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-exp-${exp}.png`,
      fullPage: true,
    });
  });
}

test('header menu switches experience and back to classic', async ({ page }) => {
  await page.goto('/about/');
  await page.locator('.exp-trigger').click();
  await expect(page.locator('#exp-menu')).toBeVisible();
  await page.locator('#exp-menu [data-exp-choice="terminal"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-experience', 'terminal');
  await expect(page.locator('#exp-menu')).toBeHidden();

  await page.locator('.exp-trigger').click();
  await page.locator('#exp-menu [data-exp-choice="classic"]').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-experience', /.+/);
  await page.reload();
  await expect(page.locator('html')).not.toHaveAttribute('data-experience', /.+/);
});

test('page content is identical across experiences (SEO parity)', async ({ page }) => {
  await page.goto('/');
  const classic = await page.locator('main').textContent();
  await page.locator('#experience [data-exp-choice="synthwave"]').click();
  expect(await page.locator('main').textContent()).toBe(classic);
});
