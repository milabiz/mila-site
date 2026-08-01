import type { Review } from './review-schema';

/**
 * Canned response for preview deployments (DEMO_MODE=mock).
 *
 * Previews are publicly reachable by URL, so they deliberately hold no
 * OPENROUTER_API_KEY and no SUPABASE_SERVICE_ROLE_KEY. This keeps the UI fully
 * testable there — every state, every panel — without the secrets or the spend.
 *
 * It is shaped to exercise the real UI: multiple severities, index DDL, a
 * rewrite, and notes. Keep it schema-valid; the Vitest suite parses it.
 */
export const MOCK_REVIEW: Review = {
  verdict:
    'This query will get slower as the orders table grows, and it is doing more work than it needs to.',
  plain_summary:
    'The query searches customer names in a way that forces the database to check every row instead of jumping straight to matches. It also pulls back every column when only a handful are used, and it recalculates a total for each row separately. On a small table you would not notice; past a few hundred thousand orders this becomes the slow page in your application.',
  issues: [
    {
      severity: 'high',
      title: 'Leading-wildcard LIKE prevents an index seek',
      detail:
        "LIKE '%smith%' starts with a wildcard, which makes the filter non-SARGable (the database cannot use an index to jump to matching rows, so it reads the whole table). Consider full-text search, a trailing-wildcard match, or a computed column if the leading wildcard is genuinely required.",
    },
    {
      severity: 'medium',
      title: 'Correlated subquery evaluated per row',
      detail:
        'The SELECT list contains a subquery referencing the outer row, so it is evaluated once per returned row. Rewriting it as a single grouped join lets the engine compute all totals in one pass.',
    },
    {
      severity: 'low',
      title: 'SELECT * over a wide table',
      detail:
        'Returning every column prevents covering-index strategies and moves more data across the network than the application uses. Name the columns you actually need.',
    },
  ],
  indexes: [
    'CREATE NONCLUSTERED INDEX IX_Orders_CustomerId_OrderDate\n  ON dbo.Orders (CustomerId, OrderDate DESC)\n  INCLUDE (Total, Status);',
  ],
  rewrite:
    'SELECT c.CustomerId,\n       c.Name,\n       o.OrderDate,\n       agg.OrderTotal\nFROM dbo.Customers AS c\nJOIN dbo.Orders AS o\n  ON o.CustomerId = c.CustomerId\nCROSS APPLY (\n  SELECT SUM(oi.LineTotal) AS OrderTotal\n  FROM dbo.OrderItems AS oi\n  WHERE oi.OrderId = o.OrderId\n) AS agg\nWHERE o.OrderDate >= DATEADD(MONTH, -3, SYSUTCDATETIME())\nORDER BY o.OrderDate DESC;',
  notes:
    'This is a preview environment, so the analysis above is a fixed sample rather than a live review. Without table sizes, existing index definitions, or an execution plan, index advice is directional — always validate against your own plan before applying it.',
};
