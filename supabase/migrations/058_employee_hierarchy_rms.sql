-- ============================================================================
-- EZER HRMS — EMPLOYEE HIERARCHY AND FUNCTIONAL ROLES
-- Migration 058
-- ----------------------------------------------------------------------------
-- Two things this database could not answer, and now can:
--
--   Who does this person report to, two levels up?
--       employees carried l1_manager_id and l2_manager_id. l1 was filled for 28
--       of 398 people and l2 for none, and there was nowhere to put a third
--       level or a head of department at all.
--
--   What is this person allowed to open?
--       role_permissions existed and held zero rows, so every module was
--       visible to everybody who could reach the dashboard.
--
-- The org-chart workbook answers both, and they are kept apart on purpose:
-- managing people is not a permission, and holding Payroll does not make
-- somebody a manager. They live in different tables and meet nowhere.
--
-- WHAT THIS DOES
--   1   employee_relationships — the reporting structure, as relationships
--   2   a cycle guard, so bad data cannot produce a query that never returns
--   3   a mirror into employees.l1_manager_id / l2_manager_id, because the
--       travel approval chain reads those columns eleven times
--   4   backfill: the 28 existing l1_manager_id values become relationships
--   5   read helpers — chain, direct reports, whole tree
--   6   FINANCE_EXECUTIVE, the one role in the workbook the app did not have
--   7   the permission matrix, seeded narrow
--   8   an enforcement switch, off, so nobody is locked out on the day it ships
--
-- Safe to re-run. Nothing here deletes an employee or a permission somebody
-- edited by hand.
-- ============================================================================

begin;

-- ============================================================================
-- SECTION 1 — THE REPORTING STRUCTURE
-- One row per (employee, level). The level is data rather than a column name,
-- so a third or fourth rung needs a row, not a migration — and "who reports to
-- me" becomes an index lookup instead of a scan of three nullable columns.
-- ============================================================================

create table if not exists employee_relationships (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees(id) on delete cascade,
  manager_employee_id uuid not null references employees(id) on delete cascade,
  relationship_type   text not null
                        check (relationship_type in ('L1','L2','L3','L4','HOD')),
  -- Where this came from, so a hand-made correction is not silently replaced by
  -- the next import.
  source              text not null default 'IMPORT'
                        check (source in ('IMPORT','MANUAL','LEGACY')),
  valid_from          date not null default current_date,
  valid_to            date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Nobody manages themselves. The workbook writes a person's own code in their
  -- L1/L2/HOD columns to mean "nobody above me"; the importer turns that into no
  -- row at all, and this makes sure nothing else can get it wrong.
  constraint employee_relationships_not_self check (employee_id <> manager_employee_id)
);

-- One live row per employee per level. This is what makes the import idempotent:
-- running it twice updates the same row instead of stacking a second manager.
create unique index if not exists uq_employee_relationship_live
  on employee_relationships (employee_id, relationship_type)
  where valid_to is null;

create index if not exists idx_employee_rel_manager on employee_relationships (manager_employee_id) where valid_to is null;
create index if not exists idx_employee_rel_employee on employee_relationships (employee_id) where valid_to is null;

comment on table employee_relationships is
  'Who reports to whom, one row per level. Separate from role_permissions on '
  'purpose: being an L1 manager grants no module access, and module access '
  'makes nobody a manager.';
comment on column employee_relationships.valid_to is
  'Null means current. A relationship that ends is closed with a date rather '
  'than deleted, so "who could approve this in March" stays answerable.';

-- House RLS pattern.
alter table employee_relationships enable row level security;
drop policy if exists "allow_all_employee_relationships" on employee_relationships;
create policy "allow_all_employee_relationships" on employee_relationships
  for all to anon, authenticated using (true) with check (true);


-- ============================================================================
-- SECTION 2 — NO CYCLES
-- A loop in the reporting chain turns "walk up to the top" into a query that
-- never returns. The importer checks the workbook before writing; this checks
-- the database, so a correction made anywhere else is checked too.
-- ============================================================================

create or replace function employee_relationship_no_cycle()
returns trigger
language plpgsql
as $$
declare
  v_cur   uuid;
  v_depth int := 0;
begin
  if new.employee_id = new.manager_employee_id then
    raise exception 'An employee cannot be their own % manager.', new.relationship_type;
  end if;

  -- Walk upward from the proposed manager along the same level. Reaching the
  -- employee means the edge would close a loop.
  v_cur := new.manager_employee_id;
  while v_cur is not null and v_depth < 64 loop
    if v_cur = new.employee_id then
      raise exception 'Making % report to % would create a circular % chain.',
        new.employee_id, new.manager_employee_id, new.relationship_type;
    end if;
    select r.manager_employee_id into v_cur
      from employee_relationships r
     where r.employee_id = v_cur
       and r.relationship_type = new.relationship_type
       and r.valid_to is null
     limit 1;
    v_depth := v_depth + 1;
  end loop;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_employee_relationship_no_cycle on employee_relationships;
create trigger trg_employee_relationship_no_cycle
  before insert or update on employee_relationships
  for each row execute function employee_relationship_no_cycle();


-- ============================================================================
-- SECTION 3 — MIRROR INTO THE COLUMNS THE REST OF THE APP ALREADY READS
-- employees.l1_manager_id is read eleven times by travel_claim_approver
-- (migration 054) and decides who approves a travel claim. Moving the hierarchy
-- into its own table without keeping those columns fed would silently break the
-- travel chain for everybody.
--
-- So the table is the source of truth and the columns are a mirror of it.
-- ============================================================================

create or replace function employee_relationship_mirror()
returns trigger
language plpgsql
as $$
declare
  v_emp  uuid;
  v_type text;
begin
  -- NEW is unassigned in a DELETE trigger and OLD in an INSERT one, so each is
  -- only read inside the branch where it exists.
  if tg_op = 'DELETE' then
    v_emp := old.employee_id; v_type := old.relationship_type;
  else
    v_emp := new.employee_id; v_type := new.relationship_type;
  end if;

  if v_type = 'L1' then
    update employees e
       set l1_manager_id = (
             select r.manager_employee_id from employee_relationships r
              where r.employee_id = v_emp and r.relationship_type = 'L1' and r.valid_to is null
              limit 1)
     where e.id = v_emp;
  elsif v_type = 'L2' then
    update employees e
       set l2_manager_id = (
             select r.manager_employee_id from employee_relationships r
              where r.employee_id = v_emp and r.relationship_type = 'L2' and r.valid_to is null
              limit 1)
     where e.id = v_emp;
  end if;

  return null;

exception when others then
  -- A mirror that fails must not take the relationship with it. The table stays
  -- correct and the warning says the column drifted.
  raise warning 'employee_relationship_mirror failed for % (%): %', v_emp, v_type, sqlerrm;
  return null;
end $$;

drop trigger if exists trg_employee_relationship_mirror on employee_relationships;
create trigger trg_employee_relationship_mirror
  after insert or update or delete on employee_relationships
  for each row execute function employee_relationship_mirror();


-- ============================================================================
-- SECTION 4 — BRING THE EXISTING DATA IN
-- 28 employees already carry an l1_manager_id, set by migration 052's backfill
-- from the reporting_manager text column. They become relationships marked
-- LEGACY so it is clear where they came from, and the import will overwrite
-- them from the workbook where the two disagree.
-- ============================================================================

insert into employee_relationships (employee_id, manager_employee_id, relationship_type, source, valid_from)
select e.id, e.l1_manager_id, 'L1', 'LEGACY', current_date
  from employees e
 where e.l1_manager_id is not null
   and e.l1_manager_id <> e.id
on conflict do nothing;

insert into employee_relationships (employee_id, manager_employee_id, relationship_type, source, valid_from)
select e.id, e.l2_manager_id, 'L2', 'LEGACY', current_date
  from employees e
 where e.l2_manager_id is not null
   and e.l2_manager_id <> e.id
on conflict do nothing;


-- ============================================================================
-- SECTION 5 — READING THE STRUCTURE
-- The three questions the application actually asks, answered in the database
-- so the API route does not have to assemble them from four round trips.
-- ============================================================================

-- Who is above this person, in display order.
create or replace function employee_manager_chain(p_employee_id uuid)
returns table (
  relationship_type text,
  manager_id        uuid,
  emp_code          text,
  full_name         text,
  designation       text,
  department        text,
  office_email      text,
  personal_email    text
)
language sql
stable
as $$
  select r.relationship_type,
         m.id, m.emp_code, m.full_name, m.designation,
         d.dept_name, m.office_email, m.personal_email
    from employee_relationships r
    join employees m on m.id = r.manager_employee_id
    left join departments d on d.id = m.department_id
   where r.employee_id = p_employee_id
     and r.valid_to is null
   order by case r.relationship_type
              when 'L1' then 1 when 'L2' then 2 when 'L3' then 3
              when 'L4' then 4 when 'HOD' then 5 else 9 end;
$$;

comment on function employee_manager_chain is
  'The management chain for one employee, L1 first and HOD last. A level nobody '
  'is mapped to is simply absent.';

-- Who reports to this person directly.
create or replace function employee_direct_reports(p_manager_id uuid, p_type text default 'L1')
returns table (
  employee_id  uuid,
  emp_code     text,
  full_name    text,
  designation  text,
  department   text
)
language sql
stable
as $$
  select e.id, e.emp_code, e.full_name, e.designation, d.dept_name
    from employee_relationships r
    join employees e on e.id = r.employee_id
    left join departments d on d.id = e.department_id
   where r.manager_employee_id = p_manager_id
     and r.valid_to is null
     and (p_type is null or r.relationship_type = p_type)
   order by e.emp_code;
$$;

-- Everybody beneath this person, following L1 downward. Depth-limited, so even
-- if a cycle were somehow written the query still returns.
create or replace function employee_all_reports(p_manager_id uuid, p_max_depth int default 12)
returns table (employee_id uuid, emp_code text, full_name text, depth int)
language sql
stable
as $$
  with recursive tree as (
    select r.employee_id, 1 as depth
      from employee_relationships r
     where r.manager_employee_id = p_manager_id
       and r.relationship_type = 'L1'
       and r.valid_to is null
    union
    select r.employee_id, t.depth + 1
      from employee_relationships r
      join tree t on r.manager_employee_id = t.employee_id
     where r.relationship_type = 'L1'
       and r.valid_to is null
       and t.depth < p_max_depth
  )
  select t.employee_id, e.emp_code, e.full_name, t.depth
    from tree t
    join employees e on e.id = t.employee_id
   order by t.depth, e.emp_code;
$$;


-- ============================================================================
-- SECTION 6 — THE ONE ROLE THE WORKBOOK NAMES THAT THE APP DID NOT HAVE
-- Six of the seven functional roles in the workbook already existed as
-- ess_roles: HR Manager, HR Head, Payroll manager (PAYROLL), Admin Manager
-- (ADMIN_COMPANY), IT Manager (IT) and Branch HR Executive (BRANCH_HR).
--
-- Finance Executive had no match. It is added rather than bent onto CFO, which
-- is a different job entirely. Note it does NOT replace finance_team: that
-- table carries per-person approval limits for travel claims, which a role
-- cannot express, and the two are read for different questions.
-- ============================================================================

insert into ess_roles (role_code, role_name, scope, salary_visibility, sort_order)
values ('FINANCE_EXECUTIVE', 'Finance Executive', 'ORG', 'NONE', 20)
on conflict (role_code) do nothing;


-- ============================================================================
-- SECTION 7 — WHAT EACH ROLE MAY OPEN
-- role_permissions held zero rows, so nothing was ever hidden. Seeded narrow:
-- the least access that lets a role do its stated job, and VIEW rather than
-- EDIT wherever it was genuinely unclear.
--
-- Approving is not administering. role_approval_rights already holds 43 rows
-- and stays the place approval power lives — a CFO signing off a requisition
-- needs VIEW on Recruitment, not FULL.
--
-- ON CONFLICT DO NOTHING, so re-running never overwrites an edit made from the
-- Roles & Permissions screen.
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
  -- Super admin: everything. Also floored to FULL in code, so a broken matrix
  -- can never lock the last administrator out of the screen that repairs it.
  ('ADMIN_SUPER','*','FULL'),

  -- ── The seven roles the workbook names ─────────────────────────────────────

  -- HR Head — runs HR for the group. No payroll.
  ('HR_HEAD','Employees','FULL'), ('HR_HEAD','Recruitment','FULL'), ('HR_HEAD','Onboarding','FULL'),
  ('HR_HEAD','Attendance','FULL'), ('HR_HEAD','Attendance Reports','FULL'),
  ('HR_HEAD','Leave Config','FULL'), ('HR_HEAD','Holidays','FULL'), ('HR_HEAD','HR Letters','FULL'),
  ('HR_HEAD','Policies','FULL'), ('HR_HEAD','Transfer','FULL'), ('HR_HEAD','Bulk Upload','EDIT'),
  ('HR_HEAD','ESS & Roles','FULL'), ('HR_HEAD','Reports','EDIT'), ('HR_HEAD','Company Profile','VIEW'),
  ('HR_HEAD','Travel Claims','VIEW'), ('HR_HEAD','Support','EDIT'),

  -- HR Manager — the same work a notch down, and no role administration.
  ('HR_MANAGER','Employees','EDIT'), ('HR_MANAGER','Recruitment','EDIT'), ('HR_MANAGER','Onboarding','FULL'),
  ('HR_MANAGER','Attendance','EDIT'), ('HR_MANAGER','Attendance Reports','VIEW'),
  ('HR_MANAGER','Leave Config','EDIT'), ('HR_MANAGER','Holidays','EDIT'), ('HR_MANAGER','HR Letters','EDIT'),
  ('HR_MANAGER','Policies','VIEW'), ('HR_MANAGER','Transfer','EDIT'), ('HR_MANAGER','Bulk Upload','EDIT'),
  ('HR_MANAGER','Reports','VIEW'), ('HR_MANAGER','Travel Claims','VIEW'), ('HR_MANAGER','Support','EDIT'),

  -- Payroll manager — runs the monthly cycle.
  ('PAYROLL','Payroll','FULL'), ('PAYROLL','Flexi Claims','FULL'), ('PAYROLL','Loans','FULL'),
  ('PAYROLL','Compliance','FULL'), ('PAYROLL','Reports','EDIT'), ('PAYROLL','Database Export','EDIT'),
  ('PAYROLL','Employees','VIEW'), ('PAYROLL','Attendance','VIEW'), ('PAYROLL','Attendance Reports','VIEW'),
  ('PAYROLL','Travel Claims','VIEW'), ('PAYROLL','Finance','VIEW'), ('PAYROLL','Leave Config','VIEW'),

  -- Admin Manager — facilities and company setup. Never sees pay.
  ('ADMIN_COMPANY','Admin Setup','FULL'), ('ADMIN_COMPANY','Company Profile','FULL'),
  ('ADMIN_COMPANY','Policies','EDIT'), ('ADMIN_COMPANY','Support','FULL'),
  ('ADMIN_COMPANY','Holidays','EDIT'), ('ADMIN_COMPANY','Employees','VIEW'),
  ('ADMIN_COMPANY','Onboarding','VIEW'),

  -- IT Manager — accounts and access, not people data.
  ('IT','Admin Setup','EDIT'), ('IT','Support','FULL'), ('IT','ESS & Roles','VIEW'),
  ('IT','Employees','VIEW'), ('IT','Onboarding','VIEW'), ('IT','Database Export','VIEW'),

  -- Finance Executive — the money side, without payroll administration.
  ('FINANCE_EXECUTIVE','Finance','FULL'), ('FINANCE_EXECUTIVE','Travel Claims','EDIT'),
  ('FINANCE_EXECUTIVE','Flexi Claims','VIEW'), ('FINANCE_EXECUTIVE','Loans','VIEW'),
  ('FINANCE_EXECUTIVE','Payroll','VIEW'), ('FINANCE_EXECUTIVE','Reports','VIEW'),
  ('FINANCE_EXECUTIVE','Compliance','VIEW'), ('FINANCE_EXECUTIVE','Employees','VIEW'),

  -- Branch HR Executive — HR work for one branch.
  ('BRANCH_HR','Employees','EDIT'), ('BRANCH_HR','Attendance','EDIT'),
  ('BRANCH_HR','Attendance Reports','VIEW'), ('BRANCH_HR','Onboarding','EDIT'),
  ('BRANCH_HR','HR Letters','EDIT'), ('BRANCH_HR','Recruitment','VIEW'),
  ('BRANCH_HR','Leave Config','VIEW'), ('BRANCH_HR','Holidays','VIEW'), ('BRANCH_HR','Support','EDIT'),

  -- ── Roles the app already had, kept coherent ──────────────────────────────
  ('CHRO','Employees','FULL'), ('CHRO','Recruitment','FULL'), ('CHRO','Onboarding','FULL'),
  ('CHRO','Attendance','FULL'), ('CHRO','Attendance Reports','FULL'), ('CHRO','HR Letters','FULL'),
  ('CHRO','Policies','FULL'), ('CHRO','Transfer','FULL'), ('CHRO','ESS & Roles','EDIT'),
  ('CHRO','Reports','EDIT'), ('CHRO','Payroll','VIEW'), ('CHRO','Finance','VIEW'),

  ('CFO','Finance','FULL'), ('CFO','Payroll','VIEW'), ('CFO','Compliance','VIEW'),
  ('CFO','Flexi Claims','VIEW'), ('CFO','Travel Claims','VIEW'), ('CFO','Loans','VIEW'),
  ('CFO','Reports','VIEW'), ('CFO','Employees','VIEW'), ('CFO','Company Profile','VIEW'),

  ('MD','Employees','VIEW'), ('MD','Recruitment','VIEW'), ('MD','Payroll','VIEW'),
  ('MD','Finance','VIEW'), ('MD','Reports','VIEW'), ('MD','Compliance','VIEW'),
  ('MD','Attendance Reports','VIEW'), ('MD','Company Profile','VIEW'),

  ('PAYROLL_ADMIN','Payroll','FULL'), ('PAYROLL_ADMIN','Admin Setup','FULL'),
  ('PAYROLL_ADMIN','Compliance','FULL'), ('PAYROLL_ADMIN','Leave Config','FULL'),
  ('PAYROLL_ADMIN','Holidays','FULL'), ('PAYROLL_ADMIN','Flexi Claims','EDIT'),
  ('PAYROLL_ADMIN','Company Profile','EDIT'), ('PAYROLL_ADMIN','Employees','VIEW'),

  ('RECRUITER','Recruitment','FULL'), ('RECRUITER','Onboarding','EDIT'),
  ('RECRUITER','Employees','VIEW'), ('RECRUITER','Ezer AI','VIEW'),

  ('IMPL_MANAGER','Employees','VIEW'), ('IMPL_MANAGER','Onboarding','VIEW'),
  ('IMPL_MANAGER','Admin Setup','VIEW'), ('IMPL_MANAGER','Company Profile','VIEW'),
  ('IMPL_MANAGER','Attendance','VIEW'), ('IMPL_MANAGER','Reports','VIEW'),
  ('IMPL_MANAGER','Support','FULL'), ('IMPL_MANAGER','Ezer AI','VIEW'),

  ('BRANCH_EXEC','Attendance','VIEW'), ('BRANCH_EXEC','Attendance Reports','VIEW'),
  ('BRANCH_EXEC','Employees','VIEW'), ('BRANCH_EXEC','Holidays','VIEW')

  -- L1_MANAGER, L2_MANAGER and HOD are deliberately absent. They exist in
  -- ess_roles but they describe a position in the reporting chain, not a
  -- permission — and the workbook's own role sheet lists them with no holder,
  -- which says the same thing. Reporting lines live in
  -- employee_relationships; granting module access from them would be exactly
  -- the confusion this migration exists to prevent.
  --
  -- EMPLOYEE is absent too: the baseline role opens nothing in the admin
  -- dashboard. The ESS portal is not gated by these modules.
)
insert into role_permissions (role_id, module, access_level)
select r.id,
       m.module,
       coalesce(
         (select g.access_level from grants g where g.role_code = r.role_code and g.module = m.module),
         (select g.access_level from grants g where g.role_code = r.role_code and g.module = '*'),
         'NONE')
  from ess_roles r
 cross join mods m
on conflict (role_id, module) do nothing;


-- ============================================================================
-- SECTION 8 — THE ENFORCEMENT SWITCH
-- Starts OFF. Until it is turned on the sidebar shows everything, exactly as it
-- did before this migration, so assigning roles and hiding menus are two
-- separate days rather than one risky one.
-- ============================================================================

create table if not exists rms_config (
  id                    boolean primary key default true check (id),   -- exactly one row
  enforce_module_access boolean not null default false,
  updated_at            timestamptz not null default now()
);

insert into rms_config (id, enforce_module_access) values (true, false)
on conflict (id) do nothing;

comment on table rms_config is
  'One row. enforce_module_access=false means the sidebar ignores '
  'role_permissions and shows everything. Turn it on only once the real roles '
  'are assigned:  update rms_config set enforce_module_access = true;';

alter table rms_config enable row level security;
drop policy if exists "allow_all_rms_config" on rms_config;
create policy "allow_all_rms_config" on rms_config
  for all to anon, authenticated using (true) with check (true);


-- ============================================================================
-- SECTION 9 — VERIFICATION
-- Read this output rather than trusting that no error appeared.
-- ============================================================================

-- (a) the new table exists and carries the legacy backfill. Before any import
--     this should be 28 L1 rows and 0 L2, all marked LEGACY.
select relationship_type, source, count(*)
  from employee_relationships
 group by 1, 2
 order by 1, 2;

-- (b) 19 roles now, with Finance Executive among them
select count(*) as roles,
       count(*) filter (where role_code = 'FINANCE_EXECUTIVE') as finance_executive
  from ess_roles;

-- (c) the matrix: 24 modules per role, most of them NONE
select r.role_code,
       count(*) filter (where p.access_level = 'FULL') as full_access,
       count(*) filter (where p.access_level = 'EDIT') as edit,
       count(*) filter (where p.access_level = 'VIEW') as view_only,
       count(*)                                        as modules
  from ess_roles r
  left join role_permissions p on p.role_id = r.id
 group by r.role_code
 order by full_access desc, edit desc, r.role_code;

-- (d) the mirror is intact — travel_claim_approver reads this column
select count(*) filter (where l1_manager_id is not null) as l1_on_employees,
       (select count(*) from employee_relationships where relationship_type = 'L1' and valid_to is null) as l1_relationships
  from employees;

-- (e) enforcement is still off, which is correct until roles are assigned
select enforce_module_access from rms_config;

commit;

-- ============================================================================
-- AFTER THIS FILE
--   1. Import the org chart: Bulk Uploader -> "Org structure & roles".
--      It writes the relationships and the role assignments, and is safe to
--      run more than once.
--   2. Check who ended up with what on ESS & Role Management.
--   3. Only then:  update rms_config set enforce_module_access = true;
--
-- TO STOP ENFORCING (no migration needed):
--      update rms_config set enforce_module_access = false;
-- ============================================================================
