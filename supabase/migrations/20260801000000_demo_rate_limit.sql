-- ============================================================================
-- SQL Performance Review demo — rate limiting
--
-- Design notes that matter if you edit this:
--   * The table and the real implementation live in `private`, which PostgREST
--     does not expose. Exactly one thin wrapper lives in `public` so the server
--     can reach it via supabase.rpc(); a function in `private` is NOT callable
--     through the API even with the service-role key.
--   * Counting rows then inserting is a TOCTOU race under READ COMMITTED: two
--     concurrent calls both read count=4, both insert, and the cap is blown.
--     Advisory locks close that window.
--   * pg_advisory_xact_lock() waits forever. We use the try_ variant so a
--     stalled transaction can never queue up serverless functions behind it.
--   * Lock order is always global-then-IP. Consistent ordering prevents
--     deadlock between concurrent callers.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Usage table
-- ---------------------------------------------------------------------------

create table if not exists private.demo_usage (
  id          bigint generated always as identity primary key,
  ip_hash     text        not null,
  created_at  timestamptz not null default now()
);

alter table private.demo_usage enable row level security;
-- Intentionally no policies: RLS with zero policies denies all non-superuser,
-- non-definer access. Only the SECURITY DEFINER function below touches it.

revoke all on table private.demo_usage from public, anon, authenticated;

-- Per-IP bucket lookups.
create index if not exists demo_usage_ip_created_idx
  on private.demo_usage (ip_hash, created_at desc);

-- Global daily count. The composite index above cannot serve a cross-IP
-- `where created_at > $1` scan, so this one is not redundant.
create index if not exists demo_usage_created_idx
  on private.demo_usage (created_at desc);

-- ---------------------------------------------------------------------------
-- Limiter — checks both caps and records the hit atomically
-- ---------------------------------------------------------------------------

create or replace function private.check_and_record_usage(p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = private, pg_temp
as $$
declare
  -- Advisory lock namespace. Arbitrary but must stay stable.
  c_lock_ns       constant int := 918273;
  c_ip_limit      constant int := 5;    -- per IP, rolling hour
  c_global_limit  constant int := 100;  -- global, per UTC day

  v_day_start     timestamptz;
  v_ip_count      int;
  v_global_count  int;
  v_retry_after   int;
begin
  if p_ip_hash is null or length(p_ip_hash) < 16 then
    -- Caller sent a malformed bucket key. Fail closed rather than pooling
    -- every visitor into one bucket.
    return jsonb_build_object('allowed', false, 'reason', 'bad_request');
  end if;

  -- Applies to subsequent statements in this transaction (e.g. the insert).
  perform set_config('lock_timeout', '1500ms', true);

  -- Global lock FIRST, then the IP lock. Never reorder.
  if not pg_try_advisory_xact_lock(c_lock_ns, 0) then
    return jsonb_build_object('allowed', false, 'reason', 'busy');
  end if;

  if not pg_try_advisory_xact_lock(c_lock_ns, hashtext(p_ip_hash)) then
    return jsonb_build_object('allowed', false, 'reason', 'busy');
  end if;

  v_day_start := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';

  select count(*) into v_global_count
  from private.demo_usage
  where created_at >= v_day_start;

  if v_global_count >= c_global_limit then
    v_retry_after := greatest(
      1, ceil(extract(epoch from (v_day_start + interval '1 day') - now()))::int
    );
    return jsonb_build_object(
      'allowed', false, 'reason', 'global_cap', 'retry_after', v_retry_after
    );
  end if;

  select count(*) into v_ip_count
  from private.demo_usage
  where ip_hash = p_ip_hash
    and created_at >= now() - interval '1 hour';

  if v_ip_count >= c_ip_limit then
    -- Seconds until the oldest hit in the window ages out.
    select greatest(
             1,
             ceil(extract(epoch from (min(created_at) + interval '1 hour') - now()))::int
           )
      into v_retry_after
    from private.demo_usage
    where ip_hash = p_ip_hash
      and created_at >= now() - interval '1 hour';

    return jsonb_build_object(
      'allowed', false, 'reason', 'ip_cap', 'retry_after', coalesce(v_retry_after, 3600)
    );
  end if;

  insert into private.demo_usage (ip_hash) values (p_ip_hash);

  return jsonb_build_object(
    'allowed',          true,
    'remaining_ip',     c_ip_limit - v_ip_count - 1,
    'remaining_global', c_global_limit - v_global_count - 1
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Exposed wrapper — the only thing the server calls
-- ---------------------------------------------------------------------------

create or replace function public.rate_limit_demo(p_ip_hash text)
returns jsonb
language sql
security definer
set search_path = private, pg_temp
as $$
  select private.check_and_record_usage(p_ip_hash);
$$;

-- Postgres grants EXECUTE to PUBLIC by default, and anon/authenticated inherit
-- through it. Revoking from those roles alone would leave both callable.
revoke all on function private.check_and_record_usage(text) from public;
revoke all on function public.rate_limit_demo(text)         from public;

grant execute on function public.rate_limit_demo(text) to service_role;

-- ---------------------------------------------------------------------------
-- Retention — scheduled, not sampled
--
-- Sampled cleanup inside the RPC stops running when traffic stops, leaving
-- hashes indefinitely. pg_cron runs regardless of traffic.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

do $$
begin
  -- Unschedule-then-schedule so a re-run cannot stack duplicate jobs.
  if exists (select 1 from cron.job where jobname = 'mila-demo-usage-cleanup') then
    perform cron.unschedule('mila-demo-usage-cleanup');
  end if;

  perform cron.schedule(
    'mila-demo-usage-cleanup',
    '17 * * * *',
    $job$
      delete from private.demo_usage
      where ctid in (
        select ctid from private.demo_usage
        where created_at < now() - interval '48 hours'
        limit 5000
      );
    $job$
  );
end
$$;
