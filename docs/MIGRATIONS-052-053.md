# EZER HRMS — Database Migrations

**For:** Nayan  
**From:** Tushar  
**Status:** applied — 049 through 053 are all live  
**Last verified against the database:** 2026-08-20

**Do not re-run anything in this file.** Nayan applied 052 and 053; 049, 050
and 051 were already in before that. This is now a record of what is in the
database, not a set of instructions.

The full SQL of both migrations is reproduced below, exactly as executed. It
is kept verbatim on purpose — including its inline commentary, which was
written *before* the migrations ran and quotes pre-run estimates for the
manager backfill. Those estimates turned out to be wrong. The real figures,
measured against the live database, are in the section immediately below and
in *After running both* at the end. Where the two disagree, the measured
numbers are correct.

One thing did **not** happen, deliberately: section 4 of 052, the actual
switch to Reporting Manager, is still commented out. It is now carried as its
own file, `054_enable_rm_stage.sql`, which is waiting on a decision from
Tushar rather than on Nayan.

---

## 052 — configurable approval chain

Makes each stage of the travel-claim approval chain a policy flag instead of
logic inside a function, so changing the chain later is an `UPDATE`, not another
migration.

* adds `travel_policies.hr_stage_enabled` alongside the existing `rm_stage_enabled`
* rewrites `travel_first_claim_stage()` and adds `travel_next_claim_stage()`
  to walk whichever stages are enabled, with Finance always last
* backfills `employees.l1_manager_id` from `reporting_manager`

### It does not switch the chain, on purpose

Tushar asked for **Reporting Manager → Finance**, replacing HR Head. The data
does not support that yet:

Measured after 052 ran, on 2026-08-20:

| column                | populated |
|-----------------------|-----------|
| `l1_manager_id`       | 28 / 398  |
| `reporting_manager`   | 390 / 398 — but a **text name**, not an id |

`reporting_manager` holds 10 distinct names. Only **2** match a real employee:

* Priya Iyer → SRS9032 ✅
* Manoj Bose → SRS9012 ✅
* Rekha Pillai, Sanjay Gupta, Sunita Rao, Anjali Sharma, Vikram Mehta,
  Rajesh Khanna, Deepak Nair, Neha Kapoor → **no employee row exists**

There is a second reason the match rate is low, beyond the missing names:
section 3 requires the manager to be in the **same company**
(`m.company_id = e.company_id`). A manager at another group company must not
approve your claim. So even the two names that resolve only resolve partly:

| manager | reports by name | same company | routed |
|---|---|---|---|
| Priya Iyer (SRS9032) | 49 | 21 | 21 |
| Manoj Bose (SRS9012) | 24 | 7 | 7 |

The cross-company remainder is not a failure. It is that check working.

So switching today sends **28 of 398** employees to a manager and **370
straight to Finance with no first review** — worse than the current HR Head
chain, which routes all 398.

Section 3 backfills only what resolves, on **exact full-name match only**. No
fuzzy matching: "Rekha Pillai" against "Rekha Chopra" is a different person, and
routing a claim to the wrong approver is worse than leaving it unmapped.

**Section 4 — the actual switch — is commented out.** After running, this lists
the managers HR still needs to create as employees:

```sql
select e.reporting_manager as manager_name, count(*) as reports_unrouted
  from employees e
 where e.l1_manager_id is null and e.reporting_manager is not null
 group by e.reporting_manager order by count(*) desc;
```

When that returns nothing (or you accept the gap), uncomment section 4:

```sql
update travel_policies
   set rm_stage_enabled = true,     -- Reporting Manager reviews first
       hr_stage_enabled = false     -- HR Head out of the chain
 where is_active;
```

Reversing those two flags reverts it. No code change either way.

Claims already in flight keep their current status; the new chain applies to
claims submitted after the switch.

---

## 053 — finance department

A finance function that modules connect to, not a travel feature. Travel claims
are the first thing routed to it; payroll, advances, vendor invoices and other
reimbursements are registered and appear the moment they start enqueuing.

* `finance_team` — who is in finance and **what they may do**
* `finance_modules` — registry of what sends work to finance
* `finance_work_items` — one queue for everything finance must action,
  keyed `(module_code, ref_id)`
* `finance_enqueue()`, `finance_settle()`, `finance_can_approve()`

### Authority is explicit, because membership cannot be the permission

Finance & Accounts holds **57 people from Intern to Senior Manager**. Section 5
seeds the team from that department with rights graded by designation:

| designation                              | approve | limit    | release payment |
|------------------------------------------|---------|----------|-----------------|
| CFO                                      | yes     | no cap   | yes             |
| Senior Manager / Controller              | yes     | ₹500,000 | yes             |
| Manager                                  | yes     | ₹200,000 | yes             |
| Senior Executive                         | yes     | ₹100,000 | no              |
| Executive / Officer / Analyst            | yes     | ₹25,000  | no              |
| Intern / Trainee / Contract / Consultant | no      | —        | no              |

Approving an amount and releasing the money are separate rights.

Everyone's `finance_spoc_id` is added too, since all 398 employees point at one.

### RLS — a decision, not a paste

The policies are permissive, matching the existing EZER pattern. That is
deliberate here: **ESS employees are not Supabase auth users**, so a policy of
the form "employee reads own rows" cannot identify a claimant — it would lock
ESS out rather than secure anything. Protection sits in the API layer instead
(`requireDashboardUser` for dashboard routes, `resolveActor` for ESS).

Nayan: if you want real policies, say what they should be and they will be
written. This was not guessed at on a live shared database.

---

## Nothing breaks if these are delayed

The application checks for the schema and degrades honestly:

* travel claims work exactly as today; `notifyFinance()` never throws
* `/dashboard/finance` shows "Finance is not installed yet" naming the file,
  rather than an empty queue that looks like no work

---

## Two things worth deciding, separate from these files

**No role check on approvals.** `requireDashboardUser` proves only that someone
is signed in. Any Supabase auth user can approve travel claims, rewrite the
rate card and lock payroll months. `user_roles` exists but has 0 rows.
`employees.hr_head_id` and `finance_spoc_id` are both populated 398/398, so
gating on them is straightforward if wanted.

**One HR Head for all 398 employees**, across all three companies — and that
person is their own `hr_head_id`, so their own claims correctly skip to Finance.
Every travel claim in the company currently routes to one inbox.

---
---

# THE SQL

Copy each block into the Supabase SQL editor and run it. **052 first, then 053.**

Two things that have bitten this project before, both from Nayan's own notes:

* the editor runs the **whole script as one transaction** — one failure rolls
  back everything, including objects created earlier in the same file
* the editor runs **only the selected text** if anything is highlighted —
  clear the selection first

---

## 1 — `052_travel_approval_chain.sql`

<details>
<summary>252 lines — click to expand</summary>

```sql
-- ============================================================================
-- EZER HRMS — TRAVEL CLAIM MODULE · CONFIGURABLE APPROVAL CHAIN
-- Migration 052
-- ----------------------------------------------------------------------------
-- Changes the claim approval chain from
--     employee -> HR Head -> Finance
-- to
--     employee -> Reporting Manager -> Finance
--
-- and makes each stage a policy flag rather than something baked into a
-- function, so the next change is a config edit and not another migration.
--
-- ============================================================================
-- READ THIS BEFORE RUNNING — THE DATA DOES NOT SUPPORT THIS CHAIN YET
-- ============================================================================
-- Routing to a Reporting Manager needs employees.l1_manager_id, because an
-- approver needs an employee id to have an inbox. Measured on 19 Aug 2026:
--
--   l1_manager_id          0 / 397 populated
--   l2_manager_id          0 / 397
--   functional_manager_id  0 / 397
--   reporting_manager    390 / 397  — but it is a TEXT NAME, not an id
--
-- reporting_manager holds 10 distinct names. Only 2 of them match an actual
-- employee row:
--
--   Priya Iyer     -> SRS9032   ✅
--   Manoj Bose     -> SRS9012   ✅
--   Rekha Pillai, Sanjay Gupta, Sunita Rao, Anjali Sharma, Vikram Mehta,
--   Rajesh Khanna, Deepak Nair, Neha Kapoor  -> no employee row exists
--
-- So with this chain live today:
--    73 of 397 employees would reach a real manager's inbox
--   324 of 397 would fall straight through to Finance with NO first review
--
-- That is worse than the current HR Head chain, which routes all 397, so this
-- migration does NOT flip the chain on its own. It ships the capability with
-- the new chain configured, and SECTION 3 populates l1_manager_id for the 73
-- that can be resolved. The remaining 324 need their managers to exist as
-- employees before the change is safe to enable — see SECTION 4, which is
-- commented out deliberately.
--
-- Safe to re-run.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — EACH STAGE BECOMES A FLAG
-- ============================================================================

alter table travel_policies
  add column if not exists hr_stage_enabled boolean not null default true;

comment on column travel_policies.hr_stage_enabled is
  'Whether a claim passes the HR Head before Finance. With rm_stage_enabled '
  'this makes the chain configuration rather than code: any combination of '
  'RM and HR, with Finance always last.';
comment on column travel_policies.rm_stage_enabled is
  'Whether a claim passes the Reporting Manager first. Needs '
  'employees.l1_manager_id populated — a stage with nobody mapped is skipped, '
  'not stalled, so enabling this without the data silently removes a review.';


-- ============================================================================
-- SECTION 2 — ROUTING WALKS THE ENABLED STAGES
-- A stage runs only if it is enabled AND somebody is mapped to it. Finance is
-- always last and is never skipped, so a claim can never end up in a state
-- with no owner.
-- ============================================================================

create or replace function travel_first_claim_stage(p_employee_id uuid)
returns text
language plpgsql
stable
as $$
declare
  v_company    uuid;
  v_rm_on      boolean;
  v_hr_on      boolean;
begin
  select company_id into v_company from employees where id = p_employee_id;

  select coalesce(p.rm_stage_enabled, false), coalesce(p.hr_stage_enabled, true)
    into v_rm_on, v_hr_on
    from travel_policies p
   where p.company_id = v_company
     and p.is_active
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc
   limit 1;

  if coalesce(v_rm_on, false)
     and travel_claim_approver(p_employee_id, 'CLAIM_RM') is not null then
    return 'PENDING_RM';
  end if;

  if coalesce(v_hr_on, true)
     and travel_claim_approver(p_employee_id, 'CLAIM_HR') is not null then
    return 'PENDING_HR';
  end if;

  -- Nobody upstream is enabled or mapped. Finance still has to see it rather
  -- than the claim parking in a state no one owns.
  return 'PENDING_FINANCE';
end;
$$;

comment on function travel_first_claim_stage is
  'Entry status for a submitted claim. Walks the enabled stages in order — '
  'RM, then HR Head — and returns the first that has an approver mapped, '
  'else PENDING_FINANCE.';


-- Where a claim goes after the stage that just approved it. Previously the
-- route decided this in TypeScript alone; having it here too means the
-- database and the application cannot drift apart on the same question.
create or replace function travel_next_claim_stage(p_employee_id uuid, p_current text)
returns text
language plpgsql
stable
as $$
declare
  v_company uuid;
  v_hr_on   boolean;
begin
  select company_id into v_company from employees where id = p_employee_id;

  select coalesce(p.hr_stage_enabled, true)
    into v_hr_on
    from travel_policies p
   where p.company_id = v_company and p.is_active
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc
   limit 1;

  if p_current = 'PENDING_RM' then
    if coalesce(v_hr_on, true)
       and travel_claim_approver(p_employee_id, 'CLAIM_HR') is not null then
      return 'PENDING_HR';
    end if;
    return 'PENDING_FINANCE';
  end if;

  if p_current = 'PENDING_HR' then
    return 'PENDING_FINANCE';
  end if;

  return 'APPROVED';   -- Finance approved; nothing follows it
end;
$$;

comment on function travel_next_claim_stage is
  'The status a claim moves to after the current stage approves. Mirrors '
  'nextClaimStage() in lib/travel/access.ts.';


-- ============================================================================
-- SECTION 3 — BACKFILL l1_manager_id FROM THE NAMES THAT RESOLVE
-- Only exact full-name matches, and only where l1_manager_id is still null.
-- Nobody is guessed at: a near match like "Rekha Pillai" against "Rekha Chopra"
-- is a different person, and pointing a claim at the wrong approver is worse
-- than leaving it unmapped.
-- ============================================================================

do $$
declare
  v_matched int;
begin
  update employees e
     set l1_manager_id = m.id
    from employees m
   where e.l1_manager_id is null
     and e.reporting_manager is not null
     and lower(trim(e.reporting_manager)) = lower(trim(m.full_name))
     and m.id <> e.id
     and m.company_id = e.company_id;

  get diagnostics v_matched = row_count;
  raise notice 'l1_manager_id backfilled for % employees', v_matched;

  raise notice 'still unmapped: %', (
    select count(*) from employees where l1_manager_id is null
  );
end $$;


-- Which manager names still have no employee record. Run this after, and give
-- the list to HR — each one needs an employee row before the RM chain can
-- route the people who report to them.
--
--   select e.reporting_manager as manager_name,
--          count(*)            as reports_unrouted
--     from employees e
--    where e.l1_manager_id is null
--      and e.reporting_manager is not null
--    group by e.reporting_manager
--    order by count(*) desc;


-- ============================================================================
-- SECTION 4 — SWITCH THE CHAIN  ***COMMENTED OUT ON PURPOSE***
-- ----------------------------------------------------------------------------
-- Uncomment and run ONLY once the query above returns no rows, or once you
-- accept that everyone still unmapped goes straight to Finance unreviewed.
--
-- Check first:
--   select count(*) filter (where l1_manager_id is not null) as will_reach_a_manager,
--          count(*) filter (where l1_manager_id is null)     as straight_to_finance
--     from employees;
--
-- Then:
--   update travel_policies
--      set rm_stage_enabled = true,    -- Reporting Manager reviews first
--          hr_stage_enabled = false    -- HR Head no longer in the chain
--    where is_active;
--
-- To go back to HR Head -> Finance, reverse the two flags. No code change and
-- no migration either way — that is the point of SECTION 1.
--
-- Claims already in flight keep the status they hold. A claim sitting in
-- PENDING_HR when the flags change still needs an HR Head to action it; the
-- new chain applies to claims submitted after the switch.
-- ============================================================================


-- ============================================================================
-- VERIFICATION
-- ============================================================================

select 'l1_manager_id populated' as check,
       count(*) filter (where l1_manager_id is not null)::text as actual,
       count(*)::text as of_total
  from employees
union all
select 'chain today',
       (select case when rm_stage_enabled and hr_stage_enabled then 'RM -> HR -> Finance'
                    when rm_stage_enabled then 'RM -> Finance'
                    when hr_stage_enabled then 'HR -> Finance'
                    else 'Finance only' end
          from travel_policies where is_active limit 1),
       ''
union all
select 'would reach a real inbox',
       (select count(*)::text from employees e
         where travel_first_claim_stage(e.id) <> 'PENDING_FINANCE'),
       (select count(*)::text from employees);

-- ============================================================================
-- END OF MIGRATION 052
-- ============================================================================
```

</details>

---

## 2 — `053_finance_department.sql`

<details>
<summary>371 lines — click to expand</summary>

```sql
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
```

</details>

---

## After running both

```sql
select 'travel_policies.hr_stage_enabled' as object, count(*)::text as value
  from information_schema.columns
 where table_name='travel_policies' and column_name='hr_stage_enabled'
union all
select 'finance tables (expect 3)', count(*)::text
  from information_schema.tables
 where table_schema='public' and table_name like 'finance\_%'
union all
select 'finance_team seeded', (select count(*)::text from finance_team)
union all
select 'l1_manager_id populated',
       (select count(*)::text from employees where l1_manager_id is not null)
union all
select 'chain in force',
       (select case when rm_stage_enabled and hr_stage_enabled then 'RM -> HR -> Finance'
                    when rm_stage_enabled then 'RM -> Finance'
                    when hr_stage_enabled then 'HR -> Finance'
                    else 'Finance only' end
          from travel_policies where is_active limit 1);
```

What the database actually returned on **2026-08-20**, with section 4 of 052
still commented out:

| object | value |
|---|---|
| `travel_policies.hr_stage_enabled` | 1 |
| finance tables | 3 |
| `finance_team` seeded | 59 |
| `l1_manager_id` populated | 28 |
| chain in force | `HR -> Finance` |

`l1_manager_id` at 28 rather than 398 is expected — see the note on 052 above.
The earlier draft of this document predicted 73 here; that estimate did not
account for the same-company requirement in the backfill, so it was too
optimistic. 28 is correct.

The chain stays `HR -> Finance` until `054_enable_rm_stage.sql` is run with its
section 3 uncommented.

### Other tables, same check

| table | rows |
|---|---|
| `travel_policies` | 3 — one per active company |
| `travel_expense_types` | 105 |
| `travel_claims` | 0 — nothing filed yet |
| `finance_modules` | 5 |
| `finance_work_items` | 0 — nothing enqueued yet |
| `employees` | 398 |

The mileage rate card is `travel_mileage_rates`. Naming it here because it is
easy to look for `travel_mode_rates`, not find it, and conclude a table failed
to create. It did not.

---

## Still open

**`054_enable_rm_stage.sql`** — the RM switch, waiting on Tushar. It re-runs
the backfill (safe to repeat), reports the remaining gap *before* changing
anything, and keeps the flag flip commented out. Reversing it is two flags, no
code change.

**RLS.** All 22 new tables are RLS-enabled with `using (true)` — anyone holding
the anon key can read every travel claim and every finance queue item, and the
anon key ships to the browser. This was deliberate rather than careless: ESS
employees are not Supabase auth users, so `auth.uid()` is null for them and a
policy like `employee_id = auth.uid()` would match zero rows, locking ESS out
while dashboard users still saw everything. Enforcement currently sits in the
API layer (`requireDashboardUser`, `resolveActor`). Nayan's call on where it
should sit instead; revoking `anon` on these tables and giving the ESS routes a
server-side key is the smallest change that would make the policies mean
something.

**No role check on approvals.** `requireDashboardUser` proves only that someone
is signed in. Any dashboard user can approve a travel claim, rewrite the
mileage rate card, and lock a payroll month. `user_roles` has 0 rows;
`hr_head_id` and `finance_spoc_id` are 398/398, and `finance_team` already
carries `can_approve` / `approval_limit` / `can_release_payment`. Application
change, not schema — blocked on which source is authoritative.
