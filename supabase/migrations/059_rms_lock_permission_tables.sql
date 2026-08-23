-- ============================================================================
-- EZER HRMS — LOCK THE TABLES THAT DECIDE PERMISSIONS
-- Migration 059  ·  OPTIONAL, AND A DELIBERATE CHOICE
-- ----------------------------------------------------------------------------
-- Migration 058 and the API routes give the application real authorization: a
-- route now refuses a module the caller's roles do not include, whether the
-- request comes from the sidebar or from curl.
--
-- That check reads ess_user_roles and role_permissions. Those two tables are
-- currently writable by the anon key — the key that ships to every browser —
-- because that is the pattern every table in this database uses:
--
--     FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)
--
-- So as things stand, an employee can open a browser console, POST themselves
-- a row in ess_user_roles, and pass every check the application makes. The
-- authorization is real; the data it trusts is not protected.
--
-- This file closes that. Reading stays open, because role names render in the
-- browser and there is nothing sensitive in them. Writing moves to
-- /api/rms/admin, which already resolves the caller from a signed token and
-- records who changed what and why.
--
-- ----------------------------------------------------------------------------
-- RUN THIS ONLY IF THE APPLICATION CODE IS DEPLOYED FIRST
--
-- The role assignment screens write these tables through the API route. An
-- older deployment writes them straight from the browser, and would start
-- failing with "new row violates row-level security policy" the moment this
-- runs. Deploy, then run this.
--
-- TO UNDO:
--     Re-create the permissive policy on each table:
--     create policy "allow_all_<table>" on <table>
--       for all to anon, authenticated using (true) with check (true);
-- ============================================================================

begin;

do $$
declare t text; p record;
begin
  foreach t in array array[
    'ess_roles','ess_user_roles','role_permissions','role_approval_rights',
    'employee_relationships','rms_config'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    -- Drop whatever policies exist by name rather than guessing what they were
    -- called: 021 and 028 used "allow_all_<table>", 058 used the same, and a
    -- hand-made one could be called anything.
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format(
      'create policy %I on %I for select to anon, authenticated using (true)',
      t || '_read', t);
  end loop;
end $$;


-- ============================================================================
-- VERIFICATION
-- Each table should show exactly one policy, and cmd should read SELECT.
-- Anything showing ALL is still writable from a browser.
-- ============================================================================

select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename in ('ess_roles','ess_user_roles','role_permissions',
                     'role_approval_rights','employee_relationships','rms_config')
 order by tablename;

commit;
