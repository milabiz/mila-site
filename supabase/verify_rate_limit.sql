-- ============================================================================
-- Post-migration verification. Run in the Supabase SQL editor after applying
-- 20260801000000_demo_rate_limit.sql. Every check should print PASS.
--
-- This does NOT replace the runtime callability check — a function can have
-- correct grants and still be unreachable through PostgREST. Prove the real
-- supabase.rpc() call separately (see Verification step 3 in the plan).
-- ============================================================================

-- 1. `private` is not an exposed schema, and the table is locked down.
select
  case when has_schema_privilege('anon', 'private', 'USAGE') = false
        and has_schema_privilege('authenticated', 'private', 'USAGE') = false
       then 'PASS' else 'FAIL' end                as schema_not_exposed,
  case when (select relrowsecurity from pg_class
             where oid = 'private.demo_usage'::regclass)
       then 'PASS' else 'FAIL' end                as rls_enabled,
  case when (select count(*) from pg_policies
             where schemaname = 'private' and tablename = 'demo_usage') = 0
       then 'PASS (deny-all)' else 'REVIEW' end   as policy_count;

-- 2. Grants. The PUBLIC default must be gone from BOTH functions.
select
  case when has_function_privilege('anon',
         'public.rate_limit_demo(text)', 'EXECUTE') = false
       then 'PASS' else 'FAIL — anon can call the wrapper' end  as wrapper_anon,
  case when has_function_privilege('authenticated',
         'public.rate_limit_demo(text)', 'EXECUTE') = false
       then 'PASS' else 'FAIL — authenticated can call the wrapper' end as wrapper_auth,
  case when has_function_privilege('service_role',
         'public.rate_limit_demo(text)', 'EXECUTE')
       then 'PASS' else 'FAIL — service_role cannot call the wrapper' end as wrapper_service,
  case when has_function_privilege('anon',
         'private.check_and_record_usage(text)', 'EXECUTE') = false
       then 'PASS' else 'FAIL — anon can call the private fn' end as private_anon;

-- 3. search_path is pinned on both definer functions.
select p.proname,
       case when 'search_path=private, pg_temp' = any(p.proconfig)
            then 'PASS' else 'FAIL — unpinned search_path' end as search_path_check
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'private' and p.proname = 'check_and_record_usage')
   or (n.nspname = 'public'  and p.proname = 'rate_limit_demo');

-- 4. Both indexes exist.
select
  case when count(*) filter (where indexname = 'demo_usage_ip_created_idx') = 1
        and count(*) filter (where indexname = 'demo_usage_created_idx')    = 1
       then 'PASS' else 'FAIL — missing index' end as indexes
from pg_indexes where schemaname = 'private' and tablename = 'demo_usage';

-- 5. Cleanup job registered exactly once.
select case when count(*) = 1 then 'PASS' else 'FAIL — ' || count(*) || ' jobs' end
         as cleanup_job
from cron.job where jobname = 'mila-demo-usage-cleanup';

-- 6. Functional smoke: 5 allowed, 6th denied, then clean up after yourself.
do $$
declare
  v jsonb;
  v_key text := 'verify-' || gen_random_uuid()::text;
  i int;
begin
  for i in 1..5 loop
    v := private.check_and_record_usage(v_key);
    assert (v->>'allowed')::bool, format('call %s should have been allowed: %s', i, v);
  end loop;

  v := private.check_and_record_usage(v_key);
  assert (v->>'allowed')::bool = false, format('6th call should be denied: %s', v);
  assert v->>'reason' = 'ip_cap', format('expected ip_cap, got: %s', v);
  assert (v->>'retry_after')::int > 0, 'retry_after should be positive';

  delete from private.demo_usage where ip_hash = v_key;
  raise notice 'PASS — per-IP cap holds, test rows removed';
end
$$;
