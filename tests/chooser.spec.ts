import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('problem chooser', () => {
  test('shows every vignette by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-vignette]')).toHaveCount(4);
    for (const v of await page.locator('[data-vignette]').all()) {
      await expect(v).toBeVisible();
    }
  });

  test('filters to the matching vignette and can reset', async ({ page }) => {
    await page.goto('/');

    await page.locator('[data-chooser-option][data-target="v-documents"]').click();

    await expect(page.locator('#v-documents')).toBeVisible();
    await expect(page.locator('#v-reporting')).toBeHidden();
    await expect(
      page.locator('[data-chooser-option][data-target="v-documents"]')
    ).toHaveAttribute('aria-current', 'true');

    await page.locator('[data-chooser-reset]').click();
    for (const v of await page.locator('[data-vignette]').all()) {
      await expect(v).toBeVisible();
    }
  });

  test('before/after toggle swaps panels', async ({ page }) => {
    await page.goto('/');
    const vignette = page.locator('#v-reporting');

    await expect(vignette.locator('.vignette__panel--before')).toBeVisible();
    await expect(vignette.locator('.vignette__panel--after')).toBeHidden();

    await vignette.locator('label[for="v-reporting-after"]').click();

    await expect(vignette.locator('.vignette__panel--after')).toBeVisible();
    await expect(vignette.locator('.vignette__panel--before')).toBeHidden();
  });

  test('every vignette is labelled as illustrative, not a case study', async ({
    page,
  }) => {
    await page.goto('/');
    const tags = page.locator('[data-vignette] .vignette__tag');
    await expect(tags).toHaveCount(4);
    for (const tag of await tags.all()) {
      await expect(tag).toHaveText('Illustrative example');
    }
  });

  test('chooser options are keyboard operable', async ({ page }) => {
    await page.goto('/');
    const option = page.locator(
      '[data-chooser-option][data-target="v-manual"]'
    );
    await option.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#v-manual')).toBeVisible();
    await expect(page.locator('#v-reporting')).toBeHidden();
  });
});

/**
 * The no-JS fallback is asserted with JavaScript genuinely disabled, not
 * inferred. Authoring the options as <button>s would pass a normal test and
 * fail this one — which is the whole point of using real anchors.
 */
test.describe('no-JavaScript fallback', () => {
  test.use({ javaScriptEnabled: false });

  test('chooser options remain real links to visible vignettes', async ({
    page,
  }) => {
    await page.goto('/');

    const options = page.locator('[data-chooser-option]');
    expect(await options.count()).toBeGreaterThan(0);

    for (const option of await options.all()) {
      // Must be an anchor with a real fragment href.
      expect(await option.evaluate((el) => el.tagName)).toBe('A');
      const href = await option.getAttribute('href');
      expect(href).toMatch(/^#/);

      // And the target must exist and be visible without scripting.
      const target = page.locator(href!);
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
    }
  });

  test('content is readable without scripting', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-vignette]')).toHaveCount(4);
  });
});

test.describe('accessibility smoke', () => {
  for (const path of ['/', '/demo/', '/play/']) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`${path} has no serious or critical axe violations (${colorScheme})`, async ({
        page,
      }) => {
        /**
         * Reduced motion is emulated so the scroll-reveal transition is off.
         * Otherwise axe can sample an element mid-fade and report the blended,
         * partially-transparent colour as a contrast failure — a false positive
         * that makes the check untrustworthy. It also matches how many users
         * who rely on this actually browse.
         */
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
        await page.goto(path);

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze();

        const blocking = results.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical'
        );

        expect(
          blocking.map(
            (v) => `${v.id}: ${v.help} → ${v.nodes[0]?.target.join(' ')}`
          ),
          'serious/critical accessibility violations'
        ).toEqual([]);
      });
    }
  }
});
