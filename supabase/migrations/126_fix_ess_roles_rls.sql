-- 126_fix_ess_roles_rls.sql
-- ===========================================================================
-- FIX: creating a custom role failed with
--   "new row violates row-level security policy for table ess_roles".
--
-- ess_roles has RLS on but no INSERT/ALL policy for the app's anon/authenticated
-- roles, so the client-side createRole() insert is blocked. Same fix pattern as
-- migration 113 (ess_user_roles). Idempotent. Safe to run twice.
-- ===========================================================================

alter table public.ess_roles enable row level security;
drop policy if exists "allow_all_ess_roles" on public.ess_roles;
create policy "allow_all_ess_roles" on public.ess_roles
  for all to anon, authenticated using (true) with check (true);
