import { test, expect, type Page } from '@playwright/test';

const VALID_REVIEW = {
  verdict: 'This query scans the whole table.',
  plain_summary:
    'The filter stops the database using an index, so it reads every row.',
  issues: [
    { severity: 'high', title: 'Full table scan', detail: 'No usable index.' },
    { severity: 'low', title: 'SELECT *', detail: 'Returns unused columns.' },
  ],
  indexes: ['CREATE INDEX IX_Orders_Date ON dbo.Orders (OrderDate);'],
  rewrite: 'SELECT OrderId FROM dbo.Orders WHERE OrderDate >= @from;',
  notes: 'Validate against your own execution plan.',
};

/**
 * All demo specs mock /api/review-sql. CI must never spend API credit, and a
 * real call would make these tests flaky on provider latency.
 */
async function mockApi(
  page: Page,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  await page.route('**/api/review-sql', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body),
    });
  });
}

test.describe('SQL review demo', () => {
  test('arrives prefilled so a visitor gets a result in one click', async ({
    page,
  }) => {
    await page.goto('/demo/');
    const sql = page.locator('#review-sql');
    await expect(sql).toHaveValue(/SELECT \*/);
    await expect(page.locator('[data-char-count]')).not.toHaveText('0');
  });

  test('leads with plain English and keeps technical detail collapsed', async ({
    page,
  }) => {
    await mockApi(page, { review: VALID_REVIEW, mocked: false });
    await page.goto('/demo/');
    await page.locator('[data-submit]').click();

    await expect(page.locator('[data-status]')).toHaveText('Review ready');
    await expect(page.locator('.result__verdict h3')).toHaveText(
      VALID_REVIEW.verdict
    );

    // Progressive disclosure: the technical panel must start closed.
    const details = page.locator('.result details.disclosure');
    await expect(details).toBeVisible();
    expect(await details.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);

    // Findings only appear once opened.
    await expect(page.locator('.result__issue').first()).toBeHidden();
    await details.locator('summary').click();
    await expect(page.locator('.result__issue')).toHaveCount(2);
    await expect(page.locator('.result__issue').first()).toHaveAttribute(
      'data-severity',
      'high'
    );
  });

  test('shows the limited-confidence note when no schema is supplied', async ({
    page,
  }) => {
    await mockApi(page, { review: VALID_REVIEW, mocked: false });
    await page.goto('/demo/');
    await page.locator('[data-submit]').click();
    await expect(page.locator('.status--info')).toContainText(
      /confidence limited/i
    );
  });

  test('drops the confidence note once schema is supplied', async ({ page }) => {
    await mockApi(page, { review: VALID_REVIEW, mocked: false });
    await page.goto('/demo/');
    await page.locator('[data-schema-disclosure] summary').click();
    await page.locator('#review-schema').fill('CREATE TABLE dbo.Orders (Id INT);');
    await page.locator('[data-submit]').click();
    await expect(page.locator('.result__verdict h3')).toBeVisible();
    await expect(page.locator('.status--info')).toHaveCount(0);
  });

  test('renders a 429 with a real wait time from Retry-After', async ({ page }) => {
    await mockApi(page, { error: 'rate_limited' }, 429, { 'Retry-After': '1800' });
    await page.goto('/demo/');
    await page.locator('[data-submit]').click();

    await expect(page.locator('[data-status]')).toHaveText('Limit reached');
    await expect(page.locator('.status--error')).toContainText('30 minute');
  });

  test('handles a malformed response without rendering a partial result', async ({
    page,
  }) => {
    await mockApi(page, { notAReview: true }, 200);
    await page.goto('/demo/');
    await page.locator('[data-submit]').click();

    await expect(page.locator('[data-status]')).toHaveText('Request failed');
    await expect(page.locator('.status--error')).toContainText(/malformed/i);
    await expect(page.locator('.result')).toHaveCount(0);
  });

  test('handles a 503 without leaking provider detail', async ({ page }) => {
    await mockApi(page, { error: 'unavailable' }, 503);
    await page.goto('/demo/');
    await page.locator('[data-submit]').click();
    await expect(page.locator('.status--error')).toContainText(
      /temporarily unavailable/i
    );
  });

  /** Model output is untrusted: it must render as inert text, never markup. */
  test('renders hostile model output as text, not HTML', async ({ page }) => {
    await mockApi(page, {
      review: {
        ...VALID_REVIEW,
        verdict: '<img src=x onerror="window.__pwned=1">',
        issues: [
          {
            severity: 'high',
            title: '<b>not bold</b>',
            detail: '<iframe src="//evil"></iframe>',
          },
        ],
      },
      mocked: false,
    });

    await page.goto('/demo/');
    await page.locator('[data-submit]').click();
    await expect(page.locator('.result__verdict h3')).toBeVisible();
    await page.locator('.result details.disclosure summary').click();

    const output = page.locator('[data-output]');
    expect(await output.locator('img').count()).toBe(0);
    expect(await output.locator('iframe').count()).toBe(0);
    expect(await output.locator('b').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();

    await expect(page.locator('.result__verdict h3')).toHaveText(
      '<img src=x onerror="window.__pwned=1">'
    );
  });

  test('announces completion via a short status, not a live result panel', async ({
    page,
  }) => {
    await mockApi(page, { review: VALID_REVIEW, mocked: false });
    await page.goto('/demo/');

    const status = page.locator('[data-status]');
    await expect(status).toHaveAttribute('role', 'status');

    // The long panel must NOT be a live region, or a screen reader reads the
    // entire analysis on arrival, often twice.
    const output = page.locator('[data-output]');
    expect(await output.getAttribute('aria-live')).toBeNull();
    expect(await output.getAttribute('role')).toBeNull();

    await page.locator('[data-submit]').click();
    await expect(status).toHaveText('Review ready');
  });
});
