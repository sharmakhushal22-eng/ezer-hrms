-- ============================================================================
-- EZER HRMS — FINANCE DEPARTMENT
-- Migration 053
-- ----------------------------------------------------------------------------
-- A finance function that owns approvals and payouts across the product, not a
-- travel feature wearing a finance label. Travel claims are the first thing
-- routed to it; payroll, vendor bills, advances and reimbursements are meant to
-- follow without another migration.
--
-- THREE TABLES, AND WHY EACH EXISTS
--
--   finance_team        Being in the Finance & Accounts department is not the
--                       same as being allowed to approve money. That department
--                       holds 57 people spanning Intern to Senior Manager.
--                       Authority is explicit here — who may approve, up to what
--                       value, and who may release a payment — rather than
--                       inferred from a job title.
--
--   finance_modules     A registry of what sends work to finance. Adding the
--                       next module is a row, and the dashboard picks it up
--                       without a code change.
--
--   finance_work_items  One queue for everything finance has to action, keyed by
--                       (module_code, ref_id). A module enqueues when something
--                       needs finance and settles it when done. The finance
--                       screen reads this one table, so it does not grow a new
--                       join every time a module is added.
--
-- Nothing here changes the travel tables. The travel API writes to the queue
-- through finance_enqueue() and finance_settle(); if this migration is not
-- applied those calls no-op and travel behaves exactly as it does today.
--
-- Safe to re-run.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — WHO IS IN FINANCE, AND WHAT THEY MAY DO
-- ============================================================================

create table if not exists finance_team (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,

  role            text not null default 'EXECUTIVE'
                    check (role in ('EXECUTIVE','MANAGER','CONTROLLER','CFO')),

  -- Authority, stated rather than implied.
  can_approve     boolean not null default true,
  -- Highest claim value this person may approve. Null means no ceiling, which
  -- should be rare and deliberate.
  approval_limit  numeric(14,2),
  -- Approving and paying are different acts. Someone who can sign off a claim
  -- is not automatically the person who releases the money.
  can_disburse    boolean not null default false,
  -- Reads every company's work, for a group finance function.
  is_group_scope  boolean not null default false,

  is_active       boolean not null default true,
  added_by        uuid references employees(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, employee_id)
);

create index if not exists idx_finance_team_emp on finance_team (employee_id) where is_active;
create index if not exists idx_finance_team_co  on finance_team (company_id) where is_active;

comment on table finance_team is
  'The finance function and its authority. Membership of the Finance & Accounts '
  'department does not grant approval rights — a row here does.';
comment on column finance_team.approval_limit is
  'Maximum value this person may approve. Null = no ceiling.';


-- ============================================================================
-- SECTION 2 — WHAT SENDS WORK TO FINANCE
-- A row per module. The dashboard renders whatever is enabled here, so the next
-- module needs an insert, not a code change.
-- ============================================================================

create table if not exists finance_modules (
  id           uuid primary key default gen_random_uuid(),
  module_code  text not null unique,
  module_name  text not null,
  description  text,
  icon         text,
  -- Where the full record lives, for a "open the original" link.
  detail_route text,
  is_enabled   boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

insert into finance_modules (module_code, module_name, description, icon, detail_route, sort_order)
values
  ('TRAVEL', 'Travel Claims',
   'Employee travel reimbursement. Finance verifies the amounts and releases payment.',
   'plane', '/dashboard/travel-claims', 10)
on conflict (module_code) do nothing;

-- Registered but disabled: they describe the intended shape without pretending
-- to be built. Enable each as its module starts enqueuing work.
insert into finance_modules (module_code, module_name, description, icon, detail_route, is_enabled, sort_order)
values
  ('PAYROLL',       'Payroll Runs',      'Sign-off before a payroll run is released.',        'wallet',  '/dashboard/payroll',      20, false),
  ('ADVANCE',       'Travel Advances',   'Advances requested before a trip, recovered after.', 'cash',   '/dashboard/travel-claims', 30, false),
  ('VENDOR',        'Vendor Invoices',   'Supplier invoices awaiting verification and payment.','invoice', null,                     40, false),
  ('REIMBURSEMENT', 'Other Reimbursements','Flexi and non-travel employee claims.',            'receipt', '/dashboard/flexi-claims', 50, false)
on conflict (module_code) do nothing;


-- ============================================================================
-- SECTION 3 — THE QUEUE
-- ============================================================================

create table if not exists finance_work_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  module_code   text not null references finance_modules(module_code),

  -- What this points at in the owning module. ref_table is recorded so the row
  -- is readable on its own, without knowing which module wrote it.
  ref_table     text not null,
  ref_id        uuid not null,

  title         text not null,
  subtitle      text,
  employee_id   uuid references employees(id),
  amount        numeric(14,2),
  currency      text not null default 'INR',

  status        text not null default 'PENDING'
                  check (status in ('PENDING','APPROVED','REJECTED','SETTLED','CANCELLED')),
  -- How many flags the owning module raised. Surfaced so finance can triage
  -- without opening every item.
  flag_count    int not null default 0,

  raised_at     timestamptz not null default now(),
  due_at        timestamptz,
  actioned_by   uuid references employees(id),
  actioned_at   timestamptz,
  action_note   text,

  -- Anything module-specific the finance screen may want without a join.
  meta          jsonb,

  updated_at    timestamptz not null default now(),
  -- One queue entry per source record. A module re-enqueuing the same thing
  -- updates its entry rather than creating a duplicate.
  unique (module_code, ref_id)
);

create index if not exists idx_finance_queue_open
  on finance_work_items (company_id, module_code, raised_at) where status = 'PENDING';
create index if not exists idx_finance_queue_emp on finance_work_items (employee_id);

comment on table finance_work_items is
  'Everything awaiting finance, from any module. Written by the owning module '
  'via finance_enqueue(); the finance dashboard reads only this table.';


-- ============================================================================
-- SECTION 4 — THE INTERFACE MODULES USE
-- ============================================================================

-- Push work to finance, or update it if already queued.
create or replace function finance_enqueue(
  p_company_id  uuid,
  p_module      text,
  p_ref_table   text,
  p_ref_id      uuid,
  p_title       text,
  p_subtitle    text default null,
  p_employee_id uuid default null,
  p_amount      numeric default null,
  p_flag_count  int default 0,
  p_due_at      timestamptz default null,
  p_meta        jsonb default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  -- An unregistered or disabled module is a caller mistake, not a silent skip.
  if not exists (select 1 from finance_modules where module_code = p_module and is_enabled) then
    raise exception 'finance_enqueue: module % is not registered or not enabled', p_module;
  end if;

  insert into finance_work_items (
    company_id, module_code, ref_table, ref_id, title, subtitle,
    employee_id, amount, flag_count, due_at, meta, status, raised_at, updated_at)
  values (
    p_company_id, p_module, p_ref_table, p_ref_id, p_title, p_subtitle,
    p_employee_id, p_amount, coalesce(p_flag_count,0), p_due_at, p_meta, 'PENDING', now(), now())
  on conflict (module_code, ref_id) do update
    set title      = excluded.title,
        subtitle   = excluded.subtitle,
        amount     = excluded.amount,
        flag_count = excluded.flag_count,
        due_at     = excluded.due_at,
        meta       = excluded.meta,
        -- Re-queuing something already actioned reopens it: a claim sent back
        -- and resubmitted is pending again.
        status     = 'PENDING',
        actioned_by = null,
        actioned_at = null,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Close a queue entry when the owning module reaches a conclusion.
create or replace function finance_settle(
  p_module  text,
  p_ref_id  uuid,
  p_status  text,
  p_by      uuid default null,
  p_note    text default null
)
returns boolean
language plpgsql
as $$
begin
  if p_status not in ('APPROVED','REJECTED','SETTLED','CANCELLED') then
    raise exception 'finance_settle: % is not a settlement status', p_status;
  end if;

  update finance_work_items
     set status = p_status,
         actioned_by = coalesce(p_by, actioned_by),
         actioned_at = now(),
         action_note = coalesce(p_note, action_note),
         updated_at = now()
   where module_code = p_module and ref_id = p_ref_id;

  return found;
end;
$$;

-- May this person approve this value? Used before any finance action.
create or replace function finance_can_approve(p_employee_id uuid, p_amount numeric default null)
returns boolean
language plpgsql
stable
as $$
declare
  v record;
begin
  select can_approve, approval_limit into v
    from finance_team
   where employee_id = p_employee_id and is_active
   limit 1;

  if not found or not v.can_approve then
    return false;
  end if;
  -- Null limit means no ceiling; a null amount is a general capability check.
  if v.approval_limit is null or p_amount is null then
    return true;
  end if;
  return p_amount <= v.approval_limit;
end;
$$;

comment on function finance_can_approve is
  'Authority check: is this person on the finance team, allowed to approve, and '
  'is the value within their limit. Null limit = no ceiling.';


-- ============================================================================
-- SECTION 5 — SEED THE TEAM FROM THE EXISTING DEPARTMENT
-- 57 people sit in Finance & Accounts, from Intern to Senior Manager. Authority
-- is graded by designation rather than given to everyone: an intern in finance
-- should not be able to release a payment.
-- ============================================================================

do $$
declare
  v_added int;
begin
  insert into finance_team (company_id, employee_id, role, can_approve, approval_limit, can_disburse)
  select
    e.company_id,
    e.id,
    case
      when e.designation ilike '%CFO%' or e.designation ilike '%Chief Financial%' then 'CFO'
      when e.designation ilike '%Senior Manager%' or e.designation ilike '%Controller%' then 'CONTROLLER'
      when e.designation ilike '%Manager%'                                            then 'MANAGER'
      else 'EXECUTIVE'
    end,
    -- Interns, trainees and contractors see the queue but do not action it.
    case
      when e.designation ilike '%Intern%' or e.designation ilike '%Trainee%'
        or e.designation ilike '%Contract%' or e.designation ilike '%Consultant%' then false
      else true
    end,
    case
      when e.designation ilike '%CFO%'            then null          -- no ceiling
      when e.designation ilike '%Senior Manager%' then 500000
      when e.designation ilike '%Manager%'        then 200000
      when e.designation ilike '%Senior%'         then 100000
      else 25000
    end,
    -- Releasing money is a narrower right than approving it.
    (e.designation ilike '%Manager%' or e.designation ilike '%CFO%' or e.designation ilike '%Controller%')
  from employees e
  join departments d on d.id = e.department_id
  where d.dept_name ilike '%Finance%'
    and coalesce(e.date_of_leaving, '9999-12-31'::date) >= current_date
  on conflict (company_id, employee_id) do nothing;

  get diagnostics v_added = row_count;
  raise notice 'finance_team seeded with % people', v_added;
end $$;

-- Everyone is pointed at a finance_spoc_id; make sure that person is on the
-- team even if they sit outside the Finance department.
insert into finance_team (company_id, employee_id, role, can_approve, approval_limit, can_disburse)
select distinct e.company_id, e.finance_spoc_id, 'MANAGER', true, 200000, true
  from employees e
 where e.finance_spoc_id is not null
on conflict (company_id, employee_id) do nothing;


-- ============================================================================
-- SECTION 6 — RLS, matching the existing pattern
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['finance_team','finance_modules','finance_work_items']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_all', t);
    execute format(
      'create policy %I on %I for all to anon, authenticated using (true) with check (true)',
      t || '_all', t);
  end loop;
end $$;


-- ============================================================================
-- VERIFICATION
-- ============================================================================

select 'finance_team'         as object, count(*)::text as rows from finance_team
union all
select 'can approve',          count(*)::text from finance_team where can_approve
union all
select 'can disburse',         count(*)::text from finance_team where can_disburse
union all
select 'modules registered',   count(*)::text from finance_modules
union all
select 'modules enabled',      count(*)::text from finance_modules where is_enabled
union all
select 'queue items',          count(*)::text from finance_work_items;

-- Who can approve what:
--   select ft.role, count(*), min(ft.approval_limit), max(ft.approval_limit)
--     from finance_team ft where ft.can_approve group by ft.role order by 1;

-- ============================================================================
-- END OF MIGRATION 053
-- ============================================================================
