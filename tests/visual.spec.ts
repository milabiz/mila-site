import { test, expect } from '@playwright/test';

const pages = [
  { name: 'Home', path: '/' },
  { name: 'About', path: '/about/' },
  { name: 'Services', path: '/services/' },
  { name: 'Demo', path: '/demo/' },
  { name: 'Blog', path: '/blog/' },
  { name: 'Privacy', path: '/privacy/' },
  { name: 'Contact', path: '/contact/' },
];

for (const { name, path } of pages) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${name} renders in ${scheme} mode`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);

      await expect(page).toHaveTitle(/Mila Business Solutions/);
      await expect(page.locator('nav.nav')).toBeVisible();
      await expect(page.locator('footer.site-footer')).toBeVisible();

      // The page itself must never scroll horizontally at any viewport.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(overflows, `${name} overflows horizontally`).toBe(false);

      await page.screenshot({
        path: `test-results/${testInfo.project.name}-${name.toLowerCase()}-${scheme}.png`,
        fullPage: true,
      });
    });
  }
}

test('theme toggle flips and persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  const resolved = () =>
    page.evaluate(
      () =>
        document.documentElement.getAttribute('data-theme') ??
        (window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light')
    );

  expect(await resolved()).toBe('light');
  await page.locator('#theme-toggle').click();
  expect(await resolved()).toBe('dark');

  // Survives a reload — and must not flash the wrong theme.
  await page.reload();
  expect(await page.getAttribute('html', 'data-theme')).toBe('dark');
});

test('404 offers a way back', async ({ page }) => {
  await page.goto('/nonexistent-page/');
  await expect(page.getByRole('heading', { name: /doesn't exist/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /back to home/i })).toBeVisible();
});

/**
 * vercel.json headers are applied by Vercel's edge, so they do not exist under
 * `astro dev`. This only runs against a real deployment:
 *   DEPLOY_URL=https://milabiz.com npx playwright test -g "security headers"
 *
 * It exists because `public/_headers` (a Netlify/Cloudflare convention Vercel
 * silently ignores) meant these headers were absent from production for months
 * while appearing configured in the repo. Never trust the file — assert the
 * response.
 */
test.describe('deployed site', () => {
  test.skip(
    !process.env.DEPLOY_URL,
    'requires DEPLOY_URL — vercel.json headers are not applied by astro dev'
  );

  test('security headers that must be real HTTP headers are present', async ({
    request,
  }) => {
    const headers = (await request.get('/')).headers();

    // frame-ancestors is ignored in a <meta> CSP — header-only by spec.
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  // Astro injects the hashed CSP meta at build time, so it is absent under
  // `astro dev` — this is a property of the built artifact, not the dev server.
  test('CSP meta covers scripts and styles with hashes, not unsafe-inline', async ({
    page,
  }) => {
    await page.goto('/');
    const csp = await page
      .locator('meta[http-equiv="content-security-policy" i]')
      .getAttribute('content');

    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toMatch(/script-src[^;]*'sha256-/);
    expect(csp).not.toContain("'unsafe-inline'");
  });
});
