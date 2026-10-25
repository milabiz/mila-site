import type { APIRoute } from 'astro';
import { demoMode, loadLiveConfig } from '../../lib/config';
import { requestReview } from '../../lib/openrouter';
import { buildUserPrompt, SYSTEM_PROMPT } from '../../lib/prompt';
import { checkRateLimit } from '../../lib/rate-limit';
import {
  clientIp,
  hashIp,
  isProduction,
  originAllowed,
  readBodyCapped,
} from '../../lib/request-guards';
import { MOCK_REVIEW } from '../../lib/mock-review';
import { requestSchema, type ErrorCode, type Review } from '../../lib/review-schema';

export const prerender = false;
export const maxDuration = 30;

/**
 * Never cache: submitted SQL must not sit in an intermediary cache.
 * Retry-After is set on 429 so the UI can show a real wait instead of guessing.
 */
function json(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function fail(
  code: ErrorCode,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  // Deliberately opaque. Never echo provider bodies, keys, headers, or the
  // submitted query — any of those would leak content into the response.
  return json({ error: code }, status, extraHeaders);
}

function ok(review: Review, meta: { mocked: boolean }): Response {
  return json({ review, mocked: meta.mocked }, 200);
}

export const POST: APIRoute = async ({ request }) => {
  // -- 1. Method + content type ------------------------------------------
  // Astro's own CSRF guard (security.checkOrigin, on by default) already
  // rejects cross-origin POSTs with form-like content types before this runs.
  // It does NOT cover application/json, so the origin check below is still
  // load-bearing — the two layers are complementary, not redundant.
  if (request.method !== 'POST') return fail('bad_method', 405);

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return fail('bad_content_type', 415);
  }

  // -- 2. Body size, before any parsing ----------------------------------
  const body = await readBodyCapped(request);
  if (!body.ok) return fail('too_large', 413);

  // -- 3. Origin ----------------------------------------------------------
  if (!originAllowed(request)) return fail('bad_origin', 403);

  // -- 4. Parse + validate ------------------------------------------------
  // Ahead of the mode branch so mock mode exercises the full request contract:
  // a preview returning a canned 200 for malformed input would make the
  // preview environment useless for testing the failure paths.
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body.text);
  } catch {
    return fail('bad_request', 400);
  }

  // Unknown keys are stripped, so a client can never smuggle model / provider /
  // max_tokens / prompt / DEMO_MODE into the outbound call.
  const parsed = requestSchema.safeParse(parsedBody);
  if (!parsed.success) return fail('bad_request', 400);

  // -- 5/6. Mode branch ---------------------------------------------------
  // Ordered after the cheap gates on purpose: if the mock branch came first,
  // preview requests would bypass them and the origin allowlist would never be
  // exercised on the very environment where it is being tested.
  if (demoMode() === 'mock') {
    if (isProduction()) {
      // Mock must never become a production bypass.
      return fail('unavailable', 503);
    }
    // No config load, no Supabase client, no RPC, no provider call.
    return ok(MOCK_REVIEW, { mocked: true });
  }

  // -- 7. Live path -------------------------------------------------------
  const configResult = loadLiveConfig();
  if (!configResult.ok) {
    // A configuration failure is never "allow". Count only — never values.
    console.error(
      `[review-sql] refusing request: ${configResult.missing.length} config problem(s)`
    );
    return fail('unavailable', 503);
  }
  const config = configResult.config;

  const ip = clientIp(request);
  if (!ip) return fail('no_ip', 400);

  const ipHash = await hashIp(ip, config.ipHashSalt);

  const limit = await checkRateLimit(config, ipHash);

  if (!limit.ok) {
    // Limiter error, timeout, or unexpected shape — fail closed, zero
    // provider calls. This is the rule that must never regress.
    console.error('[review-sql] rate limiter unavailable; refusing request');
    return fail('unavailable', 503);
  }

  if (!limit.allowed) {
    const headers = { 'Retry-After': String(limit.retryAfter) };
    return limit.reason === 'busy'
      ? fail('busy', 503, headers)
      : fail('rate_limited', 429, headers);
  }

  // -- Provider call: exactly one, no retry -------------------------------
  const result = await requestReview(
    config.openRouterKey,
    SYSTEM_PROMPT,
    buildUserPrompt(parsed.data.sql, parsed.data.dialect, parsed.data.schema)
  );

  if (!result.ok) {
    if (result.code === 'no_provider') {
      // No provider satisfied ZDR + data_collection:deny + structured output.
      // Fail closed rather than silently routing to a data-retaining provider.
      console.error('[review-sql] no eligible provider for routing constraints');
      return fail('unavailable', 503);
    }
    return fail(result.code, 502);
  }

  return ok(result.review, { mocked: false });
};

/** Anything other than POST gets a clean rejection rather than a 404. */
export const ALL: APIRoute = async ({ request }) => {
  if (request.method === 'POST') return fail('bad_request', 400);
  return fail('bad_method', 405, { Allow: 'POST' });
};
