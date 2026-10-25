import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  allowedOrigins,
  clientIp,
  hashIp,
  normalizeIp,
  originAllowed,
  readBodyCapped,
} from '../../src/lib/request-guards';

const ENV_KEYS = ['VERCEL_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://milabiz.com/api/review-sql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });

describe('origin allowlist', () => {
  it('never contains a wildcard — a *.vercel.app pattern would let any stranger spend the quota', () => {
    process.env.VERCEL_ENV = 'production';
    for (const origin of allowedOrigins()) {
      expect(origin).not.toContain('*');
    }
  });

  it('allows the production hosts', () => {
    process.env.VERCEL_ENV = 'production';
    expect(originAllowed(post('{}', { Origin: 'https://milabiz.com' }))).toBe(true);
    expect(originAllowed(post('{}', { Origin: 'https://www.milabiz.com' }))).toBe(
      true
    );
  });

  it('rejects an unrelated origin', () => {
    process.env.VERCEL_ENV = 'production';
    expect(originAllowed(post('{}', { Origin: 'https://evil.example' }))).toBe(
      false
    );
  });

  it("rejects another deployment's vercel.app origin", () => {
    process.env.VERCEL_ENV = 'production';
    expect(
      originAllowed(post('{}', { Origin: 'https://someone-else.vercel.app' }))
    ).toBe(false);
  });

  it("admits this deployment's own preview origin", () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_URL = 'mila-site-abc123.vercel.app';
    expect(
      originAllowed(post('{}', { Origin: 'https://mila-site-abc123.vercel.app' }))
    ).toBe(true);
  });

  it('fails closed on a missing Origin in production', () => {
    process.env.VERCEL_ENV = 'production';
    expect(originAllowed(post('{}'))).toBe(false);
  });

  it('permits a missing Origin outside production so local dev works', () => {
    delete process.env.VERCEL_ENV;
    expect(originAllowed(post('{}'))).toBe(true);
  });
});

describe('body size cap', () => {
  it('accepts a small body', async () => {
    const result = await readBodyCapped(post('{"sql":"SELECT 1"}'));
    expect(result.ok).toBe(true);
  });

  it('rejects a body over the cap', async () => {
    const oversized = JSON.stringify({ sql: 'x'.repeat(MAX_BODY_BYTES + 500) });
    const result = await readBodyCapped(post(oversized));
    expect(result.ok).toBe(false);
  });

  it('rejects on a declared Content-Length over the cap without reading it', async () => {
    const request = new Request('https://milabiz.com/api/review-sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_BODY_BYTES * 10),
      },
      body: '{"sql":"SELECT 1"}',
    });
    expect((await readBodyCapped(request)).ok).toBe(false);
  });
});

describe('IP normalization', () => {
  it('passes IPv4 through', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('takes the first entry of a comma-separated forwarding chain', () => {
    expect(normalizeIp('203.0.113.7, 70.41.3.18')).toBe('203.0.113.7');
  });

  it('collapses IPv6 to its /64 prefix so a client cannot rotate for extra quota', () => {
    const a = normalizeIp('2001:db8:85a3:1111:aaaa:bbbb:cccc:dddd');
    const b = normalizeIp('2001:db8:85a3:1111:9999:8888:7777:6666');
    expect(a).toBe(b);
    expect(a).toContain('/64');
  });

  it('handles compressed IPv6 correctly — string slicing would mangle this', () => {
    const compressed = normalizeIp('2001:db8::1');
    const expanded = normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(compressed).toBe(expanded);
  });

  it('distinguishes different /64 allocations', () => {
    expect(normalizeIp('2001:db8:85a3:1111::1')).not.toBe(
      normalizeIp('2001:db8:85a3:2222::1')
    );
  });

  it('returns null for garbage', () => {
    expect(normalizeIp('not-an-ip')).toBeNull();
    expect(normalizeIp('')).toBeNull();
  });
});

describe('client IP resolution', () => {
  it('fails closed in production when no forwarding header is present', () => {
    process.env.VERCEL_ENV = 'production';
    expect(clientIp(post('{}'))).toBeNull();
  });

  it('prefers the Vercel-trusted header', () => {
    process.env.VERCEL_ENV = 'production';
    const request = post('{}', {
      'x-vercel-forwarded-for': '203.0.113.7',
      'x-forwarded-for': '198.51.100.9',
    });
    expect(clientIp(request)).toBe('203.0.113.7');
  });

  it('uses an explicit constant in local dev only', () => {
    delete process.env.VERCEL_ENV;
    expect(clientIp(post('{}'))).toBe('dev-local');
  });
});

describe('IP hashing', () => {
  it('is deterministic for the same ip and salt', async () => {
    const salt = 'a'.repeat(64);
    expect(await hashIp('203.0.113.7', salt)).toBe(
      await hashIp('203.0.113.7', salt)
    );
  });

  it('differs across IPs and across salts', async () => {
    const saltA = 'a'.repeat(64);
    const saltB = 'b'.repeat(64);
    expect(await hashIp('203.0.113.7', saltA)).not.toBe(
      await hashIp('203.0.113.8', saltA)
    );
    // Rotating the salt resets all buckets — documented behaviour.
    expect(await hashIp('203.0.113.7', saltA)).not.toBe(
      await hashIp('203.0.113.7', saltB)
    );
  });

  it('never contains the original address', async () => {
    const hash = await hashIp('203.0.113.7', 'a'.repeat(64));
    expect(hash).not.toContain('203.0.113');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
