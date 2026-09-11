-- ============================================================================
-- EZER HRMS — ORG CHART AND DIAGNOSTICS
-- Migration 060
-- ----------------------------------------------------------------------------
-- 058 gave every employee a management chain and 24 hours of testing against
-- the real workbook confirmed it holds as a strict tree: for every employee
-- with both an L1 and an L2, L2 is exactly L1's own L1, 258 times out of 258.
-- This migration builds on that tree rather than storing it a second way:
-- peers, the whole-company chart, and three diagnostics, all reading
-- employee_relationships and nothing else.
--
-- WHY NOT A SINGLE reports_to EDGE
-- A design was reviewed that stores one edge (employees.reports_to) and
-- derives L2/HOD by walking it. That is a reasonable model for data that
-- starts as raw manager assignments. Ours does not: the workbook computed
-- L1, L2 and HOD independently per a grade-band rule, and HOD in particular
-- is not "N levels up" — two departments have different chain depths and both
-- have exactly one HOD, a fact no walk can infer. employee_relationships
-- already stores that fact directly, which a derive-on-read model would have
-- to re-invent as a manually maintained tag. Keeping the direct storage is
-- the smaller, truer model for this data.
--
-- WHAT THIS FILE ADDS
--   org_peers            everyone sharing this employee's L1 manager
--   v_org_tree            the whole company as one recursive result set,
--                         for the org chart to render in a single query
--   org_orphans           active employees with no L1 who are not themselves
--                         a department head — their leave, claims and exit
--                         requests have nobody to land on
--   v_span_of_control      managers ranked by direct reports, so an inbox
--                         overload shows up before someone complains
--   org_drift_report       rows where employees.l1_manager_id /
--                         l2_manager_id disagree with employee_relationships
--                         — a real risk, not a hypothetical one: the
--                         `employment` bulk-uploader writes l1_manager_id
--                         directly from a spreadsheet column, bypassing this
--                         table entirely, and nothing stops that today.
--
-- Safe to re-run. Nothing here writes to employee data.
-- ============================================================================

begin;

-- ============================================================================
-- SECTION 1 — PEERS
-- Everyone who shares this employee's L1 manager. Someone with no L1 manager
-- (the 26 at the top of their chains) has no peers, the same way an org chart
-- draws nobody beside its own root.
-- ============================================================================

create or replace function org_peers(p_employee_id uuid, p_include_self boolean default true)
returns table (
  employee_id     uuid,
  emp_code        text,
  full_name       text,
  designation     text,
  department      text,
  is_self         boolean,
  direct_reports  int
)
language sql
stable
as $$
  with mgr as (
    select r.manager_employee_id as m
      from employee_relationships r
     where r.employee_id = p_employee_id
       and r.relationship_type = 'L1'
       and r.valid_to is null
  )
  select e.id, e.emp_code, e.full_name, e.designation, d.dept_name,
         (e.id = p_employee_id),
         (select count(*)::int from employee_relationships r2
           where r2.manager_employee_id = e.id and r2.relationship_type = 'L1' and r2.valid_to is null)
    from employee_relationships r
    join employees e on e.id = r.employee_id and e.date_of_leaving is null
    left join departments d on d.id = e.department_id
   where r.relationship_type = 'L1'
     and r.valid_to is null
     and r.manager_employee_id = (select m from mgr)
     and (p_include_self or e.id <> p_employee_id)
   order by (e.id = p_employee_id) desc, e.full_name;
$$;

comment on function org_peers is
  'Everyone reporting to the same L1 manager as this employee. Empty for '
  'anyone at the top of their chain — an org root has no peers.';


-- ============================================================================
-- SECTION 2 — THE WHOLE TREE, ONE QUERY
-- The org chart needs every node and every parent link to lay itself out; 397
-- one-row-at-a-time calls would be 397 round trips. This is one.
--
-- Depth capped at 15, same as 058's cycle guard, for the same reason: a walk
-- with no cap is a query that never returns if the data ever loops.
-- ============================================================================

create or replace view v_org_tree as
with recursive roots as (
  select e.id, e.company_id, e.emp_code, e.full_name, e.designation,
         d.dept_name as department, e.grade,
         null::uuid as l1_manager_id, 0 as depth,
         e.full_name::text as sort_path, array[e.id] as path
    from employees e
    left join departments d on d.id = e.department_id
   where e.date_of_leaving is null
     and not exists (
       select 1 from employee_relationships r
        where r.employee_id = e.id and r.relationship_type = 'L1' and r.valid_to is null)
  union all
  select c.id, c.company_id, c.emp_code, c.full_name, c.designation,
         d.dept_name, c.grade, t.id, t.depth + 1,
         t.sort_path || ' > ' || c.full_name, t.path || c.id
    from roots t
    join employee_relationships r
      on r.manager_employee_id = t.id and r.relationship_type = 'L1' and r.valid_to is null
    join employees c on c.id = r.employee_id and c.date_of_leaving is null
    left join departments d on d.id = c.department_id
   where t.depth < 15
     and not (c.id = any(t.path))
)
select roots.id, roots.company_id, roots.emp_code, roots.full_name, roots.designation,
       roots.department, roots.grade, roots.l1_manager_id, roots.depth, roots.sort_path,
       (select count(*)::int from employee_relationships r2
         where r2.manager_employee_id = roots.id and r2.relationship_type = 'L1' and r2.valid_to is null)
         as direct_reports,
       exists (select 1 from employee_relationships r3
                where r3.manager_employee_id = roots.id and r3.relationship_type = 'HOD' and r3.valid_to is null)
         as is_hod
  from roots;

comment on view v_org_tree is
  'The full reporting tree, one row per active employee, root-first. '
  'is_hod is true for anyone named as somebody''s department head — the '
  'closest this schema has to a role tag, derived rather than hand-set.';


-- ============================================================================
-- SECTION 3 — ORPHANS
-- An employee with no L1 manager and no HOD tag has nobody above them at all:
-- their leave, their claims, their resignation all submit successfully and
-- then sit with nobody. Measured on this database, 21 August 2026: 26 people
-- have no L1, and 23 of them are legitimate department heads — named as
-- somebody's HOD. The other 3 are not, and are the real gap.
-- ============================================================================

create or replace function org_orphans(p_company_id uuid default null)
returns table (emp_code text, full_name text, designation text, department text)
language sql
stable
as $$
  select e.emp_code, e.full_name, e.designation, d.dept_name
    from employees e
    left join departments d on d.id = e.department_id
   where e.date_of_leaving is null
     and (p_company_id is null or e.company_id = p_company_id)
     and not exists (
       select 1 from employee_relationships r
        where r.employee_id = e.id and r.relationship_type = 'L1' and r.valid_to is null)
     and not exists (
       select 1 from employee_relationships r
        where r.manager_employee_id = e.id and r.relationship_type = 'HOD' and r.valid_to is null)
   order by d.dept_name, e.full_name;
$$;

comment on function org_orphans is
  'Active employees with no manager above them and no department-head tag of '
  'their own. Their approvals have nobody to land on. Run before trusting a '
  'reorg — a department head genuinely has no L1 and belongs here only if '
  'org_orphans also fails to find them as anybody''s HOD.';


-- ============================================================================
-- SECTION 4 — SPAN OF CONTROL
-- A manager with 20+ direct reports is a bottleneck before anybody notices:
-- every claim, leave request and resignation in that team queues behind one
-- inbox.
-- ============================================================================

create or replace view v_span_of_control as
select m.company_id, m.emp_code, m.full_name, m.designation, d.dept_name as department,
       count(r.id) as direct_reports
  from employees m
  join employee_relationships r
    on r.manager_employee_id = m.id and r.relationship_type = 'L1' and r.valid_to is null
  join employees rep on rep.id = r.employee_id and rep.date_of_leaving is null
  left join departments d on d.id = m.department_id
 where m.date_of_leaving is null
 group by m.company_id, m.id, m.emp_code, m.full_name, m.designation, d.dept_name
having count(r.id) > 0
 order by count(r.id) desc;

comment on view v_span_of_control is
  'Managers ranked by direct reports, widest first.';


-- ============================================================================
-- SECTION 5 — DRIFT: DOES THE MIRROR STILL AGREE WITH THE TREE?
-- 058's trigger keeps employees.l1_manager_id / l2_manager_id in sync with
-- employee_relationships whenever the relationship changes THROUGH the table.
-- It cannot see a write that goes around it — and one already exists:
-- app/api/employees/bulk-upload's `employment` uploader sets l1_manager_id
-- directly from a spreadsheet column. Nothing stops that upload from quietly
-- pointing the column somewhere the tree does not agree with.
-- ============================================================================

create or replace function org_drift_report(p_company_id uuid default null)
returns table (
  emp_code   text,
  full_name  text,
  field      text,
  stored     text,
  tree       text
)
language sql
stable
as $$
  with d as (
    select e.id, e.emp_code, e.full_name,
           e.l1_manager_id as s_l1, e.l2_manager_id as s_l2,
           (select r.manager_employee_id from employee_relationships r
             where r.employee_id = e.id and r.relationship_type = 'L1' and r.valid_to is null) as t_l1,
           (select r.manager_employee_id from employee_relationships r
             where r.employee_id = e.id and r.relationship_type = 'L2' and r.valid_to is null) as t_l2
      from employees e
     where e.date_of_leaving is null
       and (p_company_id is null or e.company_id = p_company_id)
  )
  select d.emp_code, d.full_name, x.field,
         (select emp_code from employees where id = x.stored),
         (select emp_code from employees where id = x.tree)
    from d
    cross join lateral (values
      ('L1', d.s_l1, d.t_l1),
      ('L2', d.s_l2, d.t_l2)
    ) as x(field, stored, tree)
   where x.stored is distinct from x.tree;
$$;

comment on function org_drift_report is
  'Every employee where the legacy l1_manager_id/l2_manager_id column '
  'disagrees with employee_relationships. Should read empty on a database '
  'where every change went through the relationship table; a non-empty row '
  'means something wrote the column directly.';


-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- (a) orphans — expect the 3 found on 21 Aug: SSM9101, SRS0001, SSM-0001
select * from org_orphans();

-- (b) the ten widest managers right now
select * from v_span_of_control limit 10;

-- (c) drift — expect this to be empty on a database where 058 ran and every
--     change since has gone through employee_relationships
select count(*) as drifted_rows from org_drift_report();

-- (d) the tree itself is queryable and bounded
select count(*) as tree_rows, max(depth) as max_depth from v_org_tree;

commit;
