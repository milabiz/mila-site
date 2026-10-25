import {
  MAX_OUTPUT_TOKENS,
  OPENROUTER_MODEL,
  OPENROUTER_URL,
  UPSTREAM_TIMEOUT_MS,
} from './config';
import { reviewJsonSchema, reviewSchema, type Review } from './review-schema';

export type ProviderResult =
  | { ok: true; review: Review }
  | { ok: false; code: 'upstream_failed' | 'invalid_response' | 'no_provider' };

/**
 * Provider routing.
 *
 * Deliberately NOT pinned to a single provider: a hard pin risks the demo
 * going intermittently unavailable, which is the worst failure mode for a site
 * whose only live proof this is. Instead the eligible set is constrained to
 * providers satisfying all three requirements at once, and we fail closed if
 * none qualifies.
 *
 * require_parameters is the load-bearing flag. Without it, routing can pick a
 * provider that silently ignores response_format — breaking the structured
 * contract the whole result UI depends on, in a way that looks like a model
 * quality problem rather than a routing one.
 */
const PROVIDER_PREFERENCES = {
  require_parameters: true,
  zdr: true,
  data_collection: 'deny',
  allow_fallbacks: true,
  // Sent in-request, not only configured on the dashboard.
  max_price: { prompt: 2, completion: 10 },
} as const;

export async function requestReview(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<ProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://milabiz.com',
        'X-Title': 'Mila SQL Performance Review',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.15,
        provider: PROVIDER_PREFERENCES,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'sql_performance_review',
            strict: true,
            schema: reviewJsonSchema,
          },
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
  } catch {
    // Timeout or transport failure. No retry: a retry loop turns one abusive
    // request into several.
    return { ok: false, code: 'upstream_failed' };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // 404 here typically means no provider satisfied the routing constraints.
    // Never surface the provider body — it can echo request content.
    return {
      ok: false,
      code: response.status === 404 ? 'no_provider' : 'upstream_failed',
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: 'invalid_response' };
  }

  const content = (payload as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;

  if (typeof content !== 'string') {
    return { ok: false, code: 'invalid_response' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, code: 'invalid_response' };
  }

  // response_format constrains which providers are eligible; it is never a
  // guarantee about output. Strict validation is mandatory regardless.
  const result = reviewSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, code: 'invalid_response' };
  }

  return { ok: true, review: result.data };
}
