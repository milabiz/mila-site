import { createClient } from '@supabase/supabase-js';
import { RPC_TIMEOUT_MS, type LiveConfig } from './config';

export type DenyReason = 'ip_cap' | 'global_cap' | 'busy' | 'bad_request';

export type LimitResult =
  | { ok: true; allowed: true }
  | { ok: true; allowed: false; reason: DenyReason; retryAfter: number }
  /** Limiter itself failed. Callers MUST treat this as deny, never as allow. */
  | { ok: false };

/**
 * Calls the exposed wrapper — public.rate_limit_demo, never the private
 * implementation. A function in the `private` schema is not reachable through
 * PostgREST even with the service-role key; that failure appears at runtime,
 * not at migration time.
 *
 * The Supabase client is constructed here rather than at module scope: a
 * top-level createClient() runs on import regardless of which branch executes,
 * and would throw in preview where the service-role key is deliberately absent
 * — breaking exactly the environment mock mode exists to serve.
 */
export async function checkRateLimit(
  config: LiveConfig,
  ipHash: string
): Promise<LimitResult> {
  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    const { data, error } = await supabase
      .rpc('rate_limit_demo', { p_ip_hash: ipHash })
      .abortSignal(controller.signal);

    if (error) return { ok: false };

    // Any shape other than exactly what we expect is a limiter failure.
    if (typeof data !== 'object' || data === null) return { ok: false };

    const row = data as Record<string, unknown>;
    if (typeof row.allowed !== 'boolean') return { ok: false };

    if (row.allowed) return { ok: true, allowed: true };

    const reason = row.reason;
    if (
      reason !== 'ip_cap' &&
      reason !== 'global_cap' &&
      reason !== 'busy' &&
      reason !== 'bad_request'
    ) {
      return { ok: false };
    }

    const retryAfter =
      typeof row.retry_after === 'number' && row.retry_after > 0
        ? Math.ceil(row.retry_after)
        : reason === 'busy'
          ? 5
          : 3600;

    return { ok: true, allowed: false, reason, retryAfter };
  } catch {
    // Timeout or transport failure — fail closed.
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
