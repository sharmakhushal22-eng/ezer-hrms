-- ============================================================================
-- EZER HRMS — ROLE MANAGEMENT SYSTEM
-- Migration 055
-- ----------------------------------------------------------------------------
-- The dashboard used to ask one question at the door: "is there a Supabase
-- session?" One shared login answered yes for everybody. This migration puts
-- the data behind the second question — who is this, and what may they touch.
--
-- WHY 055 AND NOT 052
--   052, 053 and 054 exist on the TusharPanwar branch and are already applied to
--   this database. A branch cut from main shows 051 as the highest file and
--   makes 052 look free. It is not.
--
-- WHAT THIS FILE DOES, IN ORDER
--   1   a switch that turns module enforcement on, without a deploy
--   2   widen the CHECK constraints before any value is rewritten
--   3   rename 7 role codes in place, so the 43 approval rights survive
--   4   one vocabulary for scope and salary visibility
--   5   two new roles -> 20 in total
--   6   effective dating on role assignment
--   7   the permission matrix, 24 modules x 20 roles
--   8   stop the anon key writing to the permission tables
--   9   stop the anon key reading password hashes
--   10  every new employee gets an account and a role, automatically
--   11  the last Super Admin cannot be removed
--   12  give every existing account the EMPLOYEE role
--   13  verification — read the output
--
-- Safe to re-run. Every step is guarded, and step 7 will not overwrite a
-- permission somebody has since edited by hand.
-- ============================================================================

begin;

-- ============================================================================
-- SECTION 1 — THE ENFORCEMENT SWITCH
-- Held in the database rather than an env var so it can be turned on the moment
-- the hand-assignment list is ready, and turned back off just as fast, without
-- a deploy. It starts OFF: the sidebar keeps showing everything until somebody
-- decides otherwise, so nobody is locked out on the morning this ships.
-- ============================================================================

create table if not exists rms_config (
  id                    boolean primary key default true check (id),   -- exactly one row
  enforce_module_access boolean not null default false,
  updated_at            timestamptz not null default now()
);

insert into rms_config (id, enforce_module_access) values (true, false)
on conflict (id) do nothing;

comment on table rms_config is
  'One row. enforce_module_access=false means the dashboard sidebar ignores '
  'role_permissions and shows everything, which is how the rollout stays safe '
  'while roles are still being assigned. Flip it to true once the real roles '
  'are in: update rms_config set enforce_module_access = true;';

-- Nobody but the service role reads or writes this. The app gets its value
-- through /api/rms/me, never straight from the browser.
alter table rms_config enable row level security;


-- ============================================================================
-- SECTION 2 — WIDEN THE CHECK CONSTRAINTS FIRST
-- ess_roles carries CHECK constraints from 021_ess.sql:
--     scope             in (SELF, TEAM, DEPT, BRANCH, ORG)
--     salary_visibility in (NONE, OWN, TEAM, DEPT, BRANCH, ALL)
-- None of GROUP, COMPANY or DEPARTMENT is allowed, so every UPDATE in SECTION 4
-- would fail if the constraints were left in place. They are found by looking
-- them up rather than by guessing the names Postgres generated.
-- ============================================================================

do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'ess_roles'::regclass
       and contype = 'c'
  loop
    execute format('alter table ess_roles drop constraint %I', c.conname);
  end loop;
end $$;


-- ============================================================================
-- SECTION 3 — RENAME SEVEN ROLES IN PLACE
-- Same id, new code. The 43 rows in role_approval_rights point at the id, so
-- they survive untouched and nothing has to be re-seeded.
--
-- Checked before writing this: the only role codes hardcoded anywhere in the
-- application are 'RECRUITER', 'EMPLOYEE' and 'HR_MANAGER', none of which are
-- renamed here.
-- ============================================================================

update ess_roles set role_code = 'SUPER_ADMIN',          role_name = 'Super Admin'                where role_code = 'ADMIN_SUPER';
update ess_roles set role_code = 'PAYROLL_MANAGER',      role_name = 'Payroll Manager'            where role_code = 'PAYROLL';
update ess_roles set role_code = 'BRANCH_HR_EXECUTIVE',  role_name = 'Branch HR Executive'        where role_code = 'BRANCH_HR';
update ess_roles set role_code = 'REPORTING_MANAGER_L1', role_name = 'Reporting Manager (L1)'     where role_code = 'L1_MANAGER';
update ess_roles set role_code = 'SKIP_LEVEL_L2',        role_name = 'Skip-Level Manager (L2)'    where role_code = 'L2_MANAGER';
update ess_roles set role_code = 'IT_MANAGER',           role_name = 'IT Manager'                 where role_code = 'IT';
update ess_roles set role_code = 'ADMIN_MANAGER',        role_name = 'Admin Manager'              where role_code = 'ADMIN_COMPANY';


-- ============================================================================
-- SECTION 4 — ONE VOCABULARY
-- scope and salary_visibility now use the same words, so "salary_visibility
-- defaults to scope" is literally true instead of something code reconciles at
-- read time. Values are set per role rather than mapped generically, because
-- the old ORG covered both group-wide and company-wide roles and only the role
-- itself says which it meant.
--
--     GROUP  >  COMPANY  >  BRANCH  >  DEPARTMENT  >  TEAM  >  SELF
--
-- Salary visibility follows scope except where a role's operational reach is
-- wider than its right to see pay — IT, Admin, Recruiters, Implementation,
-- Branch Ops, Compliance and Interviewers see no salary at all.
-- ============================================================================

update ess_roles set scope = 'GROUP',      salary_visibility = 'GROUP'      where role_code in ('SUPER_ADMIN','CHRO','CFO','MD');
update ess_roles set scope = 'COMPANY',    salary_visibility = 'COMPANY'    where role_code in ('HR_HEAD','HR_MANAGER','PAYROLL_MANAGER','PAYROLL_ADMIN');
update ess_roles set scope = 'COMPANY',    salary_visibility = 'NONE'       where role_code in ('ADMIN_MANAGER','IT_MANAGER','IMPL_MANAGER');
update ess_roles set scope = 'BRANCH',     salary_visibility = 'BRANCH'     where role_code = 'BRANCH_HR_EXECUTIVE';
update ess_roles set scope = 'BRANCH',     salary_visibility = 'NONE'       where role_code = 'BRANCH_EXEC';
update ess_roles set scope = 'DEPARTMENT', salary_visibility = 'DEPARTMENT' where role_code = 'HOD';
update ess_roles set scope = 'TEAM',       salary_visibility = 'TEAM'       where role_code in ('REPORTING_MANAGER_L1','SKIP_LEVEL_L2');
update ess_roles set scope = 'TEAM',       salary_visibility = 'NONE'       where role_code = 'RECRUITER';
update ess_roles set scope = 'SELF',       salary_visibility = 'SELF'       where role_code = 'EMPLOYEE';

-- Anything the list above missed — a role added by hand, say — is translated
-- rather than left holding a word the new constraint would reject.
update ess_roles set scope = 'COMPANY'    where scope = 'ORG';
update ess_roles set scope = 'DEPARTMENT' where scope = 'DEPT';
update ess_roles set salary_visibility = 'GROUP'      where salary_visibility = 'ALL';
update ess_roles set salary_visibility = 'SELF'       where salary_visibility = 'OWN';
update ess_roles set salary_visibility = 'DEPARTMENT' where salary_visibility = 'DEPT';

alter table ess_roles
  add constraint ess_roles_scope_check
  check (scope in ('GROUP','COMPANY','BRANCH','DEPARTMENT','TEAM','SELF'));

alter table ess_roles
  add constraint ess_roles_salary_visibility_check
  check (salary_visibility in ('GROUP','COMPANY','BRANCH','DEPARTMENT','TEAM','SELF','NONE'));


-- ============================================================================
-- SECTION 5 — TWO NEW ROLES
-- FINANCE_EXECUTIVE is deliberately NOT added: finance_team already carries
-- approval_limit and can_disburse per person, and a role cannot express "two
-- people, same title, different limits". HRBP is deferred until a single
-- company passes ~500 employees.
-- ============================================================================

insert into ess_roles (role_code, role_name, scope, salary_visibility, sort_order) values
  ('INTERVIEWER',        'Interviewer',        'SELF',    'NONE', 21),
  ('COMPLIANCE_AUDITOR', 'Compliance Officer', 'COMPANY', 'NONE', 22)
on conflict (role_code) do nothing;


-- ============================================================================
-- SECTION 6 — EFFECTIVE DATING
-- ess_user_roles recorded what is true today and overwrote what was true
-- before, so "who could approve that MRF in March?" had no answer. Two columns
-- fix that, and they have to go in now: adding them to a nearly empty table is
-- trivial, while reconstructing when hundreds of assignments became true is
-- not possible later.
--
-- The UI does not show a date picker yet. Every assignment is simply effective
-- from the day it is made; the schema is ready for the day that changes.
-- ============================================================================

alter table ess_user_roles
  add column if not exists valid_from date not null default current_date,
  add column if not exists valid_to   date;

comment on column ess_user_roles.valid_to is
  'Null means open-ended. A withdrawn role is closed with valid_to and '
  'is_active=false rather than deleted, so the record of having held it stays.';

create index if not exists idx_ess_user_roles_account on ess_user_roles (ess_account_id) where is_active;


-- ============================================================================
-- SECTION 7 — THE PERMISSION MATRIX
-- 24 modules x 20 roles. Named after what a person sees in the sidebar, not
-- after a table, because these strings are shown to HR.
--
-- Two rules were followed while drafting, and they are worth stating because
-- the values below are a starting point HR is expected to correct:
--
--   1. The narrowest access that lets the role do its stated job. Where it was
--      genuinely unclear, NONE or VIEW — never EDIT or FULL.
--   2. Approving is not administering. A CFO signing off an MRF needs VIEW on
--      Recruitment, not FULL: the Approve button comes from
--      role_approval_rights, which is a separate table on purpose.
--
-- ON CONFLICT DO NOTHING, so re-running this file never overwrites an edit
-- somebody made from the Roles & Permissions screen.
-- ============================================================================

with mods(module) as (values
  ('Employees'), ('Recruitment'), ('Onboarding'), ('Attendance'),
  ('Attendance Reports'), ('Leave Config'), ('Holidays'), ('Payroll'),
  ('Finance'), ('Flexi Claims'), ('Travel Claims'), ('Loans'),
  ('Compliance'), ('HR Letters'), ('Policies'), ('Admin Setup'),
  ('Company Profile'), ('Reports'), ('Database Export'), ('Transfer'),
  ('Bulk Upload'), ('ESS & Roles'), ('Support'), ('Ezer AI')
),
grants(role_code, module, access_level) as (values
  -- ── Super Admin: everything. Also floored to FULL in code, so an empty or
  --    broken matrix can never lock the last administrator out.
  ('SUPER_ADMIN','*','FULL'),

  -- ── CHRO — group HR authority. Sees pay, does not run payroll.
  ('CHRO','Employees','FULL'), ('CHRO','Recruitment','FULL'), ('CHRO','Onboarding','FULL'),
  ('CHRO','Attendance','FULL'), ('CHRO','Attendance Reports','FULL'), ('CHRO','Leave Config','FULL'),
  ('CHRO','Holidays','FULL'), ('CHRO','HR Letters','FULL'), ('CHRO','Policies','FULL'),
  ('CHRO','Transfer','FULL'), ('CHRO','Reports','EDIT'), ('CHRO','ESS & Roles','EDIT'),
  ('CHRO','Payroll','VIEW'), ('CHRO','Compliance','VIEW'), ('CHRO','Flexi Claims','VIEW'),
  ('CHRO','Travel Claims','VIEW'), ('CHRO','Loans','VIEW'), ('CHRO','Finance','VIEW'),
  ('CHRO','Company Profile','VIEW'), ('CHRO','Bulk Upload','EDIT'), ('CHRO','Support','VIEW'),

  -- ── CFO — money, and only enough of the rest to judge it.
  ('CFO','Finance','FULL'), ('CFO','Payroll','VIEW'), ('CFO','Compliance','VIEW'),
  ('CFO','Flexi Claims','VIEW'), ('CFO','Travel Claims','VIEW'), ('CFO','Loans','VIEW'),
  ('CFO','Reports','VIEW'), ('CFO','Employees','VIEW'), ('CFO','Recruitment','VIEW'),
  ('CFO','Company Profile','VIEW'),

  -- ── MD — top of the chain. Reads everything, edits nothing; the authority
  --    is in the approval rights, not in the screens.
  ('MD','Employees','VIEW'), ('MD','Recruitment','VIEW'), ('MD','Payroll','VIEW'),
  ('MD','Finance','VIEW'), ('MD','Reports','VIEW'), ('MD','Compliance','VIEW'),
  ('MD','Attendance Reports','VIEW'), ('MD','Company Profile','VIEW'),
  ('MD','Travel Claims','VIEW'), ('MD','Loans','VIEW'),

  -- ── HR Head — runs HR for a company. No payroll.
  ('HR_HEAD','Employees','FULL'), ('HR_HEAD','Recruitment','FULL'), ('HR_HEAD','Onboarding','FULL'),
  ('HR_HEAD','Attendance','FULL'), ('HR_HEAD','Attendance Reports','FULL'),
  ('HR_HEAD','Leave Config','FULL'), ('HR_HEAD','Holidays','FULL'), ('HR_HEAD','HR Letters','FULL'),
  ('HR_HEAD','Policies','FULL'), ('HR_HEAD','Transfer','FULL'), ('HR_HEAD','Bulk Upload','EDIT'),
  ('HR_HEAD','ESS & Roles','FULL'), ('HR_HEAD','Reports','EDIT'), ('HR_HEAD','Company Profile','VIEW'),
  ('HR_HEAD','Travel Claims','VIEW'), ('HR_HEAD','Support','EDIT'),

  -- ── HR Manager — the same work, one notch down, and no role administration.
  ('HR_MANAGER','Employees','EDIT'), ('HR_MANAGER','Recruitment','EDIT'), ('HR_MANAGER','Onboarding','FULL'),
  ('HR_MANAGER','Attendance','EDIT'), ('HR_MANAGER','Attendance Reports','VIEW'),
  ('HR_MANAGER','Leave Config','EDIT'), ('HR_MANAGER','Holidays','EDIT'), ('HR_MANAGER','HR Letters','EDIT'),
  ('HR_MANAGER','Policies','VIEW'), ('HR_MANAGER','Transfer','EDIT'), ('HR_MANAGER','Bulk Upload','EDIT'),
  ('HR_MANAGER','Reports','VIEW'), ('HR_MANAGER','Support','EDIT'), ('HR_MANAGER','Travel Claims','VIEW'),

  -- ── Payroll Manager — runs the monthly cycle.
  ('PAYROLL_MANAGER','Payroll','FULL'), ('PAYROLL_MANAGER','Flexi Claims','FULL'),
  ('PAYROLL_MANAGER','Loans','FULL'), ('PAYROLL_MANAGER','Compliance','FULL'),
  ('PAYROLL_MANAGER','Reports','EDIT'), ('PAYROLL_MANAGER','Database Export','EDIT'),
  ('PAYROLL_MANAGER','Employees','VIEW'), ('PAYROLL_MANAGER','Attendance','VIEW'),
  ('PAYROLL_MANAGER','Attendance Reports','VIEW'), ('PAYROLL_MANAGER','Travel Claims','VIEW'),
  ('PAYROLL_MANAGER','Finance','VIEW'), ('PAYROLL_MANAGER','Leave Config','VIEW'),

  -- ── Payroll Admin — configures payroll. A different job from running it.
  ('PAYROLL_ADMIN','Payroll','FULL'), ('PAYROLL_ADMIN','Admin Setup','FULL'),
  ('PAYROLL_ADMIN','Compliance','FULL'), ('PAYROLL_ADMIN','Leave Config','FULL'),
  ('PAYROLL_ADMIN','Holidays','FULL'), ('PAYROLL_ADMIN','Flexi Claims','EDIT'),
  ('PAYROLL_ADMIN','Company Profile','EDIT'), ('PAYROLL_ADMIN','Employees','VIEW'),
  ('PAYROLL_ADMIN','Reports','VIEW'),

  -- ── Admin Manager — facilities and company setup. Never sees pay.
  ('ADMIN_MANAGER','Admin Setup','FULL'), ('ADMIN_MANAGER','Company Profile','FULL'),
  ('ADMIN_MANAGER','Policies','EDIT'), ('ADMIN_MANAGER','Support','FULL'),
  ('ADMIN_MANAGER','Holidays','EDIT'), ('ADMIN_MANAGER','Employees','VIEW'),
  ('ADMIN_MANAGER','Onboarding','VIEW'),

  -- ── IT Manager — accounts and access, not people data.
  ('IT_MANAGER','Admin Setup','EDIT'), ('IT_MANAGER','Support','FULL'),
  ('IT_MANAGER','ESS & Roles','VIEW'), ('IT_MANAGER','Employees','VIEW'),
  ('IT_MANAGER','Onboarding','VIEW'), ('IT_MANAGER','Database Export','VIEW'),

  -- ── Implementation Manager — EZER's own support staff looking into a client.
  ('IMPL_MANAGER','Employees','VIEW'), ('IMPL_MANAGER','Onboarding','VIEW'),
  ('IMPL_MANAGER','Admin Setup','VIEW'), ('IMPL_MANAGER','Company Profile','VIEW'),
  ('IMPL_MANAGER','Attendance','VIEW'), ('IMPL_MANAGER','Reports','VIEW'),
  ('IMPL_MANAGER','Support','FULL'), ('IMPL_MANAGER','Ezer AI','VIEW'),

  -- ── Recruiter — hiring, and the hand-off into onboarding.
  ('RECRUITER','Recruitment','FULL'), ('RECRUITER','Onboarding','EDIT'),
  ('RECRUITER','Employees','VIEW'), ('RECRUITER','Ezer AI','VIEW'),

  -- ── Interviewer — nothing here on purpose. Interview feedback lives inside
  --    the recruitment screen today, and handing an interviewer the whole
  --    pipeline to reach their own form is real over-exposure. A "My
  --    Interviews" section in ESS is the tracked follow-up.

  -- ── Compliance Officer — reads, never writes. Relevant to SOC 1.
  ('COMPLIANCE_AUDITOR','Employees','VIEW'), ('COMPLIANCE_AUDITOR','Payroll','VIEW'),
  ('COMPLIANCE_AUDITOR','Compliance','VIEW'), ('COMPLIANCE_AUDITOR','Reports','VIEW'),
  ('COMPLIANCE_AUDITOR','Attendance Reports','VIEW'), ('COMPLIANCE_AUDITOR','Policies','VIEW'),
  ('COMPLIANCE_AUDITOR','HR Letters','VIEW'), ('COMPLIANCE_AUDITOR','ESS & Roles','VIEW'),
  ('COMPLIANCE_AUDITOR','Finance','VIEW'), ('COMPLIANCE_AUDITOR','Loans','VIEW'),

  -- ── Branch HR Executive — HR work for one branch.
  ('BRANCH_HR_EXECUTIVE','Employees','EDIT'), ('BRANCH_HR_EXECUTIVE','Attendance','EDIT'),
  ('BRANCH_HR_EXECUTIVE','Attendance Reports','VIEW'), ('BRANCH_HR_EXECUTIVE','Onboarding','EDIT'),
  ('BRANCH_HR_EXECUTIVE','HR Letters','EDIT'), ('BRANCH_HR_EXECUTIVE','Recruitment','VIEW'),
  ('BRANCH_HR_EXECUTIVE','Leave Config','VIEW'), ('BRANCH_HR_EXECUTIVE','Holidays','VIEW'),
  ('BRANCH_HR_EXECUTIVE','Support','EDIT'),

  -- ── Branch Executive — branch operations, not HR.
  ('BRANCH_EXEC','Attendance','VIEW'), ('BRANCH_EXEC','Attendance Reports','VIEW'),
  ('BRANCH_EXEC','Employees','VIEW'), ('BRANCH_EXEC','Holidays','VIEW'),

  -- ── Reporting Manager (L1) and Skip-Level (L2) — their team, read-only.
  --    Whose team is scope, and scope is not enforced yet: see Phase 2.
  ('REPORTING_MANAGER_L1','Attendance','VIEW'), ('REPORTING_MANAGER_L1','Attendance Reports','VIEW'),
  ('REPORTING_MANAGER_L1','Employees','VIEW'), ('REPORTING_MANAGER_L1','Travel Claims','VIEW'),
  ('SKIP_LEVEL_L2','Attendance','VIEW'), ('SKIP_LEVEL_L2','Attendance Reports','VIEW'),
  ('SKIP_LEVEL_L2','Employees','VIEW'), ('SKIP_LEVEL_L2','Travel Claims','VIEW'),

  -- ── Head of Department.
  ('HOD','Employees','VIEW'), ('HOD','Attendance','VIEW'), ('HOD','Attendance Reports','VIEW'),
  ('HOD','Recruitment','VIEW'), ('HOD','Reports','VIEW'), ('HOD','Travel Claims','VIEW')

  -- ── Employee — nothing. The ESS portal is not gated by these modules.
)
insert into role_permissions (role_id, module, access_level)
select r.id,
       m.module,
       coalesce(
         (select g.access_level from grants g
           where g.role_code = r.role_code and g.module = m.module),
         (select g.access_level from grants g
           where g.role_code = r.role_code and g.module = '*'),
         'NONE')
  from ess_roles r
 cross join mods m
on conflict (role_id, module) do nothing;


-- ============================================================================
-- SECTION 8 — THE PERMISSION TABLES STOP BEING WORLD-WRITABLE
-- 028_role_permissions.sql granted anon FOR ALL ... USING (true) WITH CHECK
-- (true). FOR ALL covers INSERT and UPDATE, and the anon key ships to every
-- browser — so any employee could grant themselves SUPER_ADMIN from a console.
--
-- Reading stays open, because role names render in the browser and there is
-- nothing sensitive in them. Writing now goes through /api/rms/admin, which
-- uses the service key and checks the caller first.
-- ============================================================================

do $$
declare t text; p record;
begin
  foreach t in array array['ess_roles','ess_user_roles','role_permissions','role_approval_rights']
  loop
    execute format('alter table %I enable row level security', t);
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
-- SECTION 9 — PASSWORD HASHES LEAVE THE BROWSER'S REACH
-- ess_accounts was anon-readable, hashes and salts included, and
-- lib/supabase-ess.ts was pulling them client-side with select('*').
--
-- The table closes completely — only the service role, which bypasses RLS, can
-- reach it. The browser gets a view with the two password columns removed, plus
-- a has_password flag, because the credentials screen counts on it.
-- ============================================================================

create or replace view ess_accounts_safe as
  select id, employee_id, auth_user_id, status,
         must_change_password, password_reset_allowed,
         first_login_at, last_login_at, login_count,
         deactivated_at, deactivated_by, deactivation_reason,
         created_at, updated_at,
         (password_hash is not null) as has_password
    from ess_accounts;

comment on view ess_accounts_safe is
  'ess_accounts without password_hash or password_salt. Everything in the '
  'browser reads this; the table itself is service-role only.';

alter table ess_accounts enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'ess_accounts'
  loop
    execute format('drop policy %I on ess_accounts', p.policyname);
  end loop;
end $$;
-- No policy remains on purpose: with RLS enabled and nothing granted, anon and
-- authenticated see nothing at all.

grant select on ess_accounts_safe to anon, authenticated;


-- ============================================================================
-- SECTION 10 — EVERY NEW EMPLOYEE GETS AN ACCOUNT AND A ROLE
-- Nothing in the application creates an ess_account when an employee is added.
-- So a one-time seed makes 398 of 398 correct on the day it runs and then
-- decays: everyone hired afterwards has no account, cannot sign in, and never
-- shows up in the role system for anyone to notice.
--
-- The account is created INACTIVE and without a password. Nobody can sign in
-- with it until HR issues credentials from /dashboard/ess-credentials; it
-- exists only so a role has something to hang off.
-- ============================================================================

create or replace function ess_provision_new_employee()
returns trigger
language plpgsql
as $$
declare
  v_acct uuid;
  v_role uuid;
begin
  if coalesce(new.is_test, false) then
    return new;
  end if;

  insert into ess_accounts (employee_id, status)
  values (new.id, 'INACTIVE')
  on conflict (employee_id) do nothing
  returning id into v_acct;

  if v_acct is null then
    select id into v_acct from ess_accounts where employee_id = new.id;
  end if;

  select id into v_role from ess_roles where role_code = 'EMPLOYEE';

  if v_acct is not null and v_role is not null then
    insert into ess_user_roles (ess_account_id, role_id, valid_from)
    values (v_acct, v_role, current_date)
    on conflict (ess_account_id, role_id) do nothing;
  end if;

  return new;

exception when others then
  -- Provisioning must never be the reason an employee cannot be created. A bulk
  -- upload of 400 rows failing because of one role row would be a far worse bug
  -- than one employee briefly missing an account.
  raise warning 'ess_provision_new_employee failed for %: %', new.id, sqlerrm;
  return new;
end $$;

drop trigger if exists trg_ess_provision_new_employee on employees;
create trigger trg_ess_provision_new_employee
  after insert on employees
  for each row execute function ess_provision_new_employee();


-- ============================================================================
-- SECTION 11 — THE LAST SUPER ADMIN CANNOT BE REMOVED
-- One bad edit should not be able to leave nobody holding the role that can
-- repair the permission matrix. The API refuses it too, with a readable
-- message; this is the floor underneath that, for anything reaching the table
-- another way.
-- ============================================================================

create or replace function ess_protect_last_super_admin()
returns trigger
language plpgsql
as $$
declare
  v_super  uuid;
  v_left   int;
  v_row_id uuid;
begin
  -- NEW is unassigned in a DELETE trigger and OLD is unassigned in an INSERT one,
  -- so every reference below is inside the branch where that record exists.
  -- Reaching for the wrong one raises "record is not assigned yet" at runtime,
  -- which plpgsql does not catch at creation time.
  select id into v_super from ess_roles where role_code = 'SUPER_ADMIN';
  if v_super is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Only a change that takes SUPER_ADMIN away from somebody is of interest.
  if tg_op = 'DELETE' then
    if old.role_id <> v_super then return old; end if;
    if not coalesce(old.is_active, true) then return old; end if;
    v_row_id := old.id;
  else
    if new.role_id <> v_super then return new; end if;
    if coalesce(new.is_active, true) then return new; end if;      -- still held
    if not coalesce(old.is_active, true) then return new; end if;  -- already withdrawn
    v_row_id := new.id;
  end if;

  select count(*) into v_left
    from ess_user_roles
   where role_id = v_super
     and is_active
     and id <> v_row_id;

  if v_left = 0 then
    raise exception 'This is the only Super Admin — assign another one before removing this one.';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists trg_ess_protect_last_super_admin on ess_user_roles;
create trigger trg_ess_protect_last_super_admin
  before update or delete on ess_user_roles
  for each row execute function ess_protect_last_super_admin();


-- ============================================================================
-- SECTION 12 — EVERY EXISTING ACCOUNT GETS THE EMPLOYEE ROLE
-- The baseline. Anything above EMPLOYEE is a deliberate act by a person, which
-- is correct for HR, Payroll, Admin and Super Admin.
--
-- This does NOT create the missing accounts. Do that first, from
-- /dashboard/ess-credentials -> Generate for all — 129 employees have no
-- account, and a role cannot be attached to an account that does not exist.
-- ============================================================================

insert into ess_user_roles (ess_account_id, role_id, valid_from, is_active)
select a.id, r.id, current_date, true
  from ess_accounts a
 cross join ess_roles r
 where r.role_code = 'EMPLOYEE'
   and not exists (
     select 1 from ess_user_roles ur
      where ur.ess_account_id = a.id and ur.role_id = r.id)
on conflict (ess_account_id, role_id) do nothing;


-- ============================================================================
-- SECTION 13 — VERIFICATION
-- Read this output rather than trusting that no error appeared.
-- ============================================================================

-- (a) the 20 roles, with the vocabulary they now use
select role_code, role_name, scope, salary_visibility, sort_order
  from ess_roles
 order by sort_order, role_code;

-- (b) how wide each role is. Expect 24 rows per role, most of them NONE.
select r.role_code,
       count(*) filter (where p.access_level = 'FULL') as full_access,
       count(*) filter (where p.access_level = 'EDIT') as edit,
       count(*) filter (where p.access_level = 'VIEW') as view_only,
       count(*) filter (where p.access_level = 'NONE') as none,
       count(*)                                        as modules
  from ess_roles r
  left join role_permissions p on p.role_id = r.id
 group by r.role_code
 order by full_access desc, edit desc, r.role_code;

-- (c) approval rights survived the renames. Expect 43.
select count(*) as approval_rights_still_attached
  from role_approval_rights ar
  join ess_roles r on r.id = ar.role_id;

-- (d) who holds what. Right after this migration everyone should be EMPLOYEE
--     and nothing else, and accounts_without_role should be 0.
select r.role_code, count(*) as people
  from ess_user_roles ur
  join ess_roles r on r.id = ur.role_id
 where ur.is_active
 group by r.role_code
 order by people desc;

select count(*) as accounts_without_role
  from ess_accounts a
 where not exists (select 1 from ess_user_roles ur where ur.ess_account_id = a.id and ur.is_active);

-- (e) THE ONE TO ACT ON. Employees with no ESS account cannot sign in and
--     cannot hold a role. Expect 129 until credentials are generated for all.
select count(*) as employees_with_no_account
  from employees e
 where coalesce(e.is_test, false) = false
   and not exists (select 1 from ess_accounts a where a.employee_id = e.id);

-- (f) enforcement is still off, which is correct until the real roles are in.
select enforce_module_access from rms_config;

commit;

-- ============================================================================
-- AFTER THIS FILE
--   1. /dashboard/ess-credentials -> Generate for all, to create the 129
--      missing accounts. Re-run SECTION 12 afterwards so they get EMPLOYEE.
--   2. Assign the real roles to the ~20-30 people who need more than EMPLOYEE.
--   3. Only then:  update rms_config set enforce_module_access = true;
--      Until that line runs the sidebar shows everything, exactly as before.
--
-- TO UNDO THE ENFORCEMENT (no migration needed):
--      update rms_config set enforce_module_access = false;
-- ============================================================================
