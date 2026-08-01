/**
 * Server configuration and the fail-closed contract.
 *
 * The single most important behavioural rule in this endpoint is that a
 * configuration or limiter failure must NEVER be interpreted as "allow" —
 * because that is the natural default and it is the dangerous one.
 */

export type DemoMode = 'live' | 'mock';

/** Minimum salt length. 32 random bytes hex-encoded is 64 chars; require that
 *  much entropy rather than accepting a short human-typed string. */
export const MIN_SALT_CHARS = 32;

export const OPENROUTER_MODEL = 'anthropic/claude-haiku-4.5';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const MAX_OUTPUT_TOKENS = 1200;

/** Server-side abort. A browser abort does not stop provider spend. */
export const UPSTREAM_TIMEOUT_MS = 22_000;

/** Client timeout on the rate-limit RPC, so a hung database cannot consume
 *  the function's whole budget waiting. */
export const RPC_TIMEOUT_MS = 4_000;

/**
 * Read from the server environment only. A request body can never influence
 * this — mock must not be reachable as a client-supplied bypass.
 */
export function demoMode(): DemoMode {
  return process.env.DEMO_MODE === 'mock' ? 'mock' : 'live';
}

export interface LiveConfig {
  openRouterKey: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  ipHashSalt: string;
}

export type ConfigResult =
  | { ok: true; config: LiveConfig }
  | { ok: false; missing: string[] };

/**
 * Validates everything the live path needs, up front.
 *
 * Returns the list of problems rather than throwing so the caller can log a
 * count without ever logging values. Called lazily inside the live branch —
 * never at module scope, because module-load work runs regardless of which
 * branch executes and would break mock mode in preview, where these secrets
 * are deliberately absent.
 */
export function loadLiveConfig(): ConfigResult {
  const openRouterKey = process.env.OPENROUTER_API_KEY ?? '';
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const ipHashSalt = process.env.IP_HASH_SALT ?? '';

  const missing: string[] = [];
  if (!openRouterKey) missing.push('OPENROUTER_API_KEY');
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!ipHashSalt) missing.push('IP_HASH_SALT');
  else if (ipHashSalt.length < MIN_SALT_CHARS) missing.push('IP_HASH_SALT_TOO_SHORT');

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: { openRouterKey, supabaseUrl, serviceRoleKey, ipHashSalt },
  };
}
