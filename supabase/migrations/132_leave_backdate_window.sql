-- 132_leave_backdate_window.sql
--
-- How far back an employee may apply for leave, set by HR per company.
--
-- THE PROBLEM THIS FIXES. The leave calendar refused every past date:
-- `earliestApplyDate()` returned today, and seven separate gates in the UI
-- derived from it. That is wrong for the commonest real case — somebody was
-- absent on Tuesday and needs to claim it as sick leave on Wednesday. There was
-- no way to do that at all.
--
-- WHY A CONFIGURED NUMBER AND NOT A CONSTANT. Backdating is a policy, not a
-- fact: a company that closes payroll on the 25th cannot have people rewriting
-- the 3rd. HR sets the window from Attendance & Shifts; 0 means no backdating,
-- which restores exactly today's behaviour for a company that wants it.
--
-- ONE ROW PER COMPANY, and the absence of a row is not an error — it means the
-- default. Storing a default as a seeded row would mean a company created later
-- silently has no policy at all.
--
-- Idempotent. Depends on companies.

create table if not exists leave_backdate_config (
  company_id   uuid primary key references companies(id) on delete cascade,
  -- Days, counted back from today inclusive. 0 disables backdating.
  window_days  int not null default 0 check (window_days >= 0 and window_days <= 365),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references employees(id) on delete set null
);

comment on table leave_backdate_config is
  'How many days back an employee may apply for leave. One row per company; no row means the default of 0.';
comment on column leave_backdate_config.window_days is
  'Counted back from today, inclusive: 30 means today and the previous 29 days are selectable. 0 disables backdating.';

-- ─── the resolver ────────────────────────────────────────────────────
--
-- A function rather than a bare select, because BOTH the ESS route and the
-- server-side guard must answer this question identically. Two places computing
-- "how far back" from the same table is how a UI that offers a date and a
-- server that rejects it come to disagree.
--
-- The 365 ceiling is deliberate and matches the CHECK: leave consumed outside
-- the financial year is never counted by the balance arithmetic (usedFrom only
-- sums applications whose from_date falls inside the FY), so a window wide
-- enough to cross two FY boundaries would approve leave that is then never
-- deducted from anybody's balance.
create or replace function resolve_backdate_window(p_company_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select window_days from leave_backdate_config where company_id = p_company_id),
    0
  );
$$;

-- ─── RLS ─────────────────────────────────────────────────────────────
--
-- Deny-all to anon and authenticated, as the ID card tables do. Reads and
-- writes go through routes holding the service-role key, which bypasses RLS —
-- these policies are the floor under a bug, not the gate itself. The gate is
-- requireModule('Attendance','EDIT') in the route.
alter table leave_backdate_config enable row level security;

drop policy if exists lbc_deny on leave_backdate_config;
create policy lbc_deny on leave_backdate_config for all to anon, authenticated
  using (false) with check (false);

-- ─── verify ──────────────────────────────────────────────────────────
-- Expect 0 rows and the resolver answering 0 for any company.
select count(*) as configured_companies from leave_backdate_config;
select resolve_backdate_window((select id from companies limit 1)) as default_window;
