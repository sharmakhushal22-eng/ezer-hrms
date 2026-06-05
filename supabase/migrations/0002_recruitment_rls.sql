-- ============================================================================
-- 0002_recruitment_rls.sql
-- Allow the app's anon key to READ + WRITE the recruitment tables.
--
-- WHY: some recruitment tables (e.g. candidates) have RLS enabled with no
-- policy permitting inserts, so the app fails with
--   "new row violates row-level security policy for table candidates".
-- This adds a permissive policy so the module is fully functional.
--
-- ⚠️ SECURITY: this exposes recruitment data (incl. candidate PII) to anyone
-- with the public anon key. It's a functionality-first stopgap — add real auth
-- and scoped policies before production.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'manpower_requisitions','candidates','mrf_approvals',
    'offer_letters','ctc_negotiations','preonboarding_links'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_anon_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true);',
      t || '_anon_all', t
    );
  end loop;
end $$;
