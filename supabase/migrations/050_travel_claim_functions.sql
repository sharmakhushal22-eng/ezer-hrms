-- ============================================================================
-- EZER HRMS — TRAVEL CLAIM MODULE  ·  2 of 3: FUNCTIONS, TRIGGERS, VIEWS, RLS
-- Migration 050
-- ----------------------------------------------------------------------------
-- Run AFTER 049. Creates 11 functions, 5 triggers, 3 views and the RLS
-- policies. No data is written or read here.
--
-- plpgsql bodies are NOT checked at creation time — a wrong column name inside
-- one only surfaces when it runs. The columns these functions reference were
-- checked against the live database on 18 Aug 2026:
--   employees.date_of_leaving, .company_id, .hr_head_id, .hr_manager_id,
--   .l1_manager_id, .emp_code, .full_name
-- To confirm what actually landed, read a body back with pg_get_functiondef().
--
-- ----------------------------------------------------------------------------
-- ON RLS — PLEASE READ, THIS IS A DECISION NOT A COPY-PASTE
-- ----------------------------------------------------------------------------
-- These policies are permissive (anon + authenticated, using true), matching
-- the existing EZER pattern. That is a deliberate choice here, not an older
-- migration pasted forward, and the reason is specific:
--
--   ESS employees are not Supabase auth users at all (see the note in
--   lib/api-auth.ts and lib/supabase-ess.ts). An employee filing a travel claim
--   has no auth.uid(). So a policy of the form "employee reads own rows" cannot
--   identify them — it would not secure the table, it would simply lock ESS out
--   of its own claims.
--
-- Protection is therefore enforced in the API layer instead:
--   · dashboard-only routes (rates, periods, approval actions) require a
--     signed-in dashboard session via requireDashboardUser() in lib/api-auth.ts
--   · ESS routes go through requireWriteAccess() / requireReadAccess(), which
--     check the employee is still employed, the expense month is open, and the
--     bill is inside the 90-day window
--
-- Expense data is more sensitive than attendance, so this should not stay this
-- way forever. Tightening it properly needs the ESS identity question solved
-- first — an ESS employee needs something a policy can key on. Nayan: if you
-- want different policies, say what they should be and I will write them; I did
-- not want to guess on a live shared database.
-- ============================================================================

create or replace function travel_is_employee_active(p_employee_id uuid)
returns boolean
language plpgsql
stable
as $$
declare
  v_dol         date;
  v_company     uuid;
  v_grace_days  int;
begin
  select e.date_of_leaving,          -- <<< CHANGE THIS COLUMN NAME IF YOURS DIFFERS
         e.company_id
    into v_dol, v_company
    from employees e
   where e.id = p_employee_id;

  if not found then
    return false;
  end if;

  if v_dol is null then
    return true;                     -- active employee
  end if;

  select coalesce(p.post_exit_grace_days, 0)
    into v_grace_days
    from travel_policies p
   where p.company_id = v_company
     and p.is_active
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc
   limit 1;

  return current_date <= (v_dol + coalesce(v_grace_days, 0));
end;
$$;

comment on function travel_is_employee_active is
  'False once the employee is past their last working day (plus any configured grace). '
  'Blocks login, claim entry and reports for the travel module.';

-- ---------------------------------------------------------------------------
-- Is the expense month open for entry / edit / submission?
-- ---------------------------------------------------------------------------
create or replace function travel_is_period_open(p_company_id uuid, p_date date)
returns boolean
language plpgsql
stable
as $$
declare
  v_status  text;
  v_from    date;
  v_till    date;
begin
  select status, submit_open_from, submit_open_till
    into v_status, v_from, v_till
    from travel_periods
   where company_id = p_company_id
     and period_month = date_trunc('month', p_date)::date;

  -- no row yet = period was never opened. treat as closed, so nothing
  -- slips in for a month nobody has configured.
  if not found then
    return false;
  end if;

  if v_status <> 'OPEN' then
    return false;
  end if;

  if v_from is not null and current_date < v_from then
    return false;
  end if;

  if v_till is not null and current_date > v_till then
    return false;
  end if;

  return true;
end;
$$;

comment on function travel_is_period_open is
  'Gate for every write. CLOSED periods are read-only; LOCKED periods are permanent.';

-- ---------------------------------------------------------------------------
-- Combined guard used by the API layer
-- ---------------------------------------------------------------------------
create or replace function travel_can_write(p_employee_id uuid, p_expense_date date)
returns jsonb
language plpgsql
stable
as $$
declare
  v_company uuid;
  v_period  record;
begin
  if not travel_is_employee_active(p_employee_id) then
    return jsonb_build_object(
      'allowed', false,
      'code', 'EMPLOYEE_EXITED',
      'message', 'Your access to the travel module has ended as of your last working day.'
    );
  end if;

  select company_id into v_company from employees where id = p_employee_id;

  select status, period_label into v_period
    from travel_periods
   where company_id = v_company
     and period_month = date_trunc('month', p_expense_date)::date;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'code', 'PERIOD_NOT_OPENED',
      'message', 'This expense month has not been opened yet. Please contact HR.'
    );
  end if;

  if not travel_is_period_open(v_company, p_expense_date) then
    return jsonb_build_object(
      'allowed', false,
      'code', case when v_period.status = 'LOCKED' then 'PERIOD_LOCKED' else 'PERIOD_CLOSED' end,
      'message', v_period.period_label || ' is ' || lower(v_period.status) ||
                 '. You can no longer add or edit expenses for this month.'
    );
  end if;

  return jsonb_build_object('allowed', true, 'code', 'OK');
end;
$$;

-- ---------------------------------------------------------------------------
-- APPROVAL ROUTING (added for this repo — the drop had no HR stage)
--
-- Who actions a given stage for a given employee. Returns null when nobody is
-- mapped, which the API layer treats as "skip this stage" rather than parking
-- the claim on an approver that does not exist.
-- ---------------------------------------------------------------------------
create or replace function travel_claim_approver(p_employee_id uuid, p_stage text)
returns uuid
language plpgsql
stable
as $$
declare
  v_approver uuid;
begin
  if p_stage = 'CLAIM_RM' then
    select l1_manager_id into v_approver from employees where id = p_employee_id;
  elsif p_stage = 'CLAIM_HR' then
    -- hr_head_id is the HR Head who signs off travel spend. hr_manager_id is the
    -- day-to-day HR contact and is only a fallback.
    select coalesce(hr_head_id, hr_manager_id) into v_approver
      from employees where id = p_employee_id;
  else
    return null;
  end if;

  -- never route a claim back to the person who raised it
  if v_approver = p_employee_id then
    return null;
  end if;

  return v_approver;
end;
$$;

comment on function travel_claim_approver is
  'Resolves the approver for CLAIM_RM (l1_manager_id) or CLAIM_HR (hr_head_id, '
  'falling back to hr_manager_id). Null means the stage has no owner and is skipped.';

-- ---------------------------------------------------------------------------
-- Which status a freshly submitted claim lands in.
-- RM first only if the policy enables it AND an RM is actually mapped;
-- otherwise straight to HR Head. Finance is always last.
-- ---------------------------------------------------------------------------
create or replace function travel_first_claim_stage(p_employee_id uuid)
returns text
language plpgsql
stable
as $$
declare
  v_company     uuid;
  v_rm_enabled  boolean;
begin
  select company_id into v_company from employees where id = p_employee_id;

  select coalesce(p.rm_stage_enabled, false)
    into v_rm_enabled
    from travel_policies p
   where p.company_id = v_company
     and p.is_active
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc
   limit 1;

  if coalesce(v_rm_enabled, false)
     and travel_claim_approver(p_employee_id, 'CLAIM_RM') is not null then
    return 'PENDING_RM';
  end if;

  if travel_claim_approver(p_employee_id, 'CLAIM_HR') is not null then
    return 'PENDING_HR';
  end if;

  -- no RM and no HR Head mapped: Finance still has to see it, so it does not
  -- vanish into an unroutable state.
  return 'PENDING_FINANCE';
end;
$$;

comment on function travel_first_claim_stage is
  'Entry status for a submitted claim: PENDING_RM if the policy enables the RM '
  'stage and one is mapped, else PENDING_HR, else PENDING_FINANCE.';

-- ---------------------------------------------------------------------------
-- Rolling month creator — call from a nightly job or on company setup
-- ---------------------------------------------------------------------------
create or replace function travel_ensure_period(p_company_id uuid, p_month date)
returns uuid
language plpgsql
as $$
declare
  v_id    uuid;
  v_first date := date_trunc('month', p_month)::date;
begin
  select id into v_id
    from travel_periods
   where company_id = p_company_id and period_month = v_first;

  if v_id is not null then
    return v_id;
  end if;

  insert into travel_periods (company_id, period_month, period_label, status, auto_close_on)
  values (p_company_id, v_first, to_char(v_first, 'Mon YYYY'), 'OPEN',
          (v_first + interval '1 month' + interval '5 days')::date)
  returning id into v_id;

  insert into travel_period_audit (period_id, company_id, action, to_status, reason)
  values (v_id, p_company_id, 'CREATED', 'OPEN', 'Auto-created');

  return v_id;
end;
$$;

-- ============================================================================
-- SECTION 7 — TRIGGERS
-- ============================================================================

create or replace function travel_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_travel_trips_touch on travel_trips;
create trigger trg_travel_trips_touch before update on travel_trips
  for each row execute function travel_touch_updated_at();

drop trigger if exists trg_travel_logs_touch on travel_logs;
create trigger trg_travel_logs_touch before update on travel_logs
  for each row execute function travel_touch_updated_at();

drop trigger if exists trg_travel_claims_touch on travel_claims;
create trigger trg_travel_claims_touch before update on travel_claims
  for each row execute function travel_touch_updated_at();

drop trigger if exists trg_travel_periods_touch on travel_periods;
create trigger trg_travel_periods_touch before update on travel_periods
  for each row execute function travel_touch_updated_at();

-- a LOCKED period can never go back
create or replace function travel_guard_period_status()
returns trigger language plpgsql as $$
begin
  if old.status = 'LOCKED' and new.status <> 'LOCKED' then
    raise exception 'Period % is LOCKED (paid through payroll) and cannot be reopened.', old.period_label;
  end if;
  if new.status = 'OPEN' and old.status = 'CLOSED'
     and (new.reopen_reason is null or length(trim(new.reopen_reason)) < 10) then
    raise exception 'Reopening a closed period requires a reason of at least 10 characters.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_travel_period_guard on travel_periods;
create trigger trg_travel_period_guard before update on travel_periods
  for each row execute function travel_guard_period_status();

-- claim number generator
create or replace function travel_next_claim_no(p_company_id uuid)
returns text language plpgsql as $$
declare
  v_year text := to_char(current_date, 'YYYY');
  v_seq  int;
begin
  select coalesce(max(split_part(claim_no, '-', 3)::int), 0) + 1
    into v_seq
    from travel_claims
   where company_id = p_company_id
     and claim_no like 'EXP-' || v_year || '-%';
  return 'EXP-' || v_year || '-' || lpad(v_seq::text, 5, '0');
end;
$$;

create or replace function travel_next_trip_no(p_company_id uuid)
returns text language plpgsql as $$
declare
  v_year text := to_char(current_date, 'YYYY');
  v_seq  int;
begin
  select coalesce(max(split_part(trip_no, '-', 3)::int), 0) + 1
    into v_seq
    from travel_trips
   where company_id = p_company_id
     and trip_no like 'TRP-' || v_year || '-%';
  return 'TRP-' || v_year || '-' || lpad(v_seq::text, 5, '0');
end;
$$;

-- ============================================================================
-- SECTION 8 — VIEWS
-- ============================================================================

-- what an employee has consumed on a date/category, INCLUDING shares of
-- expenses somebody else paid for. this is what stops the group double-claim.
create or replace view v_travel_daily_consumption as
select
  s.employee_id,
  s.expense_date,
  s.type_code,
  sum(s.amount_allocated)        as consumed_amount,
  sum(s.entitlement_contributed) as entitlement_used,
  count(*)                       as line_count,
  bool_or(s.is_payer)            as was_payer
from travel_claim_line_shares s
where s.employee_id is not null
group by s.employee_id, s.expense_date, s.type_code;

create or replace view v_travel_claim_summary as
select
  c.id,
  c.company_id,
  c.claim_no,
  c.employee_id,
  e.emp_code,
  e.full_name,
  c.claim_type,
  c.trip_id,
  t.trip_no,
  p.period_label,
  p.status as period_status,
  c.period_from,
  c.period_to,
  c.total_claimed,
  c.total_approved,
  c.advance_adjusted,
  c.net_payable,
  c.flag_count,
  c.status,
  c.submitted_at,
  c.paid_at,
  (select count(*) from travel_claim_lines l where l.claim_id = c.id) as line_count
from travel_claims c
join employees e on e.id = c.employee_id
left join travel_trips t on t.id = c.trip_id
left join travel_periods p on p.id = c.period_id;

-- ============================================================================
-- SECTION 9 — RLS
-- Follows the existing EZER pattern so the module drops in without breaking
-- your current auth setup.
--
-- NOTE FOR NAYAN: expense data is more sensitive than attendance. Before this
-- goes past pilot, tighten these to: employee reads own rows, RM reads
-- reportees, Finance reads company-wide. Leaving it as a known TODO rather
-- than pretending it is done.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'travel_expense_types','travel_city_class','travel_policies','travel_entitlements',
    'travel_mileage_rates','travel_employee_vehicles','travel_periods','travel_period_audit',
    'travel_trips','travel_trip_travellers','travel_trip_bookings','travel_logs',
    'travel_log_stops','travel_claims','travel_claim_lines','travel_claim_line_shares',
    'travel_attachments','travel_flags','travel_approvals'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_all', t);
    execute format(
      'create policy %I on %I for all to anon, authenticated using (true) with check (true)',
      t || '_all', t);
  end loop;
end $$;

-- ============================================================================
-- END OF MIGRATION 074
-- ============================================================================


-- ============================================================================
-- SECTION 10 — RATE RESOLUTION
-- Mode rate beats vehicle rate; newest effective_from on or before the expense
-- date wins within each. Null means unconfigured, so the caller can flag it
-- rather than silently paying zero.
-- ============================================================================

create or replace function travel_rate_for(
  p_policy_id   uuid,
  p_type_code   text,
  p_vehicle_type text default null,
  p_fuel_type    text default null,
  p_cc_band      text default null,
  p_on_date      date default current_date
)
returns numeric
language plpgsql
stable
as $$
declare
  v_rate numeric;
begin
  -- 1. a rate set against the mode itself
  select rate_per_km into v_rate
    from travel_mileage_rates
   where policy_id = p_policy_id
     and type_code = p_type_code
     and effective_from <= p_on_date
   order by effective_from desc
   limit 1;

  if v_rate is not null then
    return v_rate;
  end if;

  -- 2. otherwise the vehicle rate, when we know the vehicle
  if p_vehicle_type is null then
    return null;
  end if;

  select rate_per_km into v_rate
    from travel_mileage_rates
   where policy_id = p_policy_id
     and type_code is null
     and vehicle_type = p_vehicle_type
     and (p_fuel_type is null or fuel_type = p_fuel_type)
     and (p_cc_band  is null or cc_band  = p_cc_band)
     and effective_from <= p_on_date
   order by effective_from desc
   limit 1;

  return v_rate;
end;
$$;

comment on function travel_rate_for is
  'Rate per km for a mode on a date. Mode rate beats vehicle rate;

-- ============================================================================
-- SECTION 11 — RATE CARD VIEW
-- One row per mode showing the rate in force today and who set it.
-- ============================================================================

create or replace view v_travel_rate_card as
select distinct on (r.policy_id, coalesce(r.type_code, r.vehicle_type || '/' || r.fuel_type))
  r.id,
  p.company_id,
  r.policy_id,
  coalesce(r.type_code, r.vehicle_type || '/' || r.fuel_type) as rate_key,
  r.type_code,
  t.type_name,
  r.vehicle_type,
  r.fuel_type,
  r.cc_band,
  r.rate_per_km,
  r.effective_from,
  r.rate_label,
  r.notes,
  r.set_by,
  e.full_name as set_by_name,
  r.set_at
from travel_mileage_rates r
join travel_policies p on p.id = r.policy_id
left join travel_expense_types t
       on t.company_id = p.company_id and t.type_code = r.type_code
left join employees e on e.id = r.set_by
where r.effective_from <= current_date
order by r.policy_id,
         coalesce(r.type_code, r.vehicle_type || '/' || r.fuel_type),
         r.effective_from desc;

-- RLS for the rate card table (see the note at the top of this file).
do $$
begin
  execute 'alter table travel_mileage_rates enable row level security';
  execute 'drop policy if exists travel_mileage_rates_all on travel_mileage_rates';
  execute 'create policy travel_mileage_rates_all on travel_mileage_rates
             for all to anon, authenticated using (true) with check (true)';
end $$;
