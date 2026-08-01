import ipaddr from 'ipaddr.js';

/** Hard ceiling on the whole request body, enforced before any parsing. */
export const MAX_BODY_BYTES = 10 * 1024;

export const isProduction = () => process.env.VERCEL_ENV === 'production';

/**
 * Origin allowlist.
 *
 * Exact origins only — never a `*.vercel.app` wildcard, which would let any
 * stranger's Vercel deployment spend the quota. VERCEL_URL / VERCEL_BRANCH_URL
 * are set by the platform to *this* deployment's own hostname, so previews
 * validate themselves without widening the list.
 */
export function allowedOrigins(): string[] {
  const origins = ['https://milabiz.com', 'https://www.milabiz.com'];

  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
    if (host) origins.push(`https://${host}`);
  }

  if (!isProduction()) {
    origins.push(
      'http://localhost:4321',
      'http://localhost:3000',
      'http://127.0.0.1:4321'
    );
  }

  return origins;
}

/**
 * The Origin header is enforced by browsers, not by attackers — a script sets
 * it trivially. This stops ordinary cross-site quota theft; it is not bot
 * protection. That job belongs to the edge rate-limit rule.
 */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');

  if (!origin) {
    // Fail closed in production rather than drifting into a permissive default.
    // Same-origin non-browser clients simply have to send it.
    return !isProduction();
  }

  return allowedOrigins().includes(origin);
}

/** Reads Content-Length; returns null when absent (chunked bodies). */
export function declaredBodyBytes(request: Request): number | null {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads the body with a hard byte ceiling.
 *
 * Checking field lengths after request.json() means an oversized payload has
 * already been parsed into memory, so the limit is enforced on the stream.
 */
export async function readBodyCapped(
  request: Request,
  limit = MAX_BODY_BYTES
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = declaredBodyBytes(request);
  if (declared !== null && declared > limit) return { ok: false };

  const reader = request.body?.getReader();
  if (!reader) {
    const text = await request.text();
    return new TextEncoder().encode(text).length > limit
      ? { ok: false }
      : { ok: true, text };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(merged) };
}

/**
 * Normalizes a client IP for bucketing.
 *
 * IPv6 collapses to its /64 prefix so a single client cannot rotate through
 * its allocation to buy extra quota. Parsing goes through ipaddr.js because
 * string slicing mangles compressed `::` forms.
 */
export function normalizeIp(raw: string): string | null {
  const candidate = raw.split(',')[0]?.trim();
  if (!candidate) return null;

  // Strip a :port suffix from bare IPv4, and brackets from [v6]:port.
  const cleaned = candidate.startsWith('[')
    ? (candidate.match(/^\[(.+)\]/)?.[1] ?? candidate)
    : candidate.split(':').length === 2
      ? candidate.split(':')[0]
      : candidate;

  if (!ipaddr.isValid(cleaned)) return null;

  const addr = ipaddr.parse(cleaned);

  if (addr.kind() === 'ipv4') return addr.toString();

  const parts = (addr as ipaddr.IPv6).toNormalizedString().split(':');
  return `${parts.slice(0, 4).join(':')}::/64`;
}

/**
 * Vercel documents x-vercel-forwarded-for as equivalent to x-forwarded-for
 * absent a proxy above Vercel, so it is only trusted in deployed environments.
 * Returns null in production when absent — the caller fails closed rather than
 * pooling every anonymous visitor into one shared bucket.
 */
export function clientIp(request: Request): string | null {
  const header =
    request.headers.get('x-vercel-forwarded-for') ??
    request.headers.get('x-forwarded-for');

  if (header) {
    const normalized = normalizeIp(header);
    if (normalized) return normalized;
  }

  if (!isProduction() && !process.env.VERCEL_ENV) {
    // Local dev only: an explicit constant, never used in a deployed env.
    return 'dev-local';
  }

  return null;
}

/** Keyed hash of the IP. HMAC, not sha256(salt + ip) — the salt is a key. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(ip)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
