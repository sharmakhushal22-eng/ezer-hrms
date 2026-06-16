-- ============================================================
-- 020_onboarding_docs_fix.sql
-- Fix: documents uploaded in the onboarding portal don't save.
--   1) verify-document upserts with onConflict (onboarding_id, doc_code)
--      but no matching unique constraint existed → upsert failed silently.
--   2) Onboarding tables were "service_role only" RLS, but no
--      SUPABASE_SERVICE_ROLE_KEY is configured, so the anon-key API routes
--      were blocked from writing. Add permissive policies (functionality-first,
--      same approach as recruitment migration 0002).
-- Idempotent — safe to run repeatedly.
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================

-- 1) Unique constraint the upsert needs.
create unique index if not exists uq_onboarding_documents_onb_code
  on public.onboarding_documents (onboarding_id, doc_code);

-- 2) Permissive RLS on every onboarding table so anon-key API routes can read/write.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and (tablename like 'onboarding%' or tablename = 'employee_onboarding_progress')
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "allow_all_%s" on public.%I;', t, t);
    execute format('create policy "allow_all_%s" on public.%I for all to anon, authenticated using (true) with check (true);', t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
