import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIN_SALT_CHARS, demoMode, loadLiveConfig } from '../../src/lib/config';

const KEYS = [
  'DEMO_MODE',
  'OPENROUTER_API_KEY',
  'SUPABASE_URL',
  'PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'IP_HASH_SALT',
] as const;

let saved: Record<string, string | undefined>;

const goodSalt = 'x'.repeat(MIN_SALT_CHARS);

const setValidConfig = () => {
  process.env.OPENROUTER_API_KEY = 'sk-test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  process.env.IP_HASH_SALT = goodSalt;
};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('demoMode', () => {
  it('defaults to live', () => {
    expect(demoMode()).toBe('live');
  });

  it('is mock only when explicitly set', () => {
    process.env.DEMO_MODE = 'mock';
    expect(demoMode()).toBe('mock');
  });

  it('treats any other value as live — never as a bypass', () => {
    for (const value of ['MOCK', 'mocked', 'true', '1', 'yes', '']) {
      process.env.DEMO_MODE = value;
      expect(demoMode()).toBe('live');
    }
  });
});

/**
 * The fail-closed contract. Its natural default is the dangerous one, so each
 * missing-secret case is asserted individually rather than in aggregate.
 */
describe('loadLiveConfig fails closed', () => {
  it('succeeds when everything is present', () => {
    setValidConfig();
    const result = loadLiveConfig();
    expect(result.ok).toBe(true);
  });

  it.each([
    ['OPENROUTER_API_KEY'],
    ['SUPABASE_SERVICE_ROLE_KEY'],
    ['IP_HASH_SALT'],
  ])('refuses when %s is missing', (key) => {
    setValidConfig();
    delete process.env[key];
    const result = loadLiveConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain(key);
  });

  it('refuses when the supabase url is missing entirely', () => {
    setValidConfig();
    delete process.env.SUPABASE_URL;
    delete process.env.PUBLIC_SUPABASE_URL;
    expect(loadLiveConfig().ok).toBe(false);
  });

  it('refuses a salt below the minimum length', () => {
    setValidConfig();
    process.env.IP_HASH_SALT = 'short';
    const result = loadLiveConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain('IP_HASH_SALT_TOO_SHORT');
  });

  it('accepts a salt at exactly the minimum length', () => {
    setValidConfig();
    process.env.IP_HASH_SALT = 'y'.repeat(MIN_SALT_CHARS);
    expect(loadLiveConfig().ok).toBe(true);
  });

  it('never returns secret values in the failure report', () => {
    setValidConfig();
    process.env.IP_HASH_SALT = 'short';
    const result = loadLiveConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Only key NAMES, never values — this list is safe to log.
      expect(result.missing.join(' ')).not.toContain('sk-test');
      expect(result.missing.join(' ')).not.toContain('service-key');
      expect(result.missing.join(' ')).not.toContain('short');
    }
  });
});
