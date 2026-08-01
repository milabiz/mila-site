import { z } from 'zod';

export const DIALECTS = ['tsql', 'postgres', 'mysql'] as const;
export type Dialect = (typeof DIALECTS)[number];

export const DIALECT_LABELS: Record<Dialect, string> = {
  tsql: 'SQL Server (T-SQL)',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
};

export const MAX_SQL_CHARS = 4000;
export const MAX_SCHEMA_CHARS = 4000;

/**
 * Request contract.
 *
 * z.object() strips unknown keys, which is load-bearing here: a client must
 * never be able to smuggle `model`, `provider`, `max_tokens`, `prompt`, or
 * `DEMO_MODE` into the outbound provider call. Those are server constants.
 */
export const requestSchema = z.object({
  sql: z.string().trim().min(1).max(MAX_SQL_CHARS),
  schema: z.string().trim().max(MAX_SCHEMA_CHARS).optional(),
  dialect: z.enum(DIALECTS).default('tsql'),
});

export type ReviewRequest = z.infer<typeof requestSchema>;

export const severitySchema = z.enum(['high', 'medium', 'low']);
export type Severity = z.infer<typeof severitySchema>;

/**
 * Response contract.
 *
 * `response_format` constrains which providers are eligible; it is never a
 * guarantee about what comes back. Everything is validated server-side before
 * it reaches the UI, and anything failing validation becomes a controlled
 * error rather than a partially-rendered result.
 */
export const reviewSchema = z.object({
  /** One-line judgement, plain English, no jargon. */
  verdict: z.string().trim().min(1).max(400),
  /** Short paragraph a non-DBA can act on. Shown before any technical detail. */
  plain_summary: z.string().trim().min(1).max(1400),
  issues: z
    .array(
      z.object({
        severity: severitySchema,
        title: z.string().trim().min(1).max(180),
        detail: z.string().trim().min(1).max(1000),
      })
    )
    .max(8),
  /** Suggested index DDL. May be empty when there is nothing worth adding. */
  indexes: z.array(z.string().trim().min(1).max(600)).max(6),
  /** Rewritten query, or null when a rewrite is not warranted. */
  rewrite: z.string().trim().max(MAX_SQL_CHARS).nullable(),
  /** Caveats, assumptions, or what extra context would sharpen the review. */
  notes: z.string().trim().max(1000).nullable(),
});

export type Review = z.infer<typeof reviewSchema>;

/** JSON Schema sent to the provider via response_format. */
export const reviewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'plain_summary', 'issues', 'indexes', 'rewrite', 'notes'],
  properties: {
    verdict: { type: 'string' },
    plain_summary: { type: 'string' },
    issues: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          title: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    indexes: { type: 'array', maxItems: 6, items: { type: 'string' } },
    rewrite: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
} as const;

/** Error codes the UI branches on. Never leak provider detail beyond these. */
export type ErrorCode =
  | 'bad_method'
  | 'bad_content_type'
  | 'too_large'
  | 'bad_origin'
  | 'bad_request'
  | 'no_ip'
  | 'rate_limited'
  | 'busy'
  | 'unavailable'
  | 'upstream_failed'
  | 'invalid_response';
