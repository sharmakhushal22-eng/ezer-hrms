-- =====================================================================
-- 100_close_profile_view.sql — the profile view is readable by anyone
--
-- FOR: Nayan Ahuja. A grant change. No schema change, no data change.
--
-- WHAT I FOUND, while building the Profile UI on top of it
--
-- All twelve tables 091 creates are properly locked: they answer
-- 42501 "permission denied for table" to the publishable key. Good.
--
-- v_employee_profile_360 is not. With the publishable key that ships in
-- every browser, an unauthenticated caller can read, for 398 employees:
--
--     pan, ifsc, bank_name, bank_last4, uan, date_of_birth,
--     personal_email, mobile, annual_ctc, gross_monthly
--
-- and the view also carries passport_no, aadhar_last4, pf_number,
-- esic_ip_number, driving_licence, voter_id, present_address,
-- permanent_address, emergency contacts, father/mother/spouse names.
--
-- This is worse than any single table, because joining it all into one row
-- is exactly what the view is for. A Postgres view runs with its OWNER's
-- privileges unless it is declared security_invoker, so RLS on the
-- underlying tables does not apply to it.
--
-- get_employee_profile() already strips these per viewer role, exactly as
-- designed. The view simply sits beside it, ungated, and can be queried
-- directly — which bypasses the masking entirely.
--
-- THE FIX
--
-- Revoke the view from anon and authenticated. Nothing legitimate breaks:
-- get_employee_profile is SECURITY DEFINER, so it keeps reading the view on
-- the caller's behalf, and that function is how the application reads
-- profiles. Reaching the view directly was never part of the design.
--
-- SAFE TO RUN TWICE.
-- =====================================================================

revoke all on v_employee_profile_360 from anon, authenticated;

-- Belt and braces: the underlying tables are already locked, but the view
-- should also stop bypassing their RLS if anyone ever grants it again.
-- security_invoker makes the view run as the CALLER, so the tables' own
-- policies apply rather than the owner's rights.
do $$
begin
  execute 'alter view v_employee_profile_360 set (security_invoker = true)';
exception when others then
  -- Postgres 14 and below have no security_invoker. The revoke above is the
  -- part that matters; this is a defence in depth, not the fix.
  raise notice 'security_invoker not supported on this server — revoke still applied';
end $$;

-- Confirm. Expect no anon/authenticated entries in relacl.
select c.relname,
       coalesce(array_to_string(c.relacl, E'\n'), '(default: owner only)') as grants
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'v_employee_profile_360';
