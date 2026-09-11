-- ============================================================================
-- EZER HRMS — ROLE MANAGEMENT SYSTEM, ROLLED BACK
-- Migration 057 — undoes 055 and 056 completely
-- ----------------------------------------------------------------------------
-- Requested as a full rollback, security fixes included. Read this before
-- running it, because two of the things it undoes were not RMS features — they
-- were pre-existing holes that the RMS work happened to find.
--
-- AFTER THIS FILE RUNS, BOTH OF THESE ARE TRUE AGAIN:
--
--   1. Anyone holding the anon key — which ships to every browser — can WRITE
--      to ess_roles, ess_user_roles, role_permissions and role_approval_rights.
--      One POST from a console grants the sender SUPER_ADMIN.
--
--   2. ess_accounts answers the anon key with password_hash and password_salt
--      for all 269 accounts.
--
-- Neither is introduced by this file. Both are how the database stood on
-- 20 August 2026, and this returns it there.
--
-- WHAT IS LOST, AND CANNOT BE RECOVERED BY RE-RUNNING 055:
--   - the 480-row permission matrix
--   - 273 role assignments, including the ones assigned by hand after 055
--     (the single CFO assignment from 25 July is deliberately kept)
--   - valid_from / valid_to on every assignment
--
-- Safe to re-run. Nothing here depends on 055 still being in place.
-- ============================================================================

begin;

-- ============================================================================
-- SECTION 1 — TRIGGERS FIRST
-- The last-Super-Admin guard fires on DELETE, so it has to go before SECTION 3
-- tries to remove assignments, or it will refuse them.
-- ============================================================================

drop trigger if exists trg_ess_protect_last_super_admin on ess_user_roles;
drop function if exists ess_protect_last_super_admin();

drop trigger if exists trg_ess_provision_new_employee on employees;
drop function if exists ess_provision_new_employee();


-- ============================================================================
-- SECTION 2 — THE PERMISSION MATRIX
-- role_permissions held 0 rows before 055, so all of them go.
-- ============================================================================

delete from role_permissions;


-- ============================================================================
-- SECTION 3 — ROLE ASSIGNMENTS
-- One row existed before 055: a CFO assignment made on 25 July 2026. Everything
-- else was created by the migration's default-EMPLOYEE seed or assigned by hand
-- afterwards, and all of it goes.
-- ============================================================================

delete from ess_user_roles
 where assigned_at >= timestamptz '2026-08-21 00:00:00+00';


-- ============================================================================
-- SECTION 4 — EFFECTIVE DATING
-- ============================================================================

alter table ess_user_roles
  drop column if exists valid_from,
  drop column if exists valid_to;

drop index if exists idx_ess_user_roles_account;


-- ============================================================================
-- SECTION 5 — THE TWO ROLES 055 ADDED
-- ============================================================================

delete from ess_roles where role_code in ('INTERVIEWER','COMPLIANCE_AUDITOR');


-- ============================================================================
-- SECTION 6 — THE SEVEN RENAMES, PUT BACK
-- Same ids, original codes. The 43 rows in role_approval_rights point at the id
-- and are untouched either way.
-- ============================================================================

update ess_roles set role_code = 'ADMIN_SUPER',   role_name = 'Admin (Super)'              where role_code = 'SUPER_ADMIN';
update ess_roles set role_code = 'PAYROLL',       role_name = 'Payroll'                    where role_code = 'PAYROLL_MANAGER';
update ess_roles set role_code = 'BRANCH_HR',     role_name = 'Branch HR'                  where role_code = 'BRANCH_HR_EXECUTIVE';
update ess_roles set role_code = 'L1_MANAGER',    role_name = 'L1 Manager'                 where role_code = 'REPORTING_MANAGER_L1';
update ess_roles set role_code = 'L2_MANAGER',    role_name = 'L2 Manager'                 where role_code = 'SKIP_LEVEL_L2';
update ess_roles set role_code = 'IT',            role_name = 'IT'                         where role_code = 'IT_MANAGER';
update ess_roles set role_code = 'ADMIN_COMPANY', role_name = 'Admin (Company)'            where role_code = 'ADMIN_MANAGER';


-- ============================================================================
-- SECTION 7 — THE OLD VOCABULARY
-- The CHECK constraints have to be dropped before the values can move back, for
-- the same reason 055 had to drop them on the way out.
--
--   scope              SELF · TEAM · DEPT · BRANCH · ORG
--   salary_visibility  NONE · OWN · TEAM · DEPT · BRANCH · ALL
--
-- Values are restored per role from what each one held on 20 August, rather
-- than by a blanket mapping — GROUP covered both ORG-scoped and group-wide
-- roles, and only the role itself says which it was.
-- ============================================================================

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'ess_roles'::regclass and contype = 'c'
  loop
    execute format('alter table ess_roles drop constraint %I', c.conname);
  end loop;
end $$;

update ess_roles set scope = 'ORG',    salary_visibility = 'ALL'    where role_code in ('HR_MANAGER','HR_HEAD','CHRO','CFO','MD','PAYROLL','PAYROLL_ADMIN');
update ess_roles set scope = 'ORG',    salary_visibility = 'NONE'   where role_code in ('ADMIN_COMPANY','IMPL_MANAGER','IT','ADMIN_SUPER');
update ess_roles set scope = 'TEAM',   salary_visibility = 'NONE'   where role_code = 'RECRUITER';
update ess_roles set scope = 'TEAM',   salary_visibility = 'TEAM'   where role_code in ('L1_MANAGER','L2_MANAGER');
update ess_roles set scope = 'DEPT',   salary_visibility = 'DEPT'   where role_code = 'HOD';
update ess_roles set scope = 'BRANCH', salary_visibility = 'BRANCH' where role_code = 'BRANCH_HR';
update ess_roles set scope = 'BRANCH', salary_visibility = 'NONE'   where role_code = 'BRANCH_EXEC';
update ess_roles set scope = 'SELF',   salary_visibility = 'OWN'    where role_code = 'EMPLOYEE';

-- Anything the list missed is translated rather than left holding a word the
-- restored constraint would reject.
update ess_roles set scope = 'ORG'  where scope in ('COMPANY','GROUP');
update ess_roles set scope = 'DEPT' where scope = 'DEPARTMENT';
update ess_roles set salary_visibility = 'ALL'  where salary_visibility in ('GROUP','COMPANY');
update ess_roles set salary_visibility = 'DEPT' where salary_visibility = 'DEPARTMENT';
update ess_roles set salary_visibility = 'OWN'  where salary_visibility = 'SELF';

alter table ess_roles
  add constraint ess_roles_scope_check
  check (scope in ('SELF','TEAM','DEPT','BRANCH','ORG'));

alter table ess_roles
  add constraint ess_roles_salary_visibility_check
  check (salary_visibility in ('NONE','OWN','TEAM','DEPT','BRANCH','ALL'));


-- ============================================================================
-- SECTION 8 — THE LOCKS COME OFF
-- ----------------------------------------------------------------------------
-- *** THIS IS THE PART TO BE SURE ABOUT ***
--
-- Every table below goes back to  FOR ALL TO anon, authenticated
-- USING (true) WITH CHECK (true)  — the pattern 021 and 028 used, and the one
-- the rest of this database still uses.
--
-- In plain terms, once this runs: any employee can open a browser console and
-- POST themselves a SUPER_ADMIN row, edit the permission matrix, rewrite the
-- audit trail, or read every stored password hash and salt.
-- ============================================================================

drop view if exists ess_accounts_safe;

do $$
declare t text; p record;
begin
  foreach t in array array[
    'ess_roles','ess_user_roles','role_permissions','role_approval_rights',
    'ess_accounts','ess_impersonation_log','ess_access_audit'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
    execute format(
      'create policy %I on %I for all to anon, authenticated using (true) with check (true)',
      'allow_all_' || t, t);
  end loop;
end $$;


-- ============================================================================
-- SECTION 9 — THE ENFORCEMENT SWITCH
-- ============================================================================

drop table if exists rms_config;


-- ============================================================================
-- SECTION 10 — VERIFICATION
-- Read this output rather than trusting that no error appeared.
-- ============================================================================

-- (a) 18 roles, old codes, old vocabulary
select role_code, scope, salary_visibility from ess_roles order by sort_order;

-- (b) both should be gone
select (select count(*) from role_permissions) as permission_rows,
       (select count(*) from ess_user_roles)   as role_assignments;

-- (c) every table permissive again — expect one allow_all_* policy each,
--     cmd = ALL
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('ess_roles','ess_user_roles','role_permissions',
                     'role_approval_rights','ess_accounts',
                     'ess_impersonation_log','ess_access_audit')
 order by tablename;

-- (d) the triggers are gone
select count(*) as rms_triggers_left
  from pg_trigger
 where tgname in ('trg_ess_provision_new_employee','trg_ess_protect_last_super_admin');

-- (e) the columns are gone
select count(*) as dating_columns_left
  from information_schema.columns
 where table_name = 'ess_user_roles' and column_name in ('valid_from','valid_to');

commit;

-- ============================================================================
-- IF THIS TURNS OUT TO BE THE WRONG CALL
--   Re-running 055 rebuilds the roles, the vocabulary, the matrix, the columns,
--   the triggers and the locks. What it cannot rebuild is who held which role —
--   those 273 assignments are gone, and would have to be made again by hand.
-- ============================================================================
