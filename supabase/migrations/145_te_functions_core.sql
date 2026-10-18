-- 145_te_functions_core.sql
-- ============================================================================
-- EZER HRMS — TRAVEL & EXPENSE v2  ·  2 of 6: CORE FUNCTIONS, TRIGGERS, VIEWS, RLS
-- SAFE TO RUN TWICE. Run AFTER 144.
-- ----------------------------------------------------------------------------
-- What is in here
--   1  small helpers        te_fail, te_rs, te_today, te_log, te_next_no
--   2  guards and triggers  updated_at, audit log is append-only, locked period,
--                           settings version, rate history, config audit
--   3  who approves         te_org_chain, te_level_applies, te_resolve_chain
--   4  the workflow builder te_workflow_save, te_workflow_reset, te_finance_deadlock
--   5  config for the app   te_config  (one JSON in the shape the rules engine reads)
--   6  derived statuses     te_trip_status, te_advance_status
--   7  views                queues and summaries
--   8  RLS
--
-- HOW A FUNCTION REFUSES SOMETHING
--   A business rule that says no raises an exception through te_fail(code,
--   message). The message is the sentence the user sees; the code travels in
--   HINT. PostgREST returns it as {code:'P0001', message, hint}. Because it is
--   an exception, everything the function wrote before it is rolled back.
--   The API maps hint 'TE_…' to HTTP 409 (see app-code/lib/te/rpc.ts).
--
-- COLUMNS OF CORE TABLES THIS FILE READS (checked against the repo, 9 Oct 2026)
--   employees: id, company_id, emp_code, full_name, grade, department_id,
--              date_of_leaving, l1_manager_id, l2_manager_id, hod_id
--   departments: id, hod_employee_id          companies: id, md_employee_id, timezone
--   employee_relationships: employee_id, manager_employee_id, relationship_type, valid_to
--   finance_team: company_id, employee_id, can_approve, is_active
--   plpgsql bodies are NOT checked when created. If a name differs on your
--   database the function fails when it runs. database/tests/verify.sql calls
--   each one once so that shows up immediately.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — HELPERS
-- ============================================================================

create or replace function te_fail(p_code text, p_message text)
returns void language plpgsql as $$
begin
  raise exception '%', p_message using errcode = 'P0001', hint = p_code;
end;
$$;

-- ₹1,58,840 — Indian digit grouping, no paise
create or replace function te_rs(p_amount numeric)
returns text language plpgsql immutable as $$
declare
  s text := abs(round(coalesce(p_amount, 0)))::text;
begin
  if length(s) > 3 then
    s := regexp_replace(left(s, length(s) - 3), '(\d)(?=(\d\d)+$)', '\1,', 'g') || ',' || right(s, 3);
  end if;
  return case when coalesce(p_amount, 0) < 0 then '-' else '' end || '₹' || s;
end;
$$;

-- Today, in the company's time zone. A test (or a demo) can pin the date with
--   select set_config('te.today', '2026-11-16', false);
create or replace function te_today(p_company_id uuid default null)
returns date language plpgsql stable as $$
declare
  v_pin text := nullif(current_setting('te.today', true), '');
  v_tz  text;
begin
  if v_pin is not null then
    return v_pin::date;
  end if;
  if p_company_id is not null then
    select nullif(c.timezone, '') into v_tz from companies c where c.id = p_company_id;
  end if;
  return (now() at time zone coalesce(v_tz, 'Asia/Kolkata'))::date;
end;
$$;

-- One row in the audit log. Every function in this module calls this; nothing
-- else writes to te_audit_log.
create or replace function te_log(
  p_company_id  uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_entity_ref  text,
  p_action      text,
  p_actor_id    uuid,
  p_summary     text,
  p_visible     boolean default true,
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_actor_role  text default null
)
returns void language sql as $$
  insert into te_audit_log (company_id, entity_type, entity_id, entity_ref, action, actor_id, actor_role,
                            summary, employee_visible, before, after)
  values (p_company_id, p_entity_type, p_entity_id, p_entity_ref, p_action, p_actor_id, p_actor_role,
          p_summary, coalesce(p_visible, true), p_before, p_after);
$$;

-- The next human number. The counter row is locked by the upsert, so two
-- submits at the same moment never get the same number.
create or replace function te_next_no(p_company_id uuid, p_kind text)
returns text language plpgsql as $$
declare
  v_year int := extract(year from te_today(p_company_id))::int;
  v_key  int := case when p_kind in ('trip','claim') then v_year else 0 end;
  v_no   bigint;
begin
  insert into te_sequences (company_id, kind, year, last_no)
  values (p_company_id, p_kind, v_key, 1)
  on conflict (company_id, kind, year) do update set last_no = te_sequences.last_no + 1
  returning last_no into v_no;

  -- lpad() cuts a longer number short (lpad('10000', 4, '0') is '1000'), so a
  -- number that has outgrown its padding is written out in full: trip 10,000
  -- is TRP-2026-10000
  return case p_kind
    when 'trip'    then 'TRP-' || v_year || '-' || case when v_no < 10000   then lpad(v_no::text, 4, '0') else v_no::text end
    when 'claim'   then 'CLM-' || v_year || '-' || case when v_no < 1000000 then lpad(v_no::text, 6, '0') else v_no::text end
    when 'advance' then 'ADV-' || case when v_no < 10000  then lpad(v_no::text, 4, '0') else v_no::text end
    when 'expense' then 'EXP-' || case when v_no < 100000 then lpad(v_no::text, 5, '0') else v_no::text end
    when 'booking' then 'BKG-' || case when v_no < 10000  then lpad(v_no::text, 4, '0') else v_no::text end
    when 'batch'   then 'PAY-' || case when v_no < 10000  then lpad(v_no::text, 4, '0') else v_no::text end
  end;
end;
$$;

-- The date-of-leaving rule: after the last working day an employee can neither
-- write nor read. (v1 has travel_is_employee_active(), which also reads
-- travel_policies; v2 keeps its own so the two modules do not depend on each
-- other's settings.)
create or replace function te_is_employee_active(p_employee_id uuid, p_on date default null)
returns boolean language plpgsql stable as $$
declare
  v_dol     date;
  v_company uuid;
begin
  select e.date_of_leaving, e.company_id into v_dol, v_company
    from employees e where e.id = p_employee_id;
  if not found then
    return false;
  end if;
  return v_dol is null or coalesce(p_on, te_today(v_company)) <= v_dol;
end;
$$;

create or replace function te_assert_active(p_employee_id uuid)
returns void language plpgsql stable as $$
begin
  if not te_is_employee_active(p_employee_id) then
    perform te_fail('TE_EMPLOYEE_EXITED', 'Your access to Travel and Expenses ended on your last working day.');
  end if;
end;
$$;

create or replace function te_emp_name(p_employee_id uuid)
returns text language sql stable as $$
  select coalesce((select e.full_name from employees e where e.id = p_employee_id), 'EZER');
$$;

-- The expense month a claim is filed into. The month of the date if it is
-- OPEN. Otherwise the claim is late and goes into, in this order: the current
-- month if it is open, the first open month after the date, any open month.
-- (Not simply "the oldest open month": a month nobody closed would then
-- collect every late claim.)
create or replace function te_period_for(p_company_id uuid, p_date date, out period_id uuid, out is_late boolean)
language plpgsql stable as $$
declare
  v_first date := date_trunc('month', p_date)::date;
  v_now   date := date_trunc('month', te_today(p_company_id))::date;
begin
  select p.id into period_id from travel_periods p
   where p.company_id = p_company_id and p.period_month = v_first and p.status = 'OPEN';
  if found then
    is_late := false;
    return;
  end if;
  select p.id into period_id from travel_periods p
   where p.company_id = p_company_id and p.status = 'OPEN'
   order by (p.period_month = v_now) desc, (p.period_month > v_first) desc, p.period_month limit 1;
  if not found then
    perform te_fail('TE_NO_OPEN_PERIOD', 'No expense month is open. Ask Finance to open one.');
  end if;
  is_late := true;
end;
$$;


-- ============================================================================
-- SECTION 2 — GUARDS AND TRIGGERS
-- ============================================================================

create or replace function te_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['te_settings','te_categories','te_modes','te_vehicle_types','te_place_types',
                           'te_stop_reasons','te_grade_policies','te_places','te_employee_vehicles',
                           'te_trips','te_legs','te_claims','te_expenses','te_advances']
  loop
    execute format('drop trigger if exists trg_%1$s_touch on %1$s', t);
    execute format('create trigger trg_%1$s_touch before update on %1$s for each row execute function te_touch_updated_at()', t);
  end loop;
end $$;

-- The audit log is append-only.
create or replace function te_audit_guard()
returns trigger language plpgsql as $$
begin
  raise exception 'te_audit_log is append-only. Rows cannot be changed or deleted.';
end;
$$;
drop trigger if exists trg_te_audit_guard on te_audit_log;
create trigger trg_te_audit_guard before update or delete on te_audit_log
  for each row execute function te_audit_guard();

-- A claim or an expense line in a LOCKED month cannot be changed or deleted.
-- (A month can only be locked when every claim in it is finished, so nothing
-- legitimate is stopped by this.)
create or replace function te_guard_locked_period()
returns trigger language plpgsql as $$
declare
  v_status text;
  v_label  text;
begin
  if old.period_id is null then
    return coalesce(new, old);
  end if;
  select p.status, p.period_label into v_status, v_label from travel_periods p where p.id = old.period_id;
  if v_status = 'LOCKED' then
    raise exception '% is locked. Its claims and expenses can no longer be changed.', coalesce(v_label, 'This month')
      using errcode = 'P0001', hint = 'TE_PERIOD_LOCKED';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_te_claims_locked on te_claims;
create trigger trg_te_claims_locked before update or delete on te_claims
  for each row execute function te_guard_locked_period();
drop trigger if exists trg_te_expenses_locked on te_expenses;
create trigger trg_te_expenses_locked before update or delete on te_expenses
  for each row execute function te_guard_locked_period();

-- A month cannot be LOCKED while it still holds an unfinished v2 claim.
-- SECURITY DEFINER: travel_periods is shared with the old travel module, whose
-- screens update it with the browser key. After 151 that key cannot read
-- te_claims, and this check must still be able to.
create or replace function te_guard_period_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if new.status = 'LOCKED' and old.status <> 'LOCKED' then
    select count(*) into v_n from te_claims c
     where c.period_id = new.id and c.status not in ('SETTLED','REJECTED','CANCELLED');
    if v_n > 0 then
      raise exception '% unfinished claims are in %. Roll them forward first.', v_n, new.period_label
        using errcode = 'P0001', hint = 'TE_PERIOD_HAS_OPEN_CLAIMS';
    end if;
    -- The months are shared with the old travel module. A v1 claim that is
    -- still moving cannot be acted on once its month is locked, so it would be
    -- stuck for good.
    if to_regclass('public.travel_claims') is not null then
      select count(*) into v_n from travel_claims c
       where c.period_id = new.id and c.status not in ('PAID','REJECTED','CANCELLED','DRAFT');
      if v_n > 0 then
        raise exception '% claims of the old travel module are still open in %. Finish them there first.', v_n, new.period_label
          using errcode = 'P0001', hint = 'TE_PERIOD_HAS_OPEN_CLAIMS';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_te_period_lock on travel_periods;
create trigger trg_te_period_lock before update on travel_periods
  for each row execute function te_guard_period_lock();

-- Settings: every change bumps the version and is written to the audit log
-- with the values before and after.
create or replace function te_settings_audit()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'version' - 'updated_at' - 'updated_by' = to_jsonb(old) - 'version' - 'updated_at' - 'updated_by' then
      return new;
    end if;
    new.version := old.version + 1;
    perform te_log(new.company_id, 'settings', null, null, 'SETTINGS_CHANGED', new.updated_by,
                   'Changed Travel and Expense settings (version ' || new.version || ')', false,
                   to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_te_settings_audit on te_settings;
create trigger trg_te_settings_audit before update on te_settings
  for each row execute function te_settings_audit();

-- Masters: one audit row per insert, change or delete.
create or replace function te_master_audit()
returns trigger language plpgsql as $$
declare
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and v_new - 'updated_at' - 'updated_by' = v_old - 'updated_at' - 'updated_by' then
    return new;
  end if;
  perform te_log((v_row->>'company_id')::uuid, tg_table_name, (v_row->>'id')::uuid,
                 coalesce(v_row->>'code', v_row->>'grade', v_row->>'city', v_row->>'area'),
                 'MASTER_' || tg_op, nullif(v_row->>'updated_by', '')::uuid,
                 initcap(tg_op) || ' ' || replace(replace(tg_table_name, 'te_', ''), '_', ' ') || ' '
                   || coalesce(v_row->>'code', v_row->>'grade', v_row->>'city', v_row->>'area', ''),
                 false, v_old, v_new);
  return coalesce(new, old);
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['te_categories','te_modes','te_vehicle_types','te_place_types','te_stop_reasons',
                           'te_grade_policies','te_grade_limits','te_city_tiers','te_checks','te_hubs']
  loop
    execute format('drop trigger if exists trg_%1$s_audit on %1$s', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on %1$s for each row execute function te_master_audit()', t);
  end loop;
end $$;

-- Vehicle rates are never edited silently: the old rate is kept.
create or replace function te_vehicle_rate_history_trg()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT'
     or new.method is distinct from old.method or new.rate_per_km is distinct from old.rate_per_km
     or new.km_per_unit is distinct from old.km_per_unit or new.wear_per_km is distinct from old.wear_per_km then
    insert into te_vehicle_rate_history (vehicle_type_id, company_id, method, rate_per_km, km_per_unit, wear_per_km, set_by)
    values (new.id, new.company_id, new.method, new.rate_per_km, new.km_per_unit, new.wear_per_km, new.updated_by);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_te_vehicle_rate_history on te_vehicle_types;
create trigger trg_te_vehicle_rate_history after insert or update on te_vehicle_types
  for each row execute function te_vehicle_rate_history_trg();


-- ============================================================================
-- SECTION 3 — WHO APPROVES
-- ============================================================================

-- The management chain of one employee.
--
-- EZER keeps the hierarchy in more than one place and they are not always in
-- step (see docs/14-REPO-INTEGRATION-FACTS.md, section 2.3). This function
-- reads them in a fixed order so Travel and Expense gives ONE answer:
--   L1   employee_relationships 'L1'  ->  employees.l1_manager_id
--   L2   employee_relationships 'L2'  ->  employees.l2_manager_id  ->  the L1 of the L1
--   HOD  employee_relationships 'HOD' ->  employees.hod_id  ->  departments.hod_employee_id
--   MD   companies.md_employee_id
-- Nobody is their own manager: a level that resolves to the employee is null,
-- except HOD, where the head of a department is sent to their own manager
-- (or the MD) for that level.
create or replace function te_org_chain(p_employee_id uuid, out l1 uuid, out l2 uuid, out hod uuid, out md uuid)
language plpgsql stable as $$
declare
  e record;
begin
  select x.company_id, x.department_id, x.l1_manager_id, x.l2_manager_id, x.hod_id
    into e from employees x where x.id = p_employee_id;
  if not found then
    return;
  end if;

  select r.manager_employee_id into l1 from employee_relationships r
   where r.employee_id = p_employee_id and r.relationship_type = 'L1' and r.valid_to is null;
  l1 := coalesce(l1, e.l1_manager_id);

  select r.manager_employee_id into l2 from employee_relationships r
   where r.employee_id = p_employee_id and r.relationship_type = 'L2' and r.valid_to is null;
  l2 := coalesce(l2, e.l2_manager_id);
  if l2 is null and l1 is not null then
    select coalesce(
             (select r.manager_employee_id from employee_relationships r
               where r.employee_id = l1 and r.relationship_type = 'L1' and r.valid_to is null),
             (select m.l1_manager_id from employees m where m.id = l1))
      into l2;
  end if;

  select r.manager_employee_id into hod from employee_relationships r
   where r.employee_id = p_employee_id and r.relationship_type = 'HOD' and r.valid_to is null;
  hod := coalesce(hod, e.hod_id,
                  (select d.hod_employee_id from departments d where d.id = e.department_id));

  select c.md_employee_id into md from companies c where c.id = e.company_id;

  if l1  = p_employee_id then l1  := null; end if;
  if l2  = p_employee_id then l2  := null; end if;
  if md  = p_employee_id then md  := null; end if;
  -- a head of department is not their own HOD: that level goes one up
  if hod = p_employee_id then hod := coalesce(l1, md); end if;
end;
$$;

-- Does a level apply? [] means always; otherwise ANY condition being true is enough.
--   ctx = {"total": 42000, "scope": "domestic", "postFacto": false, "exception": false, "band": "Low"}
create or replace function te_level_applies(p_conditions jsonb, p_ctx jsonb)
returns boolean language plpgsql immutable as $$
declare
  c jsonb;
begin
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'array' or jsonb_array_length(p_conditions) = 0 then
    return true;
  end if;
  for c in select * from jsonb_array_elements(p_conditions) loop
    if (c->>'t' = 'amount'    and coalesce((p_ctx->>'total')::numeric, 0) > coalesce((c->>'v')::numeric, 0))
    or (c->>'t' = 'scope'     and p_ctx->>'scope' = c->>'v')
    or (c->>'t' = 'postFacto' and coalesce((p_ctx->>'postFacto')::boolean, false))
    or (c->>'t' = 'exception' and coalesce((p_ctx->>'exception')::boolean, false))
    or (c->>'t' = 'risk'      and p_ctx->>'band' = 'High') then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- The conditions of a level in words. With p_ctx, only the ones that are true.
create or replace function te_conditions_text(p_conditions jsonb, p_ctx jsonb default null)
returns text[] language plpgsql immutable as $$
declare
  c   jsonb;
  out text[] := '{}';
begin
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'array' then
    return out;
  end if;
  for c in select * from jsonb_array_elements(p_conditions) loop
    if p_ctx is not null and not te_level_applies(jsonb_build_array(c), p_ctx) then
      continue;
    end if;
    out := out || case c->>'t'
      when 'amount'    then 'total above ' || te_rs((c->>'v')::numeric)
      when 'scope'     then (c->>'v') || ' trip'
      when 'postFacto' then 'post-facto'
      when 'exception' then 'policy exception'
      when 'risk'      then 'high risk'
      else c->>'t' end;
  end loop;
  return out;
end;
$$;

-- the name a level gets when the admin leaves it blank
create or replace function te_level_label(p_kind text, p_who text, p_person uuid)
returns text language sql stable as $$
  select case
    when p_who = 'person' then (case when p_kind = 'finance' then 'Finance: ' else '' end) || te_emp_name(p_person)
    when p_kind = 'finance' then 'Finance check'
    when p_who = 'rm'  then 'Reporting manager (R1)'
    when p_who = 'rm2' then 'Manager’s manager (R2)'
    else 'Head of department' end;
$$;

-- The saved levels of a workflow as JSON, in the shape the builder and the
-- rules engine use:  [{"id","kind","label","who","person","when":[…]}]
-- (who = rm | rm2 | hod | person | finance)
create or replace function te_levels_json(p_company_id uuid, p_workflow text)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',     l.id,
           'kind',   l.kind,
           'label',  l.label,
           'who',    case l.approver_type when 'finance_team' then 'finance' else l.approver_type end,
           'person', coalesce(l.person_id::text, ''),
           'when',   l.conditions) order by l.seq), '[]'::jsonb)
    from te_workflows w
    join te_workflow_levels l on l.workflow_id = w.id
   where w.company_id = p_company_id and w.code = p_workflow;
$$;

-- The people who can take a "Finance team" step for a company.
create or replace function te_finance_members(p_company_id uuid)
returns uuid[] language sql stable as $$
  select coalesce(array_agg(f.employee_id order by f.created_at, f.employee_id), '{}')
    from finance_team f
   where f.company_id = p_company_id and f.is_active and f.can_approve
     and te_is_employee_active(f.employee_id);
$$;

-- Finance work that moves money or closes books (pay an advance, build or pay a
-- payout batch, close a month, reopen a rejected claim) is done by a member of
-- the company's Finance team. p_disburse = true asks for the stricter right:
-- finance_team.can_disburse ("approving and paying are different acts",
-- migration 053). A company where nobody has can_disburse set is not locked
-- out: there, any member who can approve may also pay.
create or replace function te_assert_finance(p_company_id uuid, p_actor uuid, p_disburse boolean default false)
returns void language plpgsql stable as $$
declare
  f finance_team;
begin
  select * into f from finance_team x
   where x.company_id = p_company_id and x.employee_id = p_actor and x.is_active;
  if not found or not te_is_employee_active(p_actor) then
    perform te_fail('TE_FORBIDDEN', 'Only the Finance team can do this.');
  end if;
  if coalesce(p_disburse, false) and not f.can_disburse
     and exists (select 1 from finance_team x where x.company_id = p_company_id and x.is_active and x.can_disburse) then
    perform te_fail('TE_FORBIDDEN', 'You can verify claims but not release payments. Ask a Finance member who can pay.');
  end if;
  if not coalesce(p_disburse, false) and not f.can_approve then
    perform te_fail('TE_FORBIDDEN', 'Your Finance role can view this but not act on it.');
  end if;
end;
$$;

-- THE CHAIN. Who must approve a trip plan or a claim of this employee, in order.
--
--   p_workflow  'claim' or 'trip'
--   p_ctx       what the conditions are tested against (see te_level_applies)
--   p_co        co-travellers who are employees; none of them may approve it
--   p_levels    null = the saved workflow. The builder passes its unsaved
--               levels here to preview the result before saving.
--
-- Rules, in the order they are applied:
--   1  a level whose conditions are not met is left out
--   2  rm / rm2 / hod are read from te_org_chain(); person is the named employee
--   3  an approver who is the claimant or a co-traveller is replaced: a named
--      person by the fallback approver, a positional one by walking up their
--      own managers (check F1; when F1 is off the positional one stays)
--   4  a level nobody fills goes to the fallback approver
--   5  a step that would land on the claimant is dropped
--   6  a person on two approval levels is asked once, at the LATER level
--   7  finance levels come last and are never merged: a "Finance team" level
--      is a team step (anyone in the team except the claimant); with nobody
--      else in the team it goes to the fallback approver
create or replace function te_resolve_chain(
  p_company_id  uuid,
  p_employee_id uuid,
  p_workflow    text,
  p_ctx         jsonb,
  p_co          uuid[] default '{}',
  p_levels      jsonb  default null
)
returns table (step_no int, stage text, level_id uuid, role_label text, approver_id uuid, team_code text, note text)
language plpgsql stable as $$
declare
  v_levels   jsonb := coalesce(p_levels, te_levels_json(p_company_id, p_workflow));
  v_ctx      jsonb := coalesce(p_ctx, '{}'::jsonb);
  v_co       uuid[] := array[p_employee_id] || coalesce(p_co, '{}');
  v_fallback uuid;
  v_f1       boolean;
  v_chain    record;
  L          jsonb;
  v_who      text;
  v_person   uuid;
  v_w        uuid;
  v_role     text;
  v_note     text;
  v_hit      text[];
  v_guard    int;
  v_was      uuid;
  v_team     uuid[];
  -- collected steps
  m_level uuid[] := '{}'; m_role text[] := '{}'; m_who uuid[] := '{}'; m_note text[] := '{}';
  f_level uuid[] := '{}'; f_role text[] := '{}'; f_who uuid[] := '{}'; f_team text[] := '{}';
  v_keep  boolean[];
  i int; j int; n int := 0;
begin
  select s.fallback_approver_id into v_fallback from te_settings s where s.company_id = p_company_id;
  select coalesce((select k.is_enabled from te_checks k where k.company_id = p_company_id and k.code = 'F1'), true) into v_f1;
  select * into v_chain from te_org_chain(p_employee_id);

  -- the fallback approver, moved up their own line if they are a traveller
  if v_fallback is not null and not te_is_employee_active(v_fallback) then
    v_fallback := null;
  end if;
  v_guard := 0;
  while v_fallback is not null and v_fallback = any (v_co) and v_guard < 6 loop
    select o.l1 into v_fallback from te_org_chain(v_fallback) o;
    v_guard := v_guard + 1;
  end loop;
  if v_fallback = any (v_co) then v_fallback := null; end if;

  for L in select * from jsonb_array_elements(v_levels) loop
    if not te_level_applies(L->'when', v_ctx) then
      continue;
    end if;
    v_who    := L->>'who';
    v_person := nullif(L->>'person', '')::uuid;
    v_role   := coalesce(nullif(btrim(L->>'label'), ''), te_level_label(L->>'kind', v_who, v_person));

    if L->>'kind' = 'finance' and p_workflow = 'claim' then
      if v_who = 'person' then
        v_w := case when v_person is not null and v_person <> p_employee_id and te_is_employee_active(v_person)
                    then v_person else v_fallback end;
        f_level := f_level || nullif(L->>'id', '')::uuid; f_role := f_role || v_role; f_who := f_who || v_w; f_team := f_team || null::text;
      else
        select coalesce(array_agg(x), '{}') into v_team from unnest(te_finance_members(p_company_id)) x where x <> p_employee_id;
        if cardinality(v_team) > 0 then
          f_level := f_level || nullif(L->>'id', '')::uuid; f_role := f_role || v_role; f_who := f_who || null::uuid; f_team := f_team || 'finance'::text;
        else
          f_level := f_level || nullif(L->>'id', '')::uuid; f_role := f_role || (v_role || ' (fallback)'); f_who := f_who || v_fallback; f_team := f_team || null::text;
        end if;
      end if;
      continue;
    elsif L->>'kind' = 'finance' then
      continue;                                        -- a trip plan has no finance level
    end if;

    v_w := case v_who when 'rm' then v_chain.l1 when 'rm2' then v_chain.l2 when 'hod' then v_chain.hod when 'person' then v_person end;
    if v_w is not null and not te_is_employee_active(v_w) then
      v_w := null;                                     -- the approver has left
    end if;

    v_hit  := te_conditions_text(L->'when', v_ctx);
    v_note := case when cardinality(v_hit) > 0 then v_role || ': ' || array_to_string(v_hit, ', ') end;

    if v_w is not null and v_w = any (v_co) then
      v_was := v_w;
      if v_who = 'person' then
        v_w := v_fallback;
      elsif v_f1 then
        v_guard := 0;
        while v_w is not null and v_w = any (v_co) and v_guard < 6 loop
          select o.l1 into v_w from te_org_chain(v_w) o;
          v_guard := v_guard + 1;
        end loop;
        if v_w = any (v_co) then v_w := null; end if;
      end if;
      if v_w is distinct from v_was then
        v_role := v_role || ' (rerouted)';
      end if;
    end if;
    if v_w is null then
      v_w := v_fallback;
      v_role := v_role || ' (fallback)';
    end if;
    if v_w is not null and v_w <> p_employee_id then
      m_level := m_level || nullif(L->>'id', '')::uuid; m_role := m_role || v_role; m_who := m_who || v_w; m_note := m_note || v_note;
    end if;
  end loop;

  -- a person on two approval levels is asked once, at the later level
  v_keep := array_fill(true, array[greatest(cardinality(m_who), 1)]);
  for i in 1 .. cardinality(m_who) loop
    for j in i + 1 .. cardinality(m_who) loop
      if v_keep[i] and m_who[i] = m_who[j] then
        v_keep[i] := false;
        -- the reason the earlier level applied is carried to the level that stays
        if m_note[i] is not null then
          m_note[j] := case when m_note[j] is null then m_note[i] else m_note[i] || '; ' || m_note[j] end;
        end if;
      end if;
    end loop;
  end loop;

  for i in 1 .. cardinality(m_who) loop
    if v_keep[i] then
      n := n + 1;
      step_no := n; stage := 'manager'; level_id := m_level[i]; role_label := m_role[i];
      approver_id := m_who[i]; team_code := null; note := m_note[i];
      return next;
    end if;
  end loop;
  for i in 1 .. cardinality(f_role) loop
    if f_who[i] is not null or f_team[i] is not null then
      n := n + 1;
      step_no := n; stage := 'finance'; level_id := f_level[i]; role_label := f_role[i];
      approver_id := f_who[i]; team_code := f_team[i]; note := null;
      return next;
    end if;
  end loop;
end;
$$;

-- Write the chain of one trip or one claim into te_approval_steps (replacing
-- any steps it had) and return the notes that explain the extra levels.
create or replace function te_build_steps(
  p_company_id  uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_employee_id uuid,
  p_ctx         jsonb,
  p_co          uuid[] default '{}'
)
returns text[] language plpgsql as $$
declare
  v_notes text[] := '{}';
  v_days  int;
  r       record;
begin
  select s.escalate_days into v_days from te_settings s where s.company_id = p_company_id;
  delete from te_approval_steps where entity_type = p_entity_type and entity_id = p_entity_id;
  for r in select * from te_resolve_chain(p_company_id, p_employee_id, p_entity_type, p_ctx, p_co) loop
    insert into te_approval_steps (company_id, entity_type, entity_id, step_no, stage, level_id, role_label, approver_id, team_code, due_at)
    values (p_company_id, p_entity_type, p_entity_id, r.step_no, r.stage, r.level_id, r.role_label, r.approver_id, r.team_code,
            now() + make_interval(days => coalesce(v_days, 5)));
    if r.note is not null then
      v_notes := v_notes || r.note;
    end if;
  end loop;
  return v_notes;
end;
$$;

-- The step that is waiting now: the lowest pending step of a stage.
create or replace function te_current_step(p_entity_type text, p_entity_id uuid, p_stage text default null)
returns te_approval_steps language sql stable as $$
  select s.* from te_approval_steps s
   where s.entity_type = p_entity_type and s.entity_id = p_entity_id and s.status = 'pending'
     and (p_stage is null or s.stage = p_stage)
   order by s.step_no limit 1;
$$;

-- Who a named approver's work goes to today: the approver, or their delegate
-- (ess_role_delegations, migration 071). Without that table it is the approver.
create or replace function te_effective_approver(p_employee_id uuid)
returns uuid language plpgsql stable as $$
begin
  if p_employee_id is null then
    return null;
  end if;
  if to_regprocedure('ess_effective_approver(uuid, timestamptz)') is not null then
    return ess_effective_approver(p_employee_id, now());
  end if;
  return p_employee_id;
end;
$$;

-- Why this person cannot take this step, or '' when they can.
--   · a manager step belongs to the named approver or their live delegate
--   · a finance team step belongs to anyone in the team
--   · FOUR EYES IN FINANCE: nobody verifies two finance levels of one claim,
--     and a person named on a LATER finance level cannot take an earlier team
--     level (they would then be unable to do their own)
--   · a team member with an approval limit (finance_team.approval_limit) cannot
--     take a team step on a claim above it, unless nobody else in the team can
create or replace function te_step_block_reason(p_step te_approval_steps, p_actor uuid)
returns text language plpgsql stable as $$
declare
  v_owner uuid;
  v_later record;
  v_limit numeric;
  v_amt   numeric;
begin
  if p_step.id is null then
    return 'Nothing is waiting here.';
  end if;
  if p_step.team_code is null then
    v_owner := te_effective_approver(p_step.approver_id);
    if p_actor is distinct from p_step.approver_id and p_actor is distinct from v_owner then
      return 'This is waiting for ' || te_emp_name(p_step.approver_id) || ' (' || p_step.role_label || ').';
    end if;
  elsif not (p_actor = any (te_finance_members(p_step.company_id))) then
    return 'This is waiting for the Finance team (' || p_step.role_label || ').';
  end if;

  if p_step.stage = 'finance' then
    if exists (select 1 from te_approval_steps s
                where s.entity_type = p_step.entity_type and s.entity_id = p_step.entity_id
                  and s.stage = 'finance' and s.step_no < p_step.step_no and s.acted_by = p_actor) then
      return 'You verified an earlier finance level of this claim. Another person verifies this one.';
    end if;
    if p_step.team_code is not null and p_step.entity_type = 'claim' then
      select f.approval_limit into v_limit from finance_team f
       where f.company_id = p_step.company_id and f.employee_id = p_actor and f.is_active;
      select c.approved_total into v_amt from te_claims c where c.id = p_step.entity_id;
      if v_limit is not null and coalesce(v_amt, 0) > v_limit
         and exists (select 1 from finance_team f
                      where f.company_id = p_step.company_id and f.is_active and f.can_approve and f.employee_id <> p_actor
                        and (f.approval_limit is null or f.approval_limit >= coalesce(v_amt, 0))
                        and te_is_employee_active(f.employee_id)
                        and f.employee_id <> (select c.employee_id from te_claims c where c.id = p_step.entity_id)) then
        return 'This claim is above your approval limit of ' || te_rs(v_limit) || '. A senior Finance member verifies it.';
      end if;
    end if;
    -- whoever approved the claim as a manager does not also verify it, as long
    -- as somebody else in the team can
    if p_step.team_code is not null and p_step.entity_type = 'claim'
       and exists (select 1 from te_approval_steps s
                    where s.entity_type = 'claim' and s.entity_id = p_step.entity_id and s.stage = 'manager' and s.acted_by = p_actor)
       and exists (select 1 from unnest(te_finance_members(p_step.company_id)) m
                    where m <> p_actor and m <> (select c.employee_id from te_claims c where c.id = p_step.entity_id)) then
      return 'You approved this claim as a manager. Another Finance team member verifies it.';
    end if;
    if p_step.team_code is not null then
      select s.role_label into v_later from te_approval_steps s
       where s.entity_type = p_step.entity_type and s.entity_id = p_step.entity_id
         and s.stage = 'finance' and s.step_no > p_step.step_no and s.status = 'pending'
         and s.team_code is null and s.approver_id = p_actor
       order by s.step_no limit 1;
      if found then
        return 'You are the ' || v_later.role_label || ' on this claim. Another Finance team member verifies first.';
      end if;
    end if;
  end if;
  return '';
end;
$$;


-- ============================================================================
-- SECTION 4 — THE WORKFLOW BUILDER
-- ============================================================================

-- A "Finance team" level followed by a named person who is the only member of
-- the team would never move (four eyes). Returns the sentence, or null.
create or replace function te_finance_deadlock(p_company_id uuid, p_levels jsonb default null, p_team uuid[] default null)
returns text language plpgsql stable as $$
declare
  v_levels jsonb  := coalesce(p_levels, te_levels_json(p_company_id, 'claim'));
  v_team   uuid[] := coalesce(p_team, te_finance_members(p_company_id));
  a jsonb; b jsonb; i int; j int; n int := jsonb_array_length(v_levels);
begin
  if cardinality(v_team) = 0 then
    return null;
  end if;
  for i in 0 .. n - 1 loop
    a := v_levels->i;
    if a->>'kind' = 'finance' and a->>'who' = 'finance' then
      for j in i + 1 .. n - 1 loop
        b := v_levels->j;
        if b->>'kind' = 'finance' and b->>'who' = 'person'
           and not exists (select 1 from unnest(v_team) m where m::text <> b->>'person') then
          return 'The Finance team has only ' || te_emp_name((b->>'person')::uuid) || ', who is also “' || (b->>'label')
                 || '”. Nobody verifies two finance levels of one claim: add another person to the team or change a level.';
        end if;
      end loop;
    end if;
  end loop;
  return null;
end;
$$;

-- Save a workflow. p_levels is the builder's list:
--   [{"kind":"approve|finance","label":"…","who":"rm|rm2|hod|person|finance","person":"<uuid>","when":[…]}]
-- Everything is checked first; nothing is written if a rule says no.
create or replace function te_workflow_save(p_company_id uuid, p_workflow text, p_levels jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  v_out   jsonb := '[]'::jsonb;
  v_wf    uuid;
  v_ver   int;
  L       jsonb;
  c       jsonb;
  v_kind  text; v_who text; v_label text; v_person uuid; v_when jsonb;
  v_seen_fin boolean := false;
  v_n     int := 0;
  v_words text[] := '{}';
  v_dead  text;
begin
  if p_workflow not in ('claim','trip') then
    perform te_fail('TE_WORKFLOW', 'Unknown workflow.');
  end if;
  if p_levels is null or jsonb_typeof(p_levels) <> 'array' then
    p_levels := '[]'::jsonb;
  end if;

  for L in select * from jsonb_array_elements(p_levels) loop
    v_n     := v_n + 1;
    v_kind  := case when p_workflow = 'trip' then 'approve' when L->>'kind' = 'finance' then 'finance' else 'approve' end;
    v_who   := L->>'who';
    v_label := left(btrim(coalesce(L->>'label', '')), 40);
    v_person := case when v_who = 'person' then nullif(L->>'person', '')::uuid end;

    if v_kind = 'finance' and v_who not in ('finance','person') then
      perform te_fail('TE_WORKFLOW', 'Level ' || v_n || ': a finance level is the Finance team or a named person.');
    end if;
    if v_kind = 'approve' and (v_who is null or v_who not in ('rm','rm2','hod','person')) then
      perform te_fail('TE_WORKFLOW', 'Level ' || v_n || ': choose who approves.');
    end if;
    if v_who = 'person' and not exists (select 1 from employees e where e.id = v_person and e.company_id = p_company_id) then
      perform te_fail('TE_WORKFLOW', 'Level ' || v_n || ': choose the person.');
    end if;

    -- keep only the conditions the product knows; an amount must be above zero
    v_when := '[]'::jsonb;
    if jsonb_typeof(L->'when') = 'array' then
      for c in select * from jsonb_array_elements(L->'when') loop
        if c->>'t' = 'amount' then
          if coalesce((c->>'v')::numeric, 0) <= 0 then
            perform te_fail('TE_WORKFLOW', 'Level ' || v_n || ': enter the amount above which this level applies.');
          end if;
          v_when := v_when || jsonb_build_array(jsonb_build_object('t', 'amount', 'v', round((c->>'v')::numeric)));
        elsif c->>'t' = 'scope' and c->>'v' in ('local','domestic','international') then
          v_when := v_when || jsonb_build_array(jsonb_build_object('t', 'scope', 'v', c->>'v'));
        elsif c->>'t' in ('postFacto','exception','risk') and p_workflow = 'claim' then
          v_when := v_when || jsonb_build_array(jsonb_build_object('t', c->>'t'));
        end if;
      end loop;
    end if;

    if v_label = '' then
      v_label := te_level_label(v_kind, v_who, v_person);
    end if;

    if v_kind = 'finance' then
      v_seen_fin := true;
    elsif v_seen_fin then
      perform te_fail('TE_WORKFLOW', 'Finance levels come last, after every approval level.');
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
               'kind', v_kind, 'label', v_label, 'who', v_who, 'person', coalesce(v_person::text, ''), 'when', v_when));
    v_words := v_words || (v_label || case when jsonb_array_length(v_when) > 0
                                           then ' (' || array_to_string(te_conditions_text(v_when), ' or ') || ')' else '' end);
  end loop;

  if p_workflow = 'claim' and not v_seen_fin then
    perform te_fail('TE_WORKFLOW', 'Keep at least one finance level. Finance checks the bills before payout.');
  end if;
  if p_workflow = 'trip' and v_n = 0 then
    perform te_fail('TE_WORKFLOW', 'Keep at least one level. Local trips up to the no-approval distance skip approval anyway.');
  end if;
  if v_n > 8 then
    perform te_fail('TE_WORKFLOW', 'Up to 8 levels.');
  end if;
  if p_workflow = 'claim' then
    v_dead := te_finance_deadlock(p_company_id, v_out);
    if v_dead is not null then
      perform te_fail('TE_WORKFLOW', v_dead);
    end if;
  end if;

  insert into te_workflows (company_id, code, version, updated_by)
  values (p_company_id, p_workflow, 1, p_actor)
  on conflict (company_id, code) do update set version = te_workflows.version + 1, updated_by = p_actor, updated_at = now()
  returning id, version into v_wf, v_ver;

  delete from te_workflow_levels where workflow_id = v_wf;
  insert into te_workflow_levels (workflow_id, seq, kind, label, approver_type, person_id, conditions)
  select v_wf, x.ord::int, x.l->>'kind', x.l->>'label',
         case x.l->>'who' when 'finance' then 'finance_team' else x.l->>'who' end,
         nullif(x.l->>'person', '')::uuid, x.l->'when'
    from jsonb_array_elements(v_out) with ordinality as x(l, ord);

  perform te_log(p_company_id, 'workflow', v_wf, p_workflow, 'WORKFLOW_CHANGED', p_actor,
                 'Changed the ' || case p_workflow when 'claim' then 'expense claim' else 'trip plan' end
                   || ' approval workflow: ' || array_to_string(v_words, ' → '),
                 false, null, jsonb_build_object('version', v_ver, 'levels', v_out));

  return jsonb_build_object('ok', true, 'version', v_ver, 'levels', te_levels_json(p_company_id, p_workflow));
end;
$$;

-- The chains the product ships with:
--   claim  Reporting manager (R1) -> Head of department [above ₹30,000, policy
--          exception or post-facto] -> Finance team
--   trip   Reporting manager (R1) -> Head of department [above ₹30,000 or international]
create or replace function te_default_levels(p_workflow text)
returns jsonb language sql immutable as $$
  select case p_workflow
    when 'claim' then '[
      {"kind":"approve","label":"Reporting manager (R1)","who":"rm","person":"","when":[]},
      {"kind":"approve","label":"Head of department","who":"hod","person":"","when":[{"t":"amount","v":30000},{"t":"exception"},{"t":"postFacto"}]},
      {"kind":"finance","label":"Finance check","who":"finance","person":"","when":[]}
    ]'::jsonb
    when 'trip' then '[
      {"kind":"approve","label":"Reporting manager (R1)","who":"rm","person":"","when":[]},
      {"kind":"approve","label":"Head of department","who":"hod","person":"","when":[{"t":"amount","v":30000},{"t":"scope","v":"international"}]}
    ]'::jsonb
  end;
$$;

create or replace function te_workflow_reset(p_company_id uuid, p_workflow text, p_actor uuid)
returns jsonb language plpgsql as $$
begin
  if p_workflow not in ('claim','trip') then
    perform te_fail('TE_WORKFLOW', 'Unknown workflow.');
  end if;
  return te_workflow_save(p_company_id, p_workflow, te_default_levels(p_workflow), p_actor);
end;
$$;


-- ============================================================================
-- SECTION 5 — CONFIG FOR THE APP
-- One JSON document for a company, in exactly the shape the rules engine reads
-- (engine/te-engine.js, S.cfg). The API loads this once per request and hands it
-- to the engine, so the engine and the admin screens need no table knowledge.
-- database/tests proves that a freshly seeded company returns the engine's own
-- default configuration, key for key.
-- ============================================================================

create or replace function te_config(p_company_id uuid)
returns jsonb language plpgsql stable as $$
declare
  s te_settings;
begin
  select * into s from te_settings where company_id = p_company_id;
  if not found then
    perform te_fail('TE_NOT_SET_UP', 'Travel and Expenses is not set up for this company. Run te_seed_company().');
  end if;

  return s.extra || jsonb_build_object(
    'billAgeDays', s.bill_age_days, 'claimDeadlineDays', s.claim_deadline_days, 'noticeDays', s.notice_days,
    'receiptAbove', s.receipt_above, 'noBillPerDay', s.no_bill_per_day,
    'advanceMaxPct', s.advance_max_pct, 'graceDays', s.grace_days,
    'mileageTol', s.mileage_tolerance_pct, 'estimateTol', s.estimate_tolerance_pct,
    'postFacto', s.post_facto, 'postFactoPerQuarter', s.post_facto_per_quarter,
    'autoApprove', s.auto_approve_on_timeout, 'fastTrack', s.fast_track_amount, 'samplePct', s.sample_pct,
    'reminderDays', s.reminder_days, 'escalateDays', s.escalate_days,
    'fallback', s.fallback_approver_id,
    'intlAir', s.intl_air_estimate, 'domAir', s.dom_air_estimate,
    'clientPerHead', s.client_per_head, 'miscPerClaim', s.misc_per_claim, 'commPerClaim', s.comm_per_claim,
    'defaultGrade', s.default_grade, 'version', s.version
  ) || jsonb_build_object(
    'track', s.gps_rules, 'vehx', s.vehicle_rules, 'fuelPrice', s.fuel_prices,
    'basis', s.limit_basis, 'breach', s.breach_actions, 'weights', s.risk_weights, 'bands', s.risk_bands,
    'zoneA', to_jsonb(s.zone_a_countries),
    'flows', jsonb_build_object(
      'claim', jsonb_build_object('levels', te_levels_json(p_company_id, 'claim')),
      'trip',  jsonb_build_object('levels', te_levels_json(p_company_id, 'trip'))),
    'teams', jsonb_build_object('finance', to_jsonb(te_finance_members(p_company_id))),
    'grades', (select coalesce(jsonb_agg(g.grade order by g.sort_order, g.grade), '[]'::jsonb)
                 from te_grade_policies g where g.company_id = p_company_id),
    'airClass', (select coalesce(jsonb_object_agg(g.grade, g.air_class), '{}'::jsonb)
                   from te_grade_policies g where g.company_id = p_company_id),
    'trainClass', (select coalesce(jsonb_object_agg(g.grade, g.train_class), '{}'::jsonb)
                     from te_grade_policies g where g.company_id = p_company_id),
    'limits', (select coalesce(jsonb_object_agg(x.grade, x.tiers), '{}'::jsonb)
                 from (select l.grade,
                              jsonb_object_agg(l.tier, jsonb_build_object(
                                'hotel', l.hotel_per_night, 'meals', l.meals_per_day, 'conv', l.conveyance_per_day)) as tiers
                         from te_grade_limits l where l.company_id = p_company_id group by l.grade) x),
    'vehicles', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', v.code, 'name', v.name, 'eg', v.example, 'method', v.method, 'rate', v.rate_per_km,
                    'fuel', v.fuel, 'kmpl', v.km_per_unit, 'wear', v.wear_per_km, 'on', v.is_active)
                    order by v.sort_order, v.code), '[]'::jsonb)
                   from te_vehicle_types v where v.company_id = p_company_id),
    'modes', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                    'id', m.code, 'name', m.name, 'icon', m.icon, 'basis', m.basis,
                    'scopes', to_jsonb(array_remove(array[
                       case when m.scope_local then 'local' end,
                       case when m.scope_domestic then 'domestic' end,
                       case when m.scope_international then 'international' end], null)),
                    'gps', m.gps, 'stops', m.stops_allowed, 'ceil', m.fare_ceiling_per_km,
                    'minFare', m.min_fare, 'estKm', m.est_per_km, 'estMin', m.est_min,
                    'cat', m.category_code, 'on', m.is_active))
                    order by m.sort_order, m.code), '[]'::jsonb)
                from te_modes m where m.company_id = p_company_id),
    'ptypes', (select coalesce(jsonb_agg(jsonb_build_object('id', p.code, 'name', p.name, 'on', p.is_active)
                    order by p.sort_order, p.code), '[]'::jsonb)
                 from te_place_types p where p.company_id = p_company_id),
    'stopReasons', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', r.code, 'name', r.name, 'biz', r.is_business, 'dwell', r.typical_minutes, 'on', r.is_active)
                    order by r.sort_order, r.code), '[]'::jsonb)
                      from te_stop_reasons r where r.company_id = p_company_id),
    'checks', (select coalesce(jsonb_agg(jsonb_build_object(
                    'c', k.code, 'layer', k.layer, 't', k.title, 'a', k.action, 's', k.severity,
                    'on', k.is_enabled, 'live', k.is_live)
                    order by k.sort_order, k.code), '[]'::jsonb)
                 from te_checks k where k.company_id = p_company_id),
    -- every category, switched off ones too ("on": false): an old line still needs its name
    'cats', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', c.code, 'name', c.name, 'icon', c.icon, 'needsTrip', c.needs_trip,
                    'proof', c.proof, 'group', c.grp, 'on', c.is_active)
                    order by c.sort_order, c.code), '[]'::jsonb)
               from te_categories c where c.company_id = p_company_id)
  );
end;
$$;

-- The masters that are not settings: city tiers, company places and hubs, in
-- the shape engine.hydrate() takes.
create or replace function te_masters(p_company_id uuid, p_employee_id uuid default null)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'cities', (select coalesce(jsonb_object_agg(t.city, jsonb_build_array(t.tier, coalesce(t.state_code, ''))), '{}'::jsonb)
                 from te_city_tiers t where t.company_id = p_company_id and t.is_active),
    'regions', (select coalesce(jsonb_object_agg(x.hub_region, x.cities), '{}'::jsonb)
                  from (select t.hub_region, jsonb_agg(t.city order by t.city) as cities
                          from te_city_tiers t
                         where t.company_id = p_company_id and t.is_active and t.hub_region is not null
                         group by t.hub_region) x),
    'hubs', (select coalesce(jsonb_object_agg(x.area, x.kinds), '{}'::jsonb)
               from (select h.area, jsonb_object_agg(h.kind, h.place_id) as kinds
                       from te_hubs h where h.company_id = p_company_id group by h.area) x),
    'places', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', p.id, 'src', case when p.owner_employee_id is null then 'saved' else p.source end,
                    'pt', p.place_type, 's', p.short_name, 'name', coalesce(p.name, p.short_name), 'addr', p.address,
                    'city', p.city, 'pin', coalesce(p.pin_code, ''), 'country', p.country,
                    'lat', p.lat, 'lng', p.lng, 'code', p.code, 'owner', p.owner_employee_id)
                    order by (p.owner_employee_id is not null), p.created_at, p.id), '[]'::jsonb)
                 from te_places p
                where p.company_id = p_company_id and p.is_active
                  and (p.owner_employee_id is null or p.owner_employee_id = p_employee_id))
  );
$$;


-- ============================================================================
-- SECTION 6 — STATUSES THAT ARE WORKED OUT, NOT STORED
-- ============================================================================

-- A trip stores DRAFT, PENDING_APPROVAL, SENT_BACK, APPROVED, CLAIMED, CLOSED,
-- CANCELLED or REJECTED. What the employee sees also depends on the legs and
-- on today's date:
--   EXPIRED    still waiting for approval after its start date
--   ONGOING    a leg is running, or one has begun
--   COMPLETED  every leg is closed, or the dates have passed
--   MISSED     a local trip whose day passed with no leg started
create or replace function te_trip_status(p_trip_id uuid)
returns text language plpgsql stable as $$
declare
  t        te_trips;
  v_today  date;
  v_legs   int;
  v_open   int;
  v_run    int;
  v_began  int;
begin
  select * into t from te_trips where id = p_trip_id;
  if not found then
    return null;
  end if;
  v_today := te_today(t.company_id);

  if t.status in ('PENDING_APPROVAL','SENT_BACK') and t.origin <> 'POST_FACTO' and v_today > t.start_date then
    return 'EXPIRED';
  end if;
  if t.status = 'APPROVED' then
    select count(*),
           count(*) filter (where l.status in ('PLANNED','ACTIVE','PAUSED','ENDED')),
           count(*) filter (where l.status in ('ACTIVE','PAUSED')),
           count(*) filter (where l.started_at is not null or l.is_manual or l.status in ('ENDED','SUBMITTED','SKIPPED'))
      into v_legs, v_open, v_run, v_began
      from te_legs l where l.trip_id = p_trip_id and l.status <> 'CANCELLED';
    if v_run > 0 then return 'ONGOING'; end if;
    if v_legs > 0 and v_open = 0 then return 'COMPLETED'; end if;
    if v_today > t.end_date then
      return case when v_began > 0 or t.scope <> 'local' then 'COMPLETED' else 'MISSED' end;
    end if;
    if v_began > 0 then return 'ONGOING'; end if;
  end if;
  return t.status;
end;
$$;

-- An advance still with the employee after its due date plus the grace days
-- shows as RECOVERY_DUE even before the nightly job stores that.
create or replace function te_advance_status(p_advance_id uuid)
returns text language plpgsql stable as $$
declare
  a       te_advances;
  v_grace int;
begin
  select * into a from te_advances where id = p_advance_id;
  if not found then
    return null;
  end if;
  select s.grace_days into v_grace from te_settings s where s.company_id = a.company_id;
  if a.status in ('PAID','PART_SETTLED') and a.outstanding_amount > 0 and a.due_date is not null
     and te_today(a.company_id) > a.due_date + coalesce(v_grace, 0) then
    return 'RECOVERY_DUE';
  end if;
  return a.status;
end;
$$;

-- What an employee still holds from the advance of a trip.
create or replace function te_trip_outstanding(p_trip_id uuid)
returns numeric language sql stable as $$
  select coalesce((select a.outstanding_amount from te_advances a
                    where a.trip_id = p_trip_id and a.status in ('PAID','PART_SETTLED','RECOVERY_DUE')
                    limit 1), 0);
$$;


-- ============================================================================
-- SECTION 7 — VIEWS
-- ============================================================================

-- Trips with the status the employee sees.
create or replace view v_te_trips as
select t.*,
       te_trip_status(t.id)                                   as display_status,
       e.emp_code, e.full_name                                as employee_name,
       (select count(*) from te_legs l where l.trip_id = t.id and l.status <> 'CANCELLED')                         as leg_count,
       (select count(*) from te_legs l where l.trip_id = t.id and l.status in ('PLANNED','ACTIVE','PAUSED','ENDED')) as open_leg_count,
       te_trip_outstanding(t.id)                              as advance_outstanding
  from te_trips t
  join employees e on e.id = t.employee_id;

-- WHAT IS WAITING, AND FOR WHOM. One row per trip or claim that has a pending
-- step, showing only the step whose turn it is. A manager's queue is
--   where approver_id = <me> or effective_approver_id = <me>
-- A Finance person's queue is  where team_code = 'finance' and company_id = <mine>
-- plus the named finance steps; te_step_block_reason() gives the final word.
create or replace view v_te_pending_approvals as
with cur as (
  select distinct on (s.entity_type, s.entity_id) s.*
    from te_approval_steps s
   where s.status = 'pending'
   order by s.entity_type, s.entity_id, s.step_no
)
select cur.id as step_id, cur.company_id, cur.entity_type, cur.entity_id, cur.step_no, cur.stage,
       cur.role_label, cur.approver_id, te_effective_approver(cur.approver_id) as effective_approver_id,
       cur.team_code, cur.due_at,
       coalesce((select max(p.acted_at) from te_approval_steps p
                  where p.entity_type = cur.entity_type and p.entity_id = cur.entity_id and p.step_no < cur.step_no),
                cur.created_at) as waiting_since,
       c.claim_no as ref_no, c.employee_id, e.emp_code, e.full_name as employee_name,
       c.claimed_total as amount, c.status as entity_status, c.risk_band,
       (select count(*) from te_flags f where f.claim_id = c.id and f.is_current and f.status = 'open') as flag_count,
       t.name as trip_name, t.scope
  from cur
  join te_claims c on cur.entity_type = 'claim' and c.id = cur.entity_id
                  and ((cur.stage = 'manager' and c.status = 'IN_APPROVAL')
                    or (cur.stage = 'finance' and c.status in ('IN_VERIFICATION','ON_HOLD')))
  join employees e on e.id = c.employee_id
  left join te_trips t on t.id = c.trip_id
union all
select cur.id, cur.company_id, cur.entity_type, cur.entity_id, cur.step_no, cur.stage,
       cur.role_label, cur.approver_id, te_effective_approver(cur.approver_id),
       cur.team_code, cur.due_at,
       coalesce((select max(p.acted_at) from te_approval_steps p
                  where p.entity_type = cur.entity_type and p.entity_id = cur.entity_id and p.step_no < cur.step_no),
                cur.created_at),
       t.trip_no, t.employee_id, e.emp_code, e.full_name,
       t.estimate_total, t.status, null::text, 0::bigint, t.name, t.scope
  from cur
  join te_trips t on cur.entity_type = 'trip' and t.id = cur.entity_id and t.status = 'PENDING_APPROVAL'
                 -- a plan whose start date passed while it waited can no longer be approved
                 and te_trip_status(t.id) <> 'EXPIRED'
  join employees e on e.id = t.employee_id;

-- One line per claim for lists and the claim register report.
create or replace view v_te_claim_summary as
select c.id, c.company_id, c.claim_no, c.claim_type, c.claim_seq, c.status, c.stage,
       c.employee_id, e.emp_code, e.full_name as employee_name, e.grade, d.dept_name as department,
       c.trip_id, t.trip_no, t.name as trip_name, t.scope,
       p.period_label, p.period_month, c.is_late,
       c.claimed_total, c.eligible_total, c.approved_total, c.advance_adjusted, c.net_amount,
       c.risk_score, c.risk_band, c.is_exception, c.is_post_facto, c.auto_verified, c.sampled,
       (select count(*) from te_expenses x where x.claim_id = c.id) as line_count,
       (select count(*) from te_flags f where f.claim_id = c.id and f.is_current and f.status = 'open') as open_flags,
       cs.role_label as waiting_role, cs.approver_id as waiting_person, cs.team_code as waiting_team,
       c.submitted_at, c.verified_at, c.settled_at, c.paid_ref
  from te_claims c
  join employees e on e.id = c.employee_id
  left join departments d on d.id = e.department_id
  left join te_trips t on t.id = c.trip_id
  left join travel_periods p on p.id = c.period_id
  left join lateral (
    select s.role_label, s.approver_id, s.team_code from te_approval_steps s
     where s.entity_type = 'claim' and s.entity_id = c.id and s.status = 'pending'
       and c.status in ('IN_APPROVAL','IN_VERIFICATION','ON_HOLD')
     order by s.step_no limit 1) cs on true;

-- Expense lines that are saved and not yet in a claim.
create or replace view v_te_unclaimed as
select x.*, t.trip_no, t.name as trip_name
  from te_expenses x
  left join te_trips t on t.id = x.trip_id
 where x.status = 'UNCLAIMED';

-- The advance ledger.
create or replace view v_te_advance_ledger as
select a.*, te_advance_status(a.id) as display_status,
       e.emp_code, e.full_name as employee_name, t.trip_no, t.name as trip_name, t.end_date as trip_end,
       (select coalesce(sum(s.amount), 0) from te_settlements s where s.advance_id = a.id) as settled_amount
  from te_advances a
  join employees e on e.id = a.employee_id
  join te_trips t on t.id = a.trip_id;

-- Verified claims that are waiting for a payout batch.
create or replace view v_te_payable as
select c.id as claim_id, c.company_id, c.claim_no, c.employee_id, e.emp_code, e.full_name as employee_name,
       c.net_amount, c.verified_at,
       e.bank_account_last4, e.ifsc_code
  from te_claims c
  join employees e on e.id = c.employee_id
 where c.status = 'VERIFIED' and c.net_amount > 0;

-- What the Travel Desk still has to book on approved trips.
create or replace view v_te_to_book as
select t.company_id, t.id as trip_id, t.trip_no, t.name as trip_name, t.employee_id,
       'leg'::text as kind, l.id as leg_id, null::int as point_seq, l.leg_date as on_date, l.mode,
       pf.short_name as from_name, pt.short_name as to_name
  from te_trips t
  join te_legs l on l.trip_id = t.id and l.booked_by = 'desk' and l.status = 'PLANNED'
  join te_places pf on pf.id = l.from_place_id
  join te_places pt on pt.id = l.to_place_id
 where t.status = 'APPROVED' and te_today(t.company_id) <= t.end_date
   and not exists (select 1 from te_bookings b where b.leg_id = l.id and b.status <> 'CANCELLED')
union all
select t.company_id, t.id, t.trip_no, t.name, t.employee_id,
       'hotel', null::uuid, p.seq, p.arrive_on, null::text, null::text, pl.short_name
  from te_trips t
  join te_trip_points p on p.trip_id = t.id and p.seq > 0 and not p.is_return
                       and p.arrive_on is not null and coalesce(p.leave_on, p.arrive_on) > p.arrive_on
  join te_places pl on pl.id = p.place_id
 where t.status = 'APPROVED' and t.stay_by = 'desk' and te_today(t.company_id) <= t.end_date
   and not exists (select 1 from te_bookings b where b.trip_id = t.id and b.point_seq = p.seq and b.status <> 'CANCELLED');


-- ============================================================================
-- SECTION 8 — RLS
-- ----------------------------------------------------------------------------
-- Permissive, matching the EZER pattern — and for the same reason migration
-- 050 gives: an ESS employee is not a Supabase auth user, there is no
-- auth.uid() for them, so a policy cannot tell whose row it is. Protection is
-- in the API layer (app-code/lib/te/guard.ts): every route resolves the caller
-- from the signed ESS token and passes that id to these functions, which then
-- refuse what the caller may not do.
--
-- This module holds money decisions and location trails. The optional file is the
-- tighter version (151): it removes anon/authenticated access to the te_ tables so
-- only the service-role key (server routes) can reach them. Apply it once
-- SUPABASE_SERVICE_ROLE_KEY is confirmed set on the deployment.
-- ============================================================================
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'te\_%'
              and c.relname <> 'te_v1_map'              -- bookkeeping of the optional 150; no screen reads it
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', 'allow_all_' || t, t);
    -- once 151 (lock-down) has been applied, re-running this file does not open the tables again
    if to_regprocedure('te_autoseed()') is null then
      execute format('create policy %I on %I for all to anon, authenticated using (true) with check (true)', 'allow_all_' || t, t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
