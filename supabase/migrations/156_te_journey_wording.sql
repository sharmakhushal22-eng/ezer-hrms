-- 156_te_journey_wording.sql — the database says "journey" too.
-- SAFE TO RUN TWICE.
-- ----------------------------------------------------------------------------
-- Users did not understand the word "leg". The screens were changed first, then
-- the rules engine. This is the last source: the SQL functions, which raise the
-- error messages an employee hits when something is refused, and which write
-- the history lines shown under a trip and in the audit log.
--
-- Leaving these behind meant a trip screen that says "Close every journey"
-- above a History card that says "Planned 1 leg, 42.8 km", and a refusal that
-- still said "End the leg that is running first." The word had to move
-- everywhere or nowhere.
--
-- WHAT MOVED, AND WHAT COULD NOT. Postgres has no way to patch a function body,
-- so every function carrying one of these strings is reproduced here in full.
-- Each one was extracted verbatim from the migration that defines it and the
-- word was rewritten INSIDE STRING LITERALS ONLY -- never in an identifier, a
-- column name or a comment. The generator diffs every function against its
-- original, so this file can be checked line by line.
--
-- NOT TOUCHED, because they are data and not copy:
--   p->'legs'                      the payload key the adapter sends
--   te_log(.., 'leg', ..)          the entity_type an audit row is filed under
--   te_timeline('leg', ..)         the same, when history is read back
--   'legs'                         the key of the trip read model, which the
--                                  browser reads as detail.legs
--   'leg'::text as kind            a discriminator in te_trip_outstanding
-- Renaming any of those would be an API change dressed up as a wording change,
-- and would break the screens this is meant to serve.
--
-- te_claim_submit IS REPRODUCED FROM 155, NOT 147. 155 is the live definition
-- and carries the co-traveller change. Had it been taken from 147 this file
-- would have quietly reverted it, which is the kind of thing that is only
-- noticed weeks later when somebody cannot claim a trip they were taken on.
--
-- te_checks: the three G-layer titles that say "Leg" are updated in place at
-- the end, but ONLY where the row still holds the exact seeded default. A
-- company that edited its own wording keeps it.
--
-- STILL SAYING LEG AFTER THIS: the history rows already written. This file
-- changes what is written from now on; it does not rewrite the past. See
-- 157 for that, which is optional and deliberately separate.
-- ============================================================================

-- ============================================================================
-- te_vehicle_remove — from 146_te_functions_trips.sql · 1 string(s)
-- ============================================================================

create or replace function te_vehicle_remove(p_vehicle_id uuid, p_actor uuid, p_admin boolean default false)
returns jsonb language plpgsql as $$
declare
  v te_employee_vehicles;
begin
  select * into v from te_employee_vehicles where id = p_vehicle_id and is_active for update;
  if not found or not (coalesce(p_admin, false) or v.employee_id = p_actor) then
    perform te_fail('TE_VEHICLE', 'Vehicle not found.');
  end if;
  if exists (select 1 from te_legs l where l.vehicle_id = v.id and l.status in ('PLANNED','ACTIVE','PAUSED','ENDED')) then
    perform te_fail('TE_VEHICLE', v.reg_no || ' is on a journey that is not closed yet. Close or skip that journey first.');
  end if;
  update te_employee_vehicles set is_active = false where id = v.id;
  perform te_log(v.company_id, 'vehicle', v.id, v.reg_no, 'VEHICLE_REMOVED', p_actor, 'Removed vehicle ' || v.reg_no);
  return jsonb_build_object('vehicle_id', v.id, 'removed', true);
end;
$$;

-- ============================================================================
-- te__trip_write_parts — from 146_te_functions_trips.sql · 1 string(s)
-- ============================================================================

create or replace function te__trip_write_parts(p_trip te_trips, p jsonb)
returns void language plpgsql as $$
declare
  r     jsonb;
  i     int;
  v_emp uuid;
  v_code text;
begin
  if exists (select 1 from jsonb_array_elements(coalesce(p->'segments', '[]'::jsonb) || coalesce(p->'legs', '[]'::jsonb)) q(item)
              where not exists (select 1 from te_modes m where m.company_id = p_trip.company_id and m.code = q.item->>'mode' and m.is_active)) then
    perform te_fail('TE_TRIP', 'Choose how you travel on every part of the trip.');
  end if;
  delete from te_trip_points   where trip_id = p_trip.id;
  delete from te_trip_segments where trip_id = p_trip.id;
  delete from te_trip_people   where trip_id = p_trip.id;
  delete from te_legs          where trip_id = p_trip.id;

  i := 0;
  for r in select * from jsonb_array_elements(coalesce(p->'points', '[]'::jsonb)) loop
    insert into te_trip_points (trip_id, seq, place_id, place_type, what, arrive_on, leave_on, is_return)
    values (p_trip.id, i, (r->>'place_id')::uuid, nullif(r->>'place_type', ''), nullif(btrim(r->>'what'), ''),
            nullif(r->>'arrive_on', '')::date, nullif(r->>'leave_on', '')::date, coalesce((r->>'is_return')::boolean, false));
    i := i + 1;
  end loop;
  if i < 2 then
    perform te_fail('TE_TRIP', 'A trip needs a start and at least one place to go.');
  end if;

  i := 0;
  for r in select * from jsonb_array_elements(coalesce(p->'segments', '[]'::jsonb)) loop
    insert into te_trip_segments (trip_id, seq, mode, booked_by, vehicle_id, first_mile_mode, last_mile_mode, hub_from_place_id, hub_to_place_id)
    values (p_trip.id, i, r->>'mode', coalesce(nullif(r->>'booked_by', ''), 'self'), nullif(r->>'vehicle_id', '')::uuid,
            nullif(r->>'first_mile_mode', ''), nullif(r->>'last_mile_mode', ''),
            nullif(r->>'hub_from_place_id', '')::uuid, nullif(r->>'hub_to_place_id', '')::uuid);
    i := i + 1;
  end loop;

  -- people travelling together: the count the employee gave must match the list
  i := 0;
  for r in select * from jsonb_array_elements(coalesce(p->'people', '[]'::jsonb)) loop
    v_code := upper(btrim(coalesce(r->>'emp_code', '')));
    if v_code = '' or coalesce(btrim(r->>'name'), '') = '' then
      perform te_fail('TE_PAX', 'Enter the employee ID and name of person ' || (i + 2) || '.');
    end if;
    select e.id into v_emp from employees e where e.company_id = p_trip.company_id and upper(e.emp_code) = v_code;
    if v_emp = p_trip.employee_id then
      perform te_fail('TE_PAX', 'You are already counted. Remove ' || v_code || ' from the list.');
    end if;
    if exists (select 1 from te_trip_people x where x.trip_id = p_trip.id and upper(x.emp_code_entered) = v_code) then
      perform te_fail('TE_PAX', v_code || ' is listed twice.');
    end if;
    insert into te_trip_people (trip_id, seq, employee_id, emp_code_entered, name_entered, found_in_ezer)
    values (p_trip.id, i, v_emp, v_code, btrim(r->>'name'), v_emp is not null);
    i := i + 1;
    v_emp := null;
  end loop;
  if p_trip.pax <> i + 1 then
    perform te_fail('TE_PAX', 'You said ' || p_trip.pax || ' people. List the other ' || (p_trip.pax - 1) || ', or change the number.');
  end if;

  -- the legs, computed by the engine (buildLegs)
  for r in select * from jsonb_array_elements(coalesce(p->'legs', '[]'::jsonb)) loop
    insert into te_legs (company_id, trip_id, employee_id, leg_no, segment_seq, kind, from_place_id, to_place_id, leg_date,
                         purpose, mode, vehicle_id, booked_by, gps_mode, planned_km)
    values (p_trip.company_id, p_trip.id, p_trip.employee_id, (r->>'leg_no')::int, nullif(r->>'segment_seq', '')::int,
            coalesce(nullif(r->>'kind', ''), 'main'), (r->>'from_place_id')::uuid, (r->>'to_place_id')::uuid, (r->>'leg_date')::date,
            p_trip.purpose, r->>'mode', nullif(r->>'vehicle_id', '')::uuid, coalesce(nullif(r->>'booked_by', ''), 'self'),
            coalesce(nullif(r->>'gps_mode', ''), 'track'), coalesce((r->>'planned_km')::numeric, 0));
  end loop;
  if not exists (select 1 from te_legs l where l.trip_id = p_trip.id) then
    perform te_fail('TE_TRIP', 'This plan has no journeys. Choose where you go and how.');
  end if;
end;
$$;

-- ============================================================================
-- te_trip_save — from 146_te_functions_trips.sql · 5 string(s)
-- ============================================================================

create or replace function te_trip_save(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  v_emp      uuid := nullif(p->>'employee_id', '')::uuid;
  v_id       uuid := nullif(p->>'trip_id', '')::uuid;
  v_company  uuid;
  v_today    date;
  t          te_trips;
  v_was      numeric;
  v_km       numeric := coalesce((p->>'planned_km')::numeric, 0);
  v_total    numeric := coalesce((p->>'estimate_total')::numeric, 0);
  v_free_km  numeric;
  v_notes    text[];
  v_steps    int;
  v_old_steps int;
  v_legs     int;
  v_flights  boolean;
  v_edit     boolean := v_id is not null;
  v_answer   text := nullif(btrim(coalesce(p->>'answer', '')), '');
begin
  if v_emp is distinct from p_actor then
    perform te_fail('TE_FORBIDDEN', 'You can only plan your own trips.');
  end if;
  perform te_assert_active(v_emp);
  select company_id into v_company from employees where id = v_emp;
  v_today := te_today(v_company);
  select coalesce((s.gps_rules->>'preApproveKm')::numeric, 0) into v_free_km from te_settings s where s.company_id = v_company;
  if not found then
    perform te_fail('TE_NOT_SET_UP', 'Travel and Expenses is not set up for this company.');
  end if;

  if coalesce(btrim(p->>'name'), '') = '' then perform te_fail('TE_TRIP', 'Give the trip a name.'); end if;
  if coalesce(p->>'scope', '') not in ('local','domestic','international') then perform te_fail('TE_TRIP', 'Choose local, domestic or international.'); end if;
  if coalesce(p->>'pattern', '') not in ('oneway','round','multi') then perform te_fail('TE_TRIP', 'Choose one way, round trip or multi-city.'); end if;
  if nullif(p->>'start_date', '') is null or nullif(p->>'end_date', '') is null then perform te_fail('TE_TRIP', 'Choose the dates of the trip.'); end if;
  if coalesce(btrim(p->>'purpose'), '') = '' then perform te_fail('TE_TRIP', 'Choose why you are travelling.'); end if;
  if p->>'origin' = 'POST_FACTO' and coalesce(btrim(p->>'post_facto_reason'), '') = '' then
    perform te_fail('TE_TRIP', 'Say why this trip was not approved or tracked before.');
  end if;

  if v_edit then
    select * into t from te_trips where id = v_id for update;
    if not found or t.employee_id <> v_emp
       or not (t.status = 'SENT_BACK'
            or (t.status = 'DRAFT' and t.origin = 'POST_FACTO')
            or (t.status = 'APPROVED' and not exists (select 1 from te_approval_steps s where s.entity_type = 'trip' and s.entity_id = t.id))) then
      perform te_fail('TE_TRIP', 'This trip cannot be edited now.');
    end if;
    if exists (select 1 from te_legs l where l.trip_id = t.id and (l.started_at is not null or l.expense_id is not null)) then
      perform te_fail('TE_TRIP', 'A journey already has a GPS record or a report. Delete the draft and record the trip again.');
    end if;
    if t.status = 'SENT_BACK' and v_answer is null then
      perform te_fail('TE_TRIP', 'Tell your approver what you changed.');
    end if;
    v_was := t.estimate_total;
    update te_trips set
        name = btrim(p->>'name'), scope = p->>'scope', pattern = p->>'pattern', purpose = p->>'purpose',
        project = nullif(btrim(p->>'project'), ''), pax = coalesce((p->>'pax')::int, 1),
        stay_by = coalesce(nullif(p->>'stay_by', ''), 'self'),
        start_date = (p->>'start_date')::date, end_date = (p->>'end_date')::date,
        from_label = p->>'from_label', to_label = p->>'to_label', country = nullif(p->>'country', ''),
        estimate = coalesce(p->'estimate', '{}'::jsonb), estimate_total = v_total,
        self_estimate = coalesce((p->>'self_estimate')::numeric, 0), planned_km = v_km,
        advance_requested = case when p->>'scope' = 'local' then 0 else coalesce((p->>'advance')::numeric, 0) end,
        post_facto_reason = nullif(btrim(p->>'post_facto_reason'), ''), post_facto_note = nullif(btrim(p->>'post_facto_note'), '')
      where id = v_id
      returning * into t;
  else
    insert into te_trips (company_id, trip_no, employee_id, name, scope, pattern, origin, purpose, project, pax, stay_by,
                          start_date, end_date, from_label, to_label, country, estimate, estimate_total, self_estimate,
                          planned_km, advance_requested, post_facto_reason, post_facto_note, status)
    values (v_company, te_next_no(v_company, 'trip'), v_emp, btrim(p->>'name'), p->>'scope', p->>'pattern',
            coalesce(nullif(p->>'origin', ''), 'PRE_APPROVED'), p->>'purpose', nullif(btrim(p->>'project'), ''),
            coalesce((p->>'pax')::int, 1), coalesce(nullif(p->>'stay_by', ''), 'self'),
            (p->>'start_date')::date, (p->>'end_date')::date, p->>'from_label', p->>'to_label', nullif(p->>'country', ''),
            coalesce(p->'estimate', '{}'::jsonb), v_total, coalesce((p->>'self_estimate')::numeric, 0), v_km,
            case when p->>'scope' = 'local' then 0 else coalesce((p->>'advance')::numeric, 0) end,
            nullif(btrim(p->>'post_facto_reason'), ''), nullif(btrim(p->>'post_facto_note'), ''), 'DRAFT')
    returning * into t;
  end if;

  perform te__trip_write_parts(t, p);
  select count(*), bool_or(l.mode = 'flight') into v_legs, v_flights from te_legs l where l.trip_id = t.id;

  -- ---- recorded after the travel ------------------------------------------------
  if t.origin = 'POST_FACTO' then
    perform te__trip_mark_manual(t.id, t.post_facto_reason || coalesce(': ' || t.post_facto_note, ''));
    perform te_log(v_company, 'trip', t.id, t.trip_no, case when v_edit then 'TRIP_EDITED' else 'TRIP_RECORDED' end, p_actor,
      case when v_edit then 'Past trip edited.'
           else 'Recorded after travel: ' || v_legs || ' journey' || case when v_legs = 1 then '' else 's' end || ', ' || v_km
                || ' km on the map. Reason: ' || t.post_facto_reason || '.' end);
    return jsonb_build_object('trip_id', t.id, 'trip_no', t.trip_no, 'status', t.status);
  end if;

  perform te__trip_request_advance(t, p_actor);

  -- ---- an edit of a plan that was sent back -------------------------------------
  if v_edit and t.status = 'SENT_BACK' then
    select count(*) into v_old_steps from te_approval_steps s where s.entity_type = 'trip' and s.entity_id = t.id;
    select count(*) into v_steps from te_resolve_chain(v_company, v_emp, 'trip',
             jsonb_build_object('total', v_total, 'scope', t.scope), te_trip_co(t.id));
    if v_total > v_was or v_steps <> v_old_steps then
      v_notes := te_build_steps(v_company, 'trip', t.id, v_emp, jsonb_build_object('total', v_total, 'scope', t.scope), te_trip_co(t.id));
      update te_trips set chain_notes = v_notes where id = t.id;
    end if;
    update te_trips set status = 'PENDING_APPROVAL' where id = t.id;
    insert into te_messages (entity_type, entity_id, author_id, body) values ('trip', t.id, p_actor, v_answer);
    perform te_log(v_company, 'trip', t.id, t.trip_no, 'TRIP_RESUBMITTED', p_actor,
      'Edited and sent again: ' || v_answer || case when v_total > v_was
        then ' Estimate went up from ' || te_rs(v_was) || ' to ' || te_rs(v_total) || ', so approval starts again.' else '' end);
    return jsonb_build_object('trip_id', t.id, 'trip_no', t.trip_no, 'status', 'PENDING_APPROVAL');
  end if;

  -- ---- local, within the distance that needs no approval ------------------------
  if t.scope = 'local' and v_km <= v_free_km then
    perform te__trip_mark_approved(t.id);
    update te_trips set chain_notes = '{}' where id = t.id;
    perform te_log(v_company, 'trip', t.id, t.trip_no, case when v_edit then 'TRIP_EDITED' else 'TRIP_PLANNED' end, p_actor,
      case when v_edit then 'Plan changed.'
           else 'Planned ' || v_legs || ' journey' || case when v_legs = 1 then '' else 's' end || ', ' || v_km
                || ' km. Local travel up to ' || v_free_km || ' km needs no approval.' end);
    return jsonb_build_object('trip_id', t.id, 'trip_no', t.trip_no, 'status', 'APPROVED');
  end if;

  -- ---- everything else goes through the trip workflow ---------------------------
  v_notes := te_build_steps(v_company, 'trip', t.id, v_emp, jsonb_build_object('total', v_total, 'scope', t.scope), te_trip_co(t.id));
  select count(*) into v_steps from te_approval_steps s where s.entity_type = 'trip' and s.entity_id = t.id;
  update te_trips set chain_notes = v_notes,
                      workflow_version = (select w.version from te_workflows w where w.company_id = v_company and w.code = 'trip')
   where id = t.id;

  if v_steps = 0 then
    perform te__trip_mark_approved(t.id);
    perform te_log(v_company, 'trip', t.id, t.trip_no, 'TRIP_PLANNED', p_actor,
      'Planned ' || v_legs || ' journeys, ' || v_km || ' km. No approval level applies to this plan in the workflow.');
    return jsonb_build_object('trip_id', t.id, 'trip_no', t.trip_no, 'status', 'APPROVED');
  end if;

  update te_trips set status = 'PENDING_APPROVAL' where id = t.id;
  perform te__notify_waiting('trip', t.id, 'Trip plan from ' || te_emp_name(v_emp), t.name || ', ' || te_rs(v_total) || ' estimated. Waiting for your approval.', p_actor);
  perform te_log(v_company, 'trip', t.id, t.trip_no, 'TRIP_SUBMITTED', p_actor,
    case when v_edit then 'Plan changed to ' || v_km || ' km. It now needs approval.'
         else 'Sent for approval. ' || v_legs || ' journeys, ' || v_km || ' km by road' || case when v_flights then ' plus flights' else '' end
              || '. Estimate ' || te_rs(v_total)
              || case when t.advance_requested > 0 then ', advance asked ' || te_rs(t.advance_requested) else '' end || '.' end);
  return jsonb_build_object('trip_id', t.id, 'trip_no', t.trip_no, 'status', 'PENDING_APPROVAL', 'steps', v_steps);
end;
$$;

-- ============================================================================
-- te_trip_cancel — from 146_te_functions_trips.sql · 1 string(s)
-- ============================================================================

create or replace function te_trip_cancel(p_trip_id uuid, p_actor uuid, p_admin boolean default false)
returns jsonb language plpgsql as $$
declare
  t       te_trips;
  v_draft boolean;
begin
  select * into t from te_trips where id = p_trip_id for update;
  if not found then
    perform te_fail('TE_TRIP', 'Trip not found.');
  end if;
  if not (coalesce(p_admin, false) or p_actor = t.employee_id
          or exists (select 1 from te_approval_steps s
                      where s.entity_type = 'trip' and s.entity_id = t.id
                        and (s.approver_id = p_actor or te_effective_approver(s.approver_id) = p_actor))) then
    perform te_fail('TE_FORBIDDEN', 'Only the employee or an approver of this trip can cancel it.');
  end if;
  v_draft := t.status = 'DRAFT' and t.origin = 'POST_FACTO';

  if v_draft then
    if exists (select 1 from te_expenses x where x.trip_id = t.id and x.claim_id is not null) then
      perform te_fail('TE_TRIP', 'This trip has a claim. Recall the claim first.');
    end if;
  else
    if t.status not in ('PENDING_APPROVAL','SENT_BACK','APPROVED') then
      perform te_fail('TE_TRIP', 'This trip is ' || lower(replace(t.status, '_', ' ')) || ' and can no longer be cancelled.');
    end if;
    if exists (select 1 from te_legs l where l.trip_id = t.id and (l.started_at is not null or l.expense_id is not null)) then
      perform te_fail('TE_TRIP', 'This trip has started and can no longer be cancelled. Skip the journeys you did not take.');
    end if;
    if exists (select 1 from te_expenses x where x.trip_id = t.id and x.paid_by = 'self'
                 and x.status not in ('UNCLAIMED','REJECTED_REFILE','EXPIRED','DISCARDED')) then
      perform te_fail('TE_TRIP', 'This trip has a claim. Recall the claim first.');
    end if;
  end if;

  update te_expenses set status = 'DISCARDED' where trip_id = t.id and status = 'UNCLAIMED';
  update te_legs set status = 'CANCELLED' where trip_id = t.id and status in ('PLANNED','ACTIVE','PAUSED','ENDED');
  update te_approval_steps set status = 'cancelled' where entity_type = 'trip' and entity_id = t.id and status = 'pending';
  update te_advances set status = case when outstanding_amount > 0 then 'RECOVERY_DUE' else 'CANCELLED' end
   where trip_id = t.id and status not in ('REJECTED','CANCELLED','SETTLED');
  update te_trips set status = 'CANCELLED' where id = t.id;
  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'TRIP_CANCELLED', p_actor,
                 case when v_draft then 'Draft removed.' else 'Trip cancelled.' end);
  return jsonb_build_object('trip_id', t.id, 'status', 'CANCELLED', 'deleted', v_draft);
end;
$$;

-- ============================================================================
-- te_expense_discard — from 146_te_functions_trips.sql · 1 string(s)
-- ============================================================================

create or replace function te_expense_discard(p_expense_id uuid, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  x te_expenses;
begin
  select * into x from te_expenses where id = p_expense_id for update;
  if not found or x.employee_id <> p_actor then
    perform te_fail('TE_EXPENSE', 'Expense not found.');
  end if;
  if x.status <> 'UNCLAIMED' or x.paid_by <> 'self' then
    perform te_fail('TE_EXPENSE', 'Only a saved line that is not in a claim can be removed.');
  end if;
  if exists (select 1 from te_legs l where l.expense_id = x.id) then
    perform te_fail('TE_EXPENSE', 'This line is the report of a journey. Change the fare in the journey instead.');
  end if;
  update te_expenses set status = 'DISCARDED' where id = x.id;
  perform te_log(x.company_id, 'expense', x.id, x.expense_no, 'EXPENSE_DISCARDED', p_actor, 'Removed expense line');
  return jsonb_build_object('expense_id', x.id, 'status', 'DISCARDED');
end;
$$;

-- ============================================================================
-- te__leg_for_actor — from 146_te_functions_trips.sql · 1 string(s)
-- ============================================================================

create or replace function te__leg_for_actor(p_leg_id uuid, p_actor uuid)
returns te_legs language plpgsql as $$
declare
  l te_legs;
begin
  select * into l from te_legs where id = p_leg_id for update;
  if not found or l.employee_id is distinct from p_actor then
    perform te_fail('TE_LEG', 'Journey not found.');
  end if;
  perform te_assert_active(p_actor);
  return l;
end;
$$;

-- ============================================================================
-- te__leg_log — from 146_te_functions_trips.sql · 1 string(s)
-- ============================================================================

create or replace function te__leg_log(l te_legs, p_action text, p_summary text, p_actor uuid)
returns void language sql as $$
  select te_log(l.company_id, 'leg', l.id,
                (select t.trip_no from te_trips t where t.id = l.trip_id) || ' journey ' || l.leg_no,
                p_action, p_actor, p_summary);
$$;

-- ============================================================================
-- te__after_leg — from 146_te_functions_trips.sql · 1 string(s)
-- ============================================================================

create or replace function te__after_leg(p_trip_id uuid, p_actor uuid)
returns void language plpgsql as $$
declare
  t te_trips;
begin
  if exists (select 1 from te_legs l where l.trip_id = p_trip_id and l.status in ('PLANNED','ACTIVE','PAUSED','ENDED')) then
    return;
  end if;
  select * into t from te_trips where id = p_trip_id;
  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'LEGS_CLOSED', p_actor, 'All journeys are closed.');
  if not exists (select 1 from te_expenses x where x.trip_id = t.id and x.status = 'UNCLAIMED' and x.paid_by = 'self')
     and not exists (select 1 from te_claims c where c.trip_id = t.id and c.status <> 'CANCELLED') then
    update te_trips set status = 'CLOSED' where id = t.id and status in ('APPROVED','DRAFT');
    perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'TRIP_CLOSED', null, 'Nothing to claim on this trip. Closed.');
  end if;
end;
$$;

-- ============================================================================
-- te_leg_start — from 146_te_functions_trips.sql · 7 string(s)
-- ============================================================================

create or replace function te_leg_start(p_leg_id uuid, p_actor uuid, p_fix jsonb)
returns jsonb language plpgsql as $$
declare
  l        te_legs := te__leg_for_actor(p_leg_id, p_actor);
  t        te_trips;
  v_ts     text;
  v_today  date;
  v_prev   int;
  v_at     timestamptz := coalesce(nullif(p_fix->>'recorded_at', '')::timestamptz, now());
  v_off    int;
  v_name   text;
begin
  if l.status <> 'PLANNED' then
    perform te_fail('TE_LEG', 'This journey cannot be started.');
  end if;
  if p_fix->>'lat' is null or p_fix->>'lng' is null then
    perform te_fail('TE_GPS', 'Your location is needed to start. Turn on location and try again.');
  end if;
  select * into t from te_trips where id = l.trip_id;
  v_today := te_today(l.company_id);
  v_ts := te_trip_status(t.id);
  if v_ts not in ('APPROVED','ONGOING') then
    perform te_fail('TE_LEG', case v_ts when 'PENDING_APPROVAL' then 'The trip is waiting for approval.'
                                       when 'MISSED' then 'The day of this trip has passed. Add it without GPS.'
                                       else 'The trip is not open for travel.' end);
  end if;
  select min(k.leg_no) into v_prev from te_legs k
   where k.trip_id = l.trip_id and k.leg_no < l.leg_no and k.status in ('PLANNED','ACTIVE','PAUSED');
  if v_prev is not null then
    perform te_fail('TE_LEG', 'Finish or skip journey ' || v_prev || ' first.');
  end if;
  if v_today > t.end_date + 1 then
    perform te_fail('TE_LEG', 'The trip dates are over. Add this journey without GPS, or skip it.');
  end if;
  if l.leg_date > v_today then
    perform te_fail('TE_LEG', 'This journey is planned for ' || to_char(l.leg_date, 'Dy, FMDD Mon') || '.');
  end if;
  if exists (select 1 from te_legs k where k.employee_id = l.employee_id and k.status in ('ACTIVE','PAUSED')) then
    perform te_fail('TE_LEG_RUNNING', 'End the journey that is running first.');
  end if;

  v_off := te_off_m(l.from_place_id, (p_fix->>'lat')::numeric, (p_fix->>'lng')::numeric);
  begin
    update te_legs set status = 'ACTIVE', started_at = v_at, leg_date = v_today,
           start_lat = (p_fix->>'lat')::numeric, start_lng = (p_fix->>'lng')::numeric,
           start_accuracy_m = nullif(p_fix->>'accuracy_m', '')::numeric, start_address = nullif(p_fix->>'address', ''),
           start_off_m = v_off, device = p_fix->'device'
     where id = l.id;
  exception when unique_violation then
    -- two starts at the same moment: the index uq_te_leg_running let one through
    perform te_fail('TE_LEG_RUNNING', 'End the journey that is running first.');
  end;
  insert into te_leg_pings (leg_id, seq, recorded_at, lat, lng, accuracy_m, is_mock)
  values (l.id, 1, v_at, (p_fix->>'lat')::numeric, (p_fix->>'lng')::numeric, nullif(p_fix->>'accuracy_m', '')::numeric,
          nullif(p_fix->>'is_mock', '')::boolean)
  on conflict do nothing;

  select p.short_name into v_name from te_places p where p.id = l.from_place_id;
  perform te__leg_log(l, 'LEG_STARTED',
    case when l.gps_mode = 'checkin' then 'Checked in at ' else 'Journey started at ' end || coalesce(v_name, 'the start')
      || '. GPS fix within ' || coalesce(round((p_fix->>'accuracy_m')::numeric)::text, '?') || ' m, '
      || v_off || ' m from the planned point.', p_actor);
  return jsonb_build_object('leg_id', l.id, 'status', 'ACTIVE', 'start_off_m', v_off);
end;
$$;

-- ============================================================================
-- te_leg_pings_add — from 146_te_functions_trips.sql · 2 string(s)
-- ============================================================================

create or replace function te_leg_pings_add(p_leg_id uuid, p_actor uuid, p_pings jsonb)
returns jsonb language plpgsql as $$
declare
  l      te_legs;
  v_base int;
  v_n    int;
begin
  select * into l from te_legs where id = p_leg_id;
  if not found or l.employee_id is distinct from p_actor then
    perform te_fail('TE_LEG', 'Journey not found.');
  end if;
  if l.status not in ('ACTIVE','PAUSED','ENDED') or l.started_at is null then
    perform te_fail('TE_LEG', 'This journey is not recording.');
  end if;
  select coalesce(max(seq), 0) into v_base from te_leg_pings where leg_id = l.id;
  insert into te_leg_pings (leg_id, seq, recorded_at, lat, lng, accuracy_m, speed_kmh, is_mock)
  select l.id, v_base + row_number() over (order by (x->>'recorded_at')::timestamptz),
         (x->>'recorded_at')::timestamptz, (x->>'lat')::numeric, (x->>'lng')::numeric,
         nullif(x->>'accuracy_m', '')::numeric, nullif(x->>'speed_kmh', '')::numeric, nullif(x->>'is_mock', '')::boolean
    from jsonb_array_elements(coalesce(p_pings, '[]'::jsonb)) x
   where x->>'lat' is not null and x->>'lng' is not null and x->>'recorded_at' is not null
     and (x->>'recorded_at')::timestamptz >= l.started_at
     and (l.ended_at is null or (x->>'recorded_at')::timestamptz <= l.ended_at)
     -- a batch sent twice after a timeout adds nothing: a fix the leg already has is skipped
     and not exists (select 1 from te_leg_pings g where g.leg_id = l.id and g.recorded_at = (x->>'recorded_at')::timestamptz);
  get diagnostics v_n = row_count;
  return jsonb_build_object('leg_id', l.id, 'stored', v_n, 'total', v_base + v_n);
end;
$$;

-- ============================================================================
-- te_leg_stop_add — from 146_te_functions_trips.sql · 3 string(s)
-- ============================================================================

create or replace function te_leg_stop_add(p_leg_id uuid, p_actor uuid, p_stop jsonb)
returns jsonb language plpgsql as $$
declare
  l    te_legs := te__leg_for_actor(p_leg_id, p_actor);
  m    te_modes;
  r    te_stop_reasons;
  v_seq int;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_stop->>'note', '')), '');
begin
  if l.status = 'PAUSED' then
    perform te_fail('TE_STOP', 'You are already at a stop. Tap Continue first.');
  end if;
  if l.status <> 'ACTIVE' then
    perform te_fail('TE_STOP', 'Start the journey first.');
  end if;
  select * into m from te_modes where company_id = l.company_id and code = l.mode;
  if not coalesce(m.stops_allowed, false) then
    perform te_fail('TE_STOP', case when l.mode = 'flight'
      then 'A stop cannot be added during a flight. A connecting flight is a journey of its own.'
      else 'On a ' || lower(coalesce(m.name, 'ride like this')) || ' the stops are the operator’s. If you get off, end this journey and start a new one.' end);
  end if;
  select * into r from te_stop_reasons where company_id = l.company_id and code = p_stop->>'reason_code' and is_active;
  if not found then
    perform te_fail('TE_STOP', 'Choose why you stopped.');
  end if;
  if r.code = 'other' and v_note is null then
    perform te_fail('TE_STOP', 'Say why you stopped.');
  end if;
  if p_stop->>'lat' is null or p_stop->>'lng' is null then
    perform te_fail('TE_GPS', 'Your location is needed to add a stop.');
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq from te_leg_stops where leg_id = l.id;
  insert into te_leg_stops (leg_id, seq, reason_code, is_business, note, lat, lng, accuracy_m, place_name, address, started_at)
  values (l.id, v_seq, r.code, r.is_business, v_note, (p_stop->>'lat')::numeric, (p_stop->>'lng')::numeric,
          nullif(p_stop->>'accuracy_m', '')::numeric, nullif(p_stop->>'place_name', ''), nullif(p_stop->>'address', ''),
          coalesce(nullif(p_stop->>'recorded_at', '')::timestamptz, now()))
  returning id into v_id;
  update te_legs set status = 'PAUSED' where id = l.id;
  perform te__leg_log(l, 'STOP_ADDED', 'Stopped at ' || coalesce(nullif(p_stop->>'place_name', ''), 'a point on the way') || ': ' || r.name
                                         || coalesce(', ' || v_note, '') || '.', p_actor);
  return jsonb_build_object('leg_id', l.id, 'stop_id', v_id, 'seq', v_seq, 'status', 'PAUSED');
end;
$$;

-- ============================================================================
-- te_leg_end — from 146_te_functions_trips.sql · 3 string(s)
-- ============================================================================

create or replace function te_leg_end(p_leg_id uuid, p_actor uuid, p_fix jsonb, p_stats jsonb default null)
returns jsonb language plpgsql as $$
declare
  l      te_legs := te__leg_for_actor(p_leg_id, p_actor);
  v_at   timestamptz := coalesce(nullif(p_fix->>'recorded_at', '')::timestamptz, now());
  v_off  int;
  v_km   numeric;
  v_n    int;
  v_name text;
begin
  if l.status not in ('ACTIVE','PAUSED') then
    perform te_fail('TE_LEG', 'This journey is not running.');
  end if;
  if p_fix->>'lat' is null or p_fix->>'lng' is null then
    perform te_fail('TE_GPS', 'Your location is needed to end the journey.');
  end if;
  if l.status = 'PAUSED' then
    perform te_leg_stop_end(l.id, p_actor, null, v_at);
  end if;

  select coalesce(max(seq), 0) into v_n from te_leg_pings where leg_id = l.id;
  insert into te_leg_pings (leg_id, seq, recorded_at, lat, lng, accuracy_m)
  values (l.id, v_n + 1, v_at, (p_fix->>'lat')::numeric, (p_fix->>'lng')::numeric, nullif(p_fix->>'accuracy_m', '')::numeric);

  v_off := te_off_m(l.to_place_id, (p_fix->>'lat')::numeric, (p_fix->>'lng')::numeric);
  v_km  := coalesce(nullif(p_stats->>'gps_km', '')::numeric,
                    case when l.gps_mode = 'checkin' then l.planned_km else te_leg_distance_km(l.id) end);
  update te_legs set status = 'ENDED', ended_at = v_at,
         end_lat = (p_fix->>'lat')::numeric, end_lng = (p_fix->>'lng')::numeric,
         end_accuracy_m = nullif(p_fix->>'accuracy_m', '')::numeric, end_address = nullif(p_fix->>'address', ''), end_off_m = v_off,
         gps_km = v_km,
         route_km = coalesce(nullif(p_stats->>'route_km', '')::numeric, l.planned_km),
         payable_km = nullif(p_stats->>'payable_km', '')::numeric,
         gps_points = coalesce(nullif(p_stats->>'gps_points', '')::int, v_n + 1),
         gps_gap_max_sec = nullif(p_stats->>'gps_gap_max_sec', '')::int,
         gps_max_speed_kmh = nullif(p_stats->>'gps_max_speed_kmh', '')::numeric,
         moving_minutes = nullif(p_stats->>'moving_minutes', '')::int,
         route_polyline = nullif(p_stats->>'route_polyline', ''),
         stats = case when jsonb_typeof(p_stats->'stats') = 'object' then p_stats->'stats' end
   where id = l.id;

  select p.short_name into v_name from te_places p where p.id = l.to_place_id;
  perform te__leg_log(l, 'LEG_ENDED',
    case when l.gps_mode = 'checkin'
         then 'Checked in at ' || coalesce(v_name, 'the destination') || ' on arrival. ' || v_km || case when l.mode = 'flight' then ' km by air.' else ' km on the map.' end
         else 'Journey ended at ' || coalesce(v_name, 'the destination') || '. ' || v_km || ' km recorded from ' || (v_n + 1) || ' location points.' end
      || ' ' || v_off || ' m from the planned point.', p_actor);
  return jsonb_build_object('leg_id', l.id, 'status', 'ENDED', 'gps_km', v_km, 'end_off_m', v_off);
end;
$$;

-- ============================================================================
-- te_leg_file — from 146_te_functions_trips.sql · 5 string(s)
-- ============================================================================

create or replace function te_leg_file(p_leg_id uuid, p_actor uuid, p_expense jsonb default null)
returns jsonb language plpgsql as $$
declare
  l        te_legs := te__leg_for_actor(p_leg_id, p_actor);
  m        te_modes;
  x        te_expenses;
  v_booked boolean;
begin
  if l.status <> 'ENDED' then
    perform te_fail('TE_LEG', 'End the journey first.');
  end if;
  select * into m from te_modes where company_id = l.company_id and code = l.mode;
  v_booked := exists (select 1 from te_bookings b where b.leg_id = l.id and b.status <> 'CANCELLED');

  if m.basis = 'none' or (m.basis = 'ticket' and l.booked_by = 'desk' and v_booked) then
    update te_legs set status = 'SUBMITTED', filed_at = now() where id = l.id;
    perform te__leg_log(l, 'LEG_FILED', case when m.basis = 'none' then 'Journey closed. Company vehicle, nothing to claim.'
                                             else 'Journey closed. The ticket was booked and paid by the company.' end, p_actor);
  else
    if p_expense is null then
      perform te_fail('TE_LEG', 'Add what you paid for this journey.');
    end if;
    x := te__expense_write(p_expense || jsonb_build_object(
           'expense_id', null, 'employee_id', l.employee_id, 'trip_id', l.trip_id, 'leg_id', l.id, 'paid_by', 'self',
           'expense_date', l.leg_date, 'vehicle_id', l.vehicle_id,
           'from_place_id', l.from_place_id, 'to_place_id', l.to_place_id), p_actor);
    update te_legs set status = 'SUBMITTED', filed_at = now(), expense_id = x.id,
                       payable_km = coalesce(x.payable_km, payable_km) where id = l.id;
    perform te__leg_log(l, 'LEG_FILED', 'Journey report saved. ' || te_rs(x.claimed_amount) || ' claimed.', p_actor);
  end if;
  perform te__after_leg(l.trip_id, p_actor);
  return jsonb_build_object('leg_id', l.id, 'status', 'SUBMITTED', 'expense_id', x.id,
                            'trip_status', te_trip_status(l.trip_id));
end;
$$;

-- ============================================================================
-- te_leg_skip — from 146_te_functions_trips.sql · 2 string(s)
-- ============================================================================

create or replace function te_leg_skip(p_leg_id uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql as $$
declare
  l te_legs := te__leg_for_actor(p_leg_id, p_actor);
begin
  if l.status <> 'PLANNED' then
    perform te_fail('TE_LEG', 'Only a journey that has not started can be skipped.');
  end if;
  if not exists (select 1 from te_trips t where t.id = l.trip_id and t.status = 'APPROVED') then
    perform te_fail('TE_LEG', 'The trip is not open for travel.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    perform te_fail('TE_COMMENT', 'Say why this journey was not needed.');
  end if;
  update te_legs set status = 'SKIPPED', skip_reason = btrim(p_reason) where id = l.id;
  perform te__leg_log(l, 'LEG_SKIPPED', 'Skipped: ' || btrim(p_reason) || '.', p_actor);
  perform te__after_leg(l.trip_id, p_actor);
  return jsonb_build_object('leg_id', l.id, 'status', 'SKIPPED', 'trip_status', te_trip_status(l.trip_id));
end;
$$;

-- ============================================================================
-- te_leg_no_gps — from 146_te_functions_trips.sql · 4 string(s)
-- ============================================================================

create or replace function te_leg_no_gps(p_leg_id uuid, p_actor uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql as $$
declare
  l       te_legs := te__leg_for_actor(p_leg_id, p_actor);
  t       te_trips;
  v_rules jsonb;
  v_today date;
  v_used  int;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if l.status <> 'PLANNED' then
    perform te_fail('TE_LEG', 'This journey cannot be added now.');
  end if;
  select * into t from te_trips where id = l.trip_id;
  if t.status <> 'APPROVED' then
    perform te_fail('TE_LEG', case when t.status = 'PENDING_APPROVAL' then 'The trip is waiting for approval.' else 'The trip is not open for travel.' end);
  end if;
  select s.gps_rules into v_rules from te_settings s where s.company_id = l.company_id;
  v_today := te_today(l.company_id);
  if l.leg_date > v_today then
    perform te_fail('TE_LEG', 'This journey is in the future.');
  end if;
  if not coalesce((v_rules->>'manualAllowed')::boolean, true) then
    perform te_fail('TE_LEG', 'Your company accepts journeys only with a GPS record.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    perform te_fail('TE_COMMENT', 'Say why GPS was not used.');
  end if;
  if btrim(p_reason) = 'Other' and v_note is null then
    perform te_fail('TE_COMMENT', 'Tell your approver what happened.');
  end if;
  if t.scope = 'local' then
    if v_today - l.leg_date > coalesce((v_rules->>'pastDays')::int, 7) then
      perform te_fail('TE_LEG', 'Older than ' || coalesce((v_rules->>'pastDays')::int, 7) || ' days. It can no longer be added.');
    end if;
    select count(*) into v_used from te_legs k join te_trips kt on kt.id = k.trip_id
     where k.employee_id = l.employee_id and k.is_manual and k.status <> 'CANCELLED' and kt.scope = 'local'
       and date_trunc('month', k.leg_date) = date_trunc('month', l.leg_date);
    if v_used >= coalesce((v_rules->>'pastPerMonth')::int, 5) then
      perform te_fail('TE_LEG', 'You have added ' || v_used || ' journeys without GPS in ' || to_char(l.leg_date, 'FMMonth')
                                || '. The limit is ' || coalesce((v_rules->>'pastPerMonth')::int, 5) || '.');
    end if;
  end if;
  update te_legs set status = 'ENDED', is_manual = true, no_gps_reason = btrim(p_reason) || coalesce(': ' || v_note, ''),
                     ended_at = l.leg_date::timestamptz
   where id = l.id;
  perform te__leg_log(l, 'LEG_NO_GPS', 'Added without GPS. Reason: ' || btrim(p_reason) || coalesce(': ' || v_note, '') || '.', p_actor);
  return jsonb_build_object('leg_id', l.id, 'status', 'ENDED');
end;
$$;

-- ============================================================================
-- te_leg_add — from 146_te_functions_trips.sql · 6 string(s)
-- ============================================================================

create or replace function te_leg_add(p_trip_id uuid, p_actor uuid, p_leg jsonb)
returns jsonb language plpgsql as $$
declare
  t       te_trips;
  m       te_modes;
  v_ts    text;
  v_today date;
  v_at    int;
  v_from  uuid := nullif(p_leg->>'from_place_id', '')::uuid;
  v_to    uuid := nullif(p_leg->>'to_place_id', '')::uuid;
  v_veh   uuid := nullif(p_leg->>'vehicle_id', '')::uuid;
  v_why   text := nullif(btrim(coalesce(p_leg->>'why', '')), '');
  v_id    uuid;
  nx      te_legs;
  l       te_legs;
begin
  select * into t from te_trips where id = p_trip_id for update;
  if not found or t.employee_id is distinct from p_actor then
    perform te_fail('TE_TRIP', 'Trip not found.');
  end if;
  perform te_assert_active(p_actor);
  v_today := te_today(t.company_id);
  v_ts := te_trip_status(t.id);
  if v_ts not in ('APPROVED','ONGOING','COMPLETED') or v_today < t.start_date or v_today > t.end_date + 1 then
    perform te_fail('TE_LEG', 'Journeys can be added only during the trip.');
  end if;
  if v_from is null or v_to is null or not exists (select 1 from te_places where id = v_from) or not exists (select 1 from te_places where id = v_to) then
    perform te_fail('TE_LEG', 'Choose where the journey starts and ends.');
  end if;
  if v_from = v_to then
    perform te_fail('TE_LEG', 'Start and end are the same place.');
  end if;
  select * into m from te_modes where company_id = t.company_id and code = p_leg->>'mode';
  if not found or not m.is_active
     or not (case t.scope when 'local' then m.scope_local when 'domestic' then m.scope_domestic else m.scope_international end) then
    perform te_fail('TE_LEG', 'Choose a way of travel allowed on this trip.');
  end if;
  if m.code = 'own' and v_veh is null then
    perform te_fail('TE_LEG', 'Choose your vehicle.');
  end if;

  select coalesce(max(k.leg_no), 0) + 1 into v_at from te_legs k where k.trip_id = t.id and k.status <> 'PLANNED';
  update te_legs set leg_no = leg_no + 1 where trip_id = t.id and leg_no >= v_at;

  insert into te_legs (company_id, trip_id, employee_id, leg_no, kind, from_place_id, to_place_id, leg_date, purpose, mode,
                       vehicle_id, booked_by, gps_mode, planned_km, added_reason)
  values (t.company_id, t.id, t.employee_id, v_at, 'extra', v_from, v_to, v_today, t.purpose, m.code,
          case when m.code = 'own' then v_veh end, 'self', coalesce(nullif(p_leg->>'gps_mode', ''), m.gps),
          coalesce((p_leg->>'planned_km')::numeric, 0), coalesce(v_why, 'Added during the trip'))
  returning * into l;
  perform te__leg_log(l, 'LEG_ADDED', 'Added during the trip' || coalesce(': ' || v_why, '') || '.', p_actor);

  -- keep the chain connected: the next planned leg starts where this one ends
  select * into nx from te_legs k where k.trip_id = t.id and k.leg_no = v_at + 1 and k.status = 'PLANNED';
  if found and nx.from_place_id <> v_to then
    if nx.to_place_id = v_to then
      update te_legs set status = 'SKIPPED', skip_reason = 'Replaced by the journey added before it' where id = nx.id;
      perform te__leg_log(nx, 'LEG_SKIPPED', 'Skipped: the added journey goes to the same place.', p_actor);
    else
      update te_legs set from_place_id = v_to,
                         planned_km = coalesce(nullif(p_leg->>'next_planned_km', '')::numeric, planned_km),
                         gps_mode = coalesce(nullif(p_leg->>'next_gps_mode', ''), gps_mode)
       where id = nx.id;
      perform te__leg_log(nx, 'LEG_REWIRED', 'Now starts at ' || (select short_name from te_places where id = v_to) || ' instead of '
                           || (select short_name from te_places where id = nx.from_place_id) || ', because a journey was added before it.', p_actor);
    end if;
  end if;
  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'LEG_ADDED', p_actor,
                 'Journey added: ' || (select short_name from te_places where id = v_from) || ' to '
                   || (select short_name from te_places where id = v_to) || ' by ' || lower(m.name) || '.');
  return jsonb_build_object('leg_id', l.id, 'leg_no', v_at);
end;
$$;

-- ============================================================================
-- te_trip_record_missed — from 146_te_functions_trips.sql · 1 string(s)
-- ============================================================================

create or replace function te_trip_record_missed(p_trip_id uuid, p_actor uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql as $$
declare
  t te_trips;
  r record;
begin
  select * into t from te_trips where id = p_trip_id;
  if not found or t.employee_id is distinct from p_actor or te_trip_status(t.id) <> 'MISSED' then
    perform te_fail('TE_TRIP', 'This trip is not missed.');
  end if;
  for r in select id from te_legs where trip_id = t.id and status = 'PLANNED' order by leg_no loop
    perform te_leg_no_gps(r.id, p_actor, p_reason, p_note);
  end loop;
  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'TRIP_RECORDED_LATE', p_actor, 'Not tracked on the day. Journeys added without GPS.');
  return jsonb_build_object('trip_id', t.id, 'status', te_trip_status(t.id));
end;
$$;

-- ============================================================================
-- te_claim_submit — from 155_te_co_travellers.sql · 1 string(s)
-- ============================================================================

create or replace function te_claim_submit(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  v_emp     uuid := nullif(p->>'employee_id', '')::uuid;
  v_trip    uuid := nullif(p->>'trip_id', '')::uuid;
  v_company uuid;
  t         te_trips;
  a         jsonb := coalesce(p->'assessment', '{}'::jsonb);
  v_ids     uuid[];
  v_open    te_legs;
  v_n       int;
  v_claimed numeric;
  v_last    date;
  v_period  uuid;
  v_late    boolean;
  v_seq     int;
  v_notes   text[];
  c         te_claims;
  v_mgr     int;
begin
  if v_emp is distinct from p_actor then
    perform te_fail('TE_FORBIDDEN', 'You can only submit your own claims.');
  end if;
  perform te_assert_active(v_emp);
  select company_id into v_company from employees where id = v_emp;

  select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p->'line_ids', '[]'::jsonb)) x;
  if cardinality(v_ids) = 0 then
    perform te_fail('TE_CLAIM', 'Add at least one expense line.');
  end if;

  if v_trip is not null then
    select * into t from te_trips where id = v_trip for update;
    -- MINE, OR ONE I WAS TAKEN ON. A co-traveller spends on the trip and must
    -- be able to claim it back. Their claim is their own: claim_seq is counted
    -- per employee below, every line is checked to be theirs, and the trip only
    -- CLOSES once no claim against it is still open — so two people on one trip
    -- each get their own main claim and are each paid separately.
    if not found or (t.employee_id <> v_emp and not exists (
         select 1 from te_trip_people tp
          where tp.trip_id = t.id and tp.employee_id = v_emp)) then
      perform te_fail('TE_CLAIM', 'That trip is not yours and you are not on it.');
    end if;
    -- A claim needs an approved trip. (A trip recorded after travel is a DRAFT
    -- until its claim is sent: the claim is what gets approved. CLAIMED and
    -- CLOSED allow a supplementary claim for a bill that turned up later.)
    if not (t.status in ('APPROVED','CLAIMED','CLOSED') or (t.status = 'DRAFT' and t.origin = 'POST_FACTO')) then
      perform te_fail('TE_CLAIM', case t.status
        when 'PENDING_APPROVAL' then 'The trip is waiting for approval. Send the claim once it is approved.'
        when 'SENT_BACK' then 'The trip plan was sent back to you. Answer that first.'
        else 'This trip was ' || lower(t.status) || '. Nothing can be claimed on it.' end);
    end if;
    -- MY OWN UNFINISHED JOURNEYS, not everyone's. Every te_legs row carries the
    -- trip owner's employee_id (both inserts, in te_trip_save and te_leg_add,
    -- use t.employee_id), so for the owner this reads exactly as it did before.
    -- For a co-traveller it finds nothing, which is right: the journeys are the
    -- planner's to record, and holding someone's money back until a colleague
    -- files a GPS report would punish them for having travelled together.
    select * into v_open from te_legs l where l.trip_id = v_trip and l.employee_id = v_emp
       and l.status in ('PLANNED','ACTIVE','PAUSED','ENDED') order by l.leg_no limit 1;
    if found then
      perform te_fail('TE_CLAIM', 'Close every journey first. Journey ' || v_open.leg_no || ' is ' || case v_open.status
        when 'ENDED' then 'waiting for its report.' when 'PLANNED' then 'not recorded: add it without GPS or skip it.' else 'still running.' end);
    end if;
  end if;

  -- lock the lines first: a second submit of the same lines waits here, then finds them taken
  perform 1 from te_expenses x where x.id = any (v_ids) order by x.id for update;
  -- every line is this employee's, saved, not in a claim, and belongs to this trip (or to no trip)
  select count(*) into v_n from te_expenses x
   where x.id = any (v_ids) and x.employee_id = v_emp and x.status = 'UNCLAIMED' and x.claim_id is null
     and x.trip_id is not distinct from v_trip;
  if v_n <> cardinality(v_ids) then
    perform te_fail('TE_CLAIM', 'One of these lines is already in a claim, or does not belong here. Refresh and try again.');
  end if;

  if exists (select 1 from jsonb_array_elements(coalesce(a->'flags', '[]'::jsonb)) f where coalesce((f->>'block')::boolean, false)) then
    perform te_fail('TE_CLAIM', 'Fix the blocked lines first.');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(a->'flags', '[]'::jsonb)) f where coalesce((f->>'needsReason')::boolean, false)) then
    perform te_fail('TE_CLAIM', 'Add a reason where one is asked.');
  end if;
  if not coalesce((p->>'declared')::boolean, false) then
    perform te_fail('TE_CLAIM', 'Accept the declaration to submit.');
  end if;
  -- the engine's result must cover exactly these lines
  if (select count(*) from jsonb_array_elements(coalesce(a->'rows', '[]'::jsonb))) <> cardinality(v_ids)
     or exists (select 1 from jsonb_array_elements(coalesce(a->'rows', '[]'::jsonb)) e where not ((e->>'id')::uuid = any (v_ids))) then
    perform te_fail('TE_CLAIM', 'The claim could not be checked. Try again.');
  end if;

  select max(x.expense_date) into v_last from te_expenses x where x.id = any (v_ids);
  -- this month and the next always exist, whether or not the nightly job has run
  perform travel_ensure_period(v_company, te_today(v_company));
  perform travel_ensure_period(v_company, (date_trunc('month', te_today(v_company)) + interval '1 month')::date);
  select f.period_id, f.is_late into v_period, v_late from te_period_for(v_company, coalesce(t.end_date, v_last)) f;
  -- 0 = the main claim of the trip, 1+ = a supplementary one. A recalled claim does not use up a number.
  select coalesce(max(k.claim_seq) + 1, 0) into v_seq from te_claims k
   where k.trip_id = v_trip and k.employee_id = v_emp and v_trip is not null and k.status <> 'CANCELLED';

  insert into te_claims (company_id, claim_no, employee_id, trip_id, claim_type, claim_seq, period_id, is_late, note,
                         claimed_total, eligible_total, approved_total, risk_score, risk_band, is_exception, is_post_facto,
                         declaration_at, stage, status, submitted_at, first_submitted_at, workflow_version)
  values (v_company, te_next_no(v_company, 'claim'), v_emp, v_trip, case when v_trip is null then 'GENERAL' else 'TRIP' end,
          coalesce(v_seq, 0), v_period, v_late, nullif(btrim(p->>'note'), ''),
          0, coalesce((a->>'eligible')::numeric, 0), coalesce((a->>'eligible')::numeric, 0),
          coalesce((a->>'score')::int, 0), coalesce(nullif(a->>'band', ''), 'Low'),
          coalesce((a->>'exception')::boolean, false), coalesce(t.origin = 'POST_FACTO', false),
          now(), 'manager', 'IN_APPROVAL', now(), now(),
          (select w.version from te_workflows w where w.company_id = v_company and w.code = 'claim'))
  returning * into c;

  perform te__write_rows(c.id, a->'rows', v_period);
  perform te__write_flags(c.id, a->'flags', 1);
  -- the totals come from the lines as they are stored, never from the payload
  select coalesce(sum(case when x.paid_by = 'self' then x.claimed_amount else 0 end), 0) into v_claimed
    from te_expenses x where x.claim_id = c.id;
  update te_claims set claimed_total = v_claimed,
                       eligible_total = coalesce((select sum(x.eligible_amount) from te_expenses x where x.claim_id = c.id), 0)
   where id = c.id;
  perform te__claim_recalc(c.id);
  select * into c from te_claims where id = c.id;

  v_notes := te_build_steps(v_company, 'claim', c.id, v_emp,
               jsonb_build_object('total', v_claimed, 'scope', t.scope, 'postFacto', c.is_post_facto,
                                  'exception', c.is_exception, 'band', c.risk_band),
               case when v_trip is not null then te_trip_co(v_trip) else '{}'::uuid[] end);
  update te_claims set chain_notes = v_notes where id = c.id;
  -- Nobody to verify = nobody to pay it. Better to say so now than to leave the claim waiting for no one.
  if not exists (select 1 from te_approval_steps s where s.entity_type = 'claim' and s.entity_id = c.id and s.stage = 'finance') then
    perform te_fail('TE_NOT_SET_UP', 'Nobody is set up to verify claims. Ask your admin to add a Finance team member or a fallback approver.');
  end if;

  if v_trip is not null then
    update te_trips set status = 'CLAIMED' where id = v_trip;
    perform te_log(v_company, 'trip', t.id, t.trip_no, 'CLAIM_SENT', p_actor,
                   'Claim ' || c.claim_no || ' sent: ' || cardinality(v_ids) || case when cardinality(v_ids) = 1 then ' line, ' else ' lines, ' end || te_rs(v_claimed) || '.');
  end if;
  perform te__claim_log(c, 'CLAIM_SUBMITTED', 'Submitted with declaration. ' || cardinality(v_ids)
                          || case when cardinality(v_ids) = 1 then ' line, ' else ' lines, ' end || te_rs(v_claimed) || ' claimed.', p_actor);

  select count(*) into v_mgr from te_approval_steps s where s.entity_type = 'claim' and s.entity_id = c.id and s.stage = 'manager';
  if v_mgr = 0 then
    perform te__claim_log(c, 'CLAIM_NO_APPROVER', 'No approval level applies in the workflow. Sent to Finance.', null);
    perform te__enter_verification(c.id);
  else
    perform te__notify_waiting('claim', c.id, 'Claim ' || c.claim_no || ' from ' || te_emp_name(v_emp),
                               te_rs(v_claimed) || ' is waiting for your approval.', p_actor);
  end if;

  select * into c from te_claims where id = c.id;
  return jsonb_build_object('claim_id', c.id, 'claim_no', c.claim_no, 'status', c.status, 'stage', c.stage,
                            'risk_band', c.risk_band, 'chain_notes', to_jsonb(c.chain_notes));
end;
$$;

-- ============================================================================
-- te_seed_company — from 149_te_seed.sql · 3 string(s)
-- ============================================================================

create or replace function te_seed_company(p_company_id uuid, p_actor uuid default null)
returns jsonb language plpgsql as $$
declare
  v_fallback uuid;
  v_today    date := te_today(p_company_id);
begin
  if not exists (select 1 from companies where id = p_company_id) then
    perform te_fail('TE_NOT_SET_UP', 'Company not found.');
  end if;

  -- ---- settings ---------------------------------------------------------------
  if to_regclass('public.finance_team') is not null then
    select f.employee_id into v_fallback from finance_team f
     where f.company_id = p_company_id and f.is_active and f.can_approve and te_is_employee_active(f.employee_id)
       and f.role in ('CFO','CONTROLLER','MANAGER')
     order by case f.role when 'CFO' then 1 when 'CONTROLLER' then 2 else 3 end, f.created_at limit 1;
  end if;
  if v_fallback is null then
    select c.md_employee_id into v_fallback from companies c where c.id = p_company_id;
  end if;

  insert into te_settings (company_id, bill_age_days, claim_deadline_days, notice_days, receipt_above, no_bill_per_day,
      client_per_head, misc_per_claim, comm_per_claim, advance_max_pct, grace_days, mileage_tolerance_pct,
      estimate_tolerance_pct, post_facto, post_facto_per_quarter, fast_track_amount, sample_pct, fallback_approver_id,
      reminder_days, escalate_days, auto_approve_on_timeout, dom_air_estimate, intl_air_estimate, default_grade,
      gps_rules, vehicle_rules, fuel_prices, limit_basis, breach_actions, risk_weights, risk_bands, zone_a_countries, extra, updated_by)
  values (p_company_id, 90, 15, 3, 200, 300, 1500, 1000, 1500, 80, 7, 10, 10,
      'limited', 2, 5000, 10, v_fallback, 2, 5, false, 6000, 65000, 'DEFAULT',
      '{"gpsRequired":true,"manualAllowed":true,"intlTrack":false,"pingSec":30,"minAccuracy":50,"startRadius":300,"endRadius":300,"hubRadius":2000,"routeTol":15,"gapMin":5,"trainGapMin":30,"maxSpeed":130,"stopMaxMin":90,"preApproveKm":75,"maxKmDay":150,"localMaxKm":120,"localMealCap":300,"abroadFactor":6,"maxKmDayOut":500,"provider":"Google Maps","retentionDays":180,"journeyClaim":"instant","pastDays":7,"pastPerMonth":5,"typedAddress":true}'::jsonb,
      '{"rcCheck":true,"owner":"any","insurance":"flag"}'::jsonb,
      '{"petrol":95,"diesel":88,"cng":76,"ev":9}'::jsonb,
      '{"meals":"strict","conv":"strict"}'::jsonb,
      '{"hotel":"cap","meals":"cap","conv":"cap","client":"justify","misc":"cap","comm":"cap","cls":"justify","nobill":"cap"}'::jsonb,
      '{"low":1,"medium":3,"high":8}'::jsonb,
      '{"medium":3,"high":8}'::jsonb,
      array['Australia', 'Austria', 'Belgium', 'Canada', 'Denmark', 'Finland', 'France', 'Germany', 'Hong Kong SAR', 'Ireland', 'Israel', 'Italy', 'Japan', 'Luxembourg', 'Netherlands', 'New Zealand', 'Norway', 'Qatar', 'Singapore', 'South Korea', 'Spain', 'Sweden', 'Switzerland', 'United Arab Emirates', 'United Kingdom', 'United States'],
      '{"hodAbove":30000}'::jsonb, p_actor)
  on conflict (company_id) do nothing;

  -- ---- expense categories -----------------------------------------------------
  insert into te_categories (company_id, code, name, icon, needs_trip, proof, grp, sort_order)
  select p_company_id, v.* from (values
    ('air', 'Air travel', 'plane', true, 'always', 'Travel', 10),
    ('train', 'Train', 'train', true, 'always', 'Travel', 20),
    ('bus', 'Bus ticket', 'bus', true, 'always', 'Travel', 30),
    ('hotel', 'Hotel stay', 'bed', true, 'always', 'Stay', 40),
    ('meals', 'Meals', 'food', true, 'above', 'Food', 50),
    ('cab', 'Cab or taxi', 'car', false, 'above', 'Local travel', 60),
    ('local', 'Local conveyance, no bill', 'pin', false, 'none', 'Local travel', 70),
    ('mileage', 'Own vehicle', 'car', false, 'none', 'Local travel', 80),
    ('toll', 'Toll and parking', 'ticket', false, 'above', 'Local travel', 90),
    ('client', 'Client entertainment', 'users', false, 'always', 'Other', 100),
    ('comm', 'Courier and communication', 'file', false, 'above', 'Other', 110),
    ('misc', 'Miscellaneous', 'receipt', false, 'above', 'Other', 120)
  ) as v(code, name, icon, needs_trip, proof, grp, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- transport modes --------------------------------------------------------
  -- basis: km = per-km rate · bill = on a bill · nobill = fare, no bill · ticket = on the ticket · none = logged only
  insert into te_modes (company_id, code, name, icon, basis, scope_local, scope_domestic, scope_international, gps,
                        stops_allowed, fare_ceiling_per_km, min_fare, est_per_km, est_min, category_code, sort_order)
  select p_company_id, v.* from (values
    ('own', 'Own vehicle', 'car', 'km', true, true, false, 'track', true, 0, null, null, null, 'mileage', 10),
    ('company', 'Company vehicle', 'car', 'none', true, true, false, 'track', true, 0, null, null, null, null, 20),
    ('cab', 'Cab or taxi', 'taxi', 'bill', true, true, true, 'track', true, 25, 200, 16, 150, 'cab', 30),
    ('auto', 'Auto-rickshaw', 'auto', 'nobill', true, true, false, 'track', true, 15, 60, 12, 50, 'local', 40),
    ('public', 'City bus or metro', 'bus', 'nobill', true, true, true, 'track', false, 5, 40, 3, 30, 'local', 50),
    ('rental', 'Rental car', 'car', 'bill', false, true, true, 'track', true, 30, 1500, 14, 1500, 'cab', 60),
    ('train', 'Train', 'train', 'ticket', true, true, true, 'track', false, 0, null, 2, 300, 'train', 70),
    ('bus', 'Intercity bus', 'bus', 'ticket', false, true, true, 'track', false, 0, null, 1.6, 300, 'bus', 80),
    ('flight', 'Flight', 'plane', 'ticket', false, true, true, 'checkin', false, 0, null, null, null, 'air', 90)
  ) as v(code, name, icon, basis, scope_local, scope_domestic, scope_international, gps, stops_allowed,
         fare_ceiling_per_km, min_fare, est_per_km, est_min, category_code, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- vehicle types and per-km rates ------------------------------------------
  -- method fixed = rate_per_km · method fuel = fuel price / km_per_unit + wear_per_km
  insert into te_vehicle_types (company_id, code, name, example, method, rate_per_km, fuel, km_per_unit, wear_per_km, sort_order, updated_by)
  select p_company_id, v.*, p_actor from (values
    ('bike', 'Two-wheeler', 'Scooter or motorcycle', 'fixed', 4, 'petrol', 45, 1.5, 10),
    ('hatch', 'Hatchback', 'Small car', 'fixed', 9, 'petrol', 18, 3.5, 20),
    ('sedan', 'Sedan', 'Mid-size car', 'fixed', 11, 'petrol', 15, 4.5, 30),
    ('suv', 'SUV', 'SUV or MUV', 'fixed', 13, 'diesel', 13, 5.5, 40),
    ('ev', 'Electric car', 'Battery car, km per kWh', 'fuel', 7, 'ev', 7, 3, 50)
  ) as v(code, name, example, method, rate_per_km, fuel, km_per_unit, wear_per_km, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- place types ------------------------------------------------------------
  insert into te_place_types (company_id, code, name, sort_order)
  select p_company_id, v.* from (values
    ('corp', 'Corporate office', 10),
    ('branch', 'Branch or regional office', 20),
    ('factory', 'Factory or plant', 30),
    ('warehouse', 'Warehouse or depot', 40),
    ('client', 'Client site', 50),
    ('dealer', 'Dealer or distributor', 60),
    ('vendor', 'Vendor or supplier', 70),
    ('site', 'Project site', 80),
    ('event', 'Event, expo or training venue', 90),
    ('govt', 'Bank or government office', 100),
    ('airport', 'Airport', 110),
    ('station', 'Railway or bus station', 120),
    ('hotel', 'Hotel or stay', 130),
    ('home', 'Home', 140),
    ('other', 'Other', 150)
  ) as v(code, name, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- stop reasons (a business stop extends the route that is paid) -----------
  insert into te_stop_reasons (company_id, code, name, is_business, typical_minutes, sort_order)
  select p_company_id, v.* from (values
    ('meet', 'Meeting on the way', true, 40, 10),
    ('pick', 'Pick up or drop a colleague', true, 8, 20),
    ('goods', 'Collect or deliver material', true, 20, 30),
    ('fuel', 'Fuel or charging', false, 10, 40),
    ('meal', 'Meal or tea break', false, 25, 50),
    ('toll', 'Toll or parking', false, 3, 60),
    ('rest', 'Rest break', false, 15, 70),
    ('vehicle', 'Vehicle problem', false, 35, 80),
    ('other', 'Other', false, 12, 90)
  ) as v(code, name, is_business, typical_minutes, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- the 55 checks. is_live = false: shown to the admin, not evaluated yet -------
  insert into te_checks (company_id, code, layer, title, action, severity, is_enabled, is_live, sort_order)
  select p_company_id, v.* from (values
    ('A1', 'A', 'Mandatory fields and proofs are present', 'block', '', true, true, 10),
    ('A2', 'A', 'Bill date is not in the future and is inside the bill-age limit', 'block', '', true, true, 20),
    ('A3', 'A', 'PNR or ticket reference has the right format', 'warn', 'low', true, true, 30),
    ('A4', 'A', 'GSTIN has valid format and checksum', 'warn', 'low', true, true, 40),
    ('A5', 'A', 'Typed amount differs from the amount read from the bill', 'justify', 'medium', true, true, 50),
    ('A6', 'A', 'Claimed amount is more than the bill amount', 'block', '', true, true, 60),
    ('B1', 'B', 'Same file fingerprint as an earlier upload', 'block', '', true, true, 70),
    ('B2', 'B', 'Near-identical bill image', 'warn', 'high', true, true, 80),
    ('B3', 'B', 'Same merchant and invoice number', 'block', '', true, true, 90),
    ('B4', 'B', 'Same employee, date, amount and category', 'warn', 'low', true, true, 100),
    ('B5', 'B', 'Different employees, same merchant, date and amount', 'warn', 'medium', true, true, 110),
    ('B6', 'B', 'Same PNR, cab trip ID or FASTag ID claimed twice', 'block', '', true, true, 120),
    ('B7', 'B', 'Self-paid line matches a company-paid booking', 'block', '', true, true, 130),
    ('C1', 'C', 'Expense date is an approved leave day', 'justify', 'medium', true, true, 140),
    ('C2', 'C', 'Office punch on a day claimed as outstation', 'warn', 'high', true, true, 150),
    ('C3', 'C', 'Expense date is outside the trip dates', 'warn', 'low', true, true, 160),
    ('C4', 'C', 'Local travel or other expense on a weekly off or holiday', 'warn', 'low', true, true, 170),
    ('C5', 'C', 'Merchant state is not a trip city', 'warn', 'medium', true, true, 180),
    ('C6', 'C', 'Hotel nights exceed trip nights, or stays overlap', 'block', '', true, true, 190),
    ('C7', 'C', 'Timeline conflict between travel and spend', 'warn', 'medium', true, false, 200),
    ('C8', 'C', 'Employee already tagged as co-traveller on the bill', 'block', '', true, false, 210),
    ('C9', 'C', 'Employee is past date of leaving', 'block', '', true, false, 220),
    ('C10', 'C', 'Trip overlaps another trip of the same employee', 'block', '', true, true, 230),
    ('C11', 'C', 'Hotel or flight on a local trip', 'block', '', true, true, 240),
    ('D1', 'D', 'Claimed distance exceeds map distance beyond tolerance', 'cap', 'medium', true, true, 250),
    ('D2', 'D', 'Two or more bills from one merchant on one day', 'warn', 'medium', true, true, 260),
    ('D3', 'D', 'Amounts repeatedly just under a limit', 'warn', 'medium', true, false, 270),
    ('D4', 'D', 'Repeated round amounts on no-bill lines', 'warn', 'low', true, true, 280),
    ('D5', 'D', 'Amount far above peers', 'warn', 'medium', true, false, 290),
    ('D6', 'D', 'Consecutive bill numbers from one merchant', 'warn', 'high', true, false, 300),
    ('D7', 'D', 'High share of no-bill lines', 'warn', 'medium', true, false, 310),
    ('D8', 'D', 'Cash to one merchant in a day above ₹10,000', 'warn', 'medium', true, true, 320),
    ('D9', 'D', 'Restricted words on the bill', 'warn', 'medium', true, true, 330),
    ('D10', 'D', 'Claim exceeds the approved trip estimate', 'justify', 'medium', true, true, 340),
    ('E1', 'E', 'Image metadata shows editing software', 'warn', 'medium', true, true, 350),
    ('E2', 'E', 'PDF produced by a bill-generator tool', 'warn', 'high', true, true, 360),
    ('E3', 'E', 'E-invoice QR code does not match typed values', 'warn', 'high', true, false, 370),
    ('E4', 'E', 'GSTIN live status lookup', 'warn', 'medium', true, false, 380),
    ('F1', 'F', 'Approver is the claimant or a co-traveller', 'reroute', '', true, true, 390),
    ('F2', 'F', 'Approver clears flagged claims within seconds', 'report', '', true, false, 400),
    ('F3', 'F', 'One approver always approves one employee’s flags', 'report', '', true, false, 410),
    ('F4', 'F', 'Random sample of clean claims', 'sample', '', true, true, 420),
    ('G1', 'G', 'Journey started or checked in away from the planned start point', 'warn', 'medium', true, true, 430),
    ('G2', 'G', 'Journey ended or checked in away from the planned destination', 'justify', 'medium', true, true, 440),
    ('G3', 'G', 'GPS distance exceeds the shortest map route beyond tolerance', 'cap', 'medium', true, true, 450),
    ('G4', 'G', 'Tracking gap: no location for several minutes', 'warn', 'medium', true, true, 460),
    ('G5', 'G', 'Impossible speed or location jump (possible mock location)', 'warn', 'high', true, true, 470),
    ('G6', 'G', 'Mock-location app or developer mode found on the device', 'block', '', true, false, 480),
    ('G7', 'G', 'Travel journey without a GPS record or check-ins', 'justify', 'medium', true, true, 490),
    ('G8', 'G', 'Fare per km is above the ceiling for the mode', 'warn', 'medium', true, true, 500),
    ('G9', 'G', 'Vehicle is not verified in the employee’s profile', 'warn', 'low', true, true, 510),
    ('G10', 'G', 'Daily distance cap exceeded', 'cap', 'medium', true, true, 520),
    ('G11', 'G', 'Long stop on the way for a personal reason', 'warn', 'low', true, true, 530),
    ('G12', 'G', 'Own vehicle is registered in another person’s name', 'warn', 'low', true, true, 540),
    ('G13', 'G', 'Vehicle insurance or RC was not valid on the day of the drive', 'warn', 'medium', true, true, 550)
  ) as v(code, layer, title, action, severity, is_enabled, is_live, sort_order)
  on conflict (company_id, code) do nothing;

  -- ---- limits by grade and city tier (illustrative: replace with the company's policy) ----
  insert into te_grade_policies (company_id, grade, air_class, train_class, sort_order)
  select p_company_id, v.* from (values
    ('E1', 'Economy', '3A', 10),
    ('M1', 'Economy', '3A', 20),
    ('M2', 'Economy', '2A', 30),
    ('L1', 'Premium Economy', '1A', 40),
    ('DEFAULT', 'Economy', '3A', 990)
  ) as v(grade, air_class, train_class, sort_order)
  on conflict (company_id, grade) do nothing;

  insert into te_grade_limits (company_id, grade, tier, hotel_per_night, meals_per_day, conveyance_per_day)
  select p_company_id, v.* from (values
    ('E1', 'metro', 3500, 900, 600),
    ('E1', 'tier1', 2800, 750, 500),
    ('E1', 'rest', 2200, 600, 400),
    ('E1', 'intlA', 14000, 5000, 3000),
    ('E1', 'intlB', 9000, 3500, 2000),
    ('M1', 'metro', 4200, 1000, 700),
    ('M1', 'tier1', 3400, 850, 550),
    ('M1', 'rest', 2600, 700, 450),
    ('M1', 'intlA', 16000, 5500, 3500),
    ('M1', 'intlB', 10000, 4000, 2500),
    ('M2', 'metro', 5000, 1200, 800),
    ('M2', 'tier1', 4000, 1000, 600),
    ('M2', 'rest', 3000, 800, 500),
    ('M2', 'intlA', 18000, 6000, 4000),
    ('M2', 'intlB', 12000, 4500, 3000),
    ('L1', 'metro', 7500, 1800, 1200),
    ('L1', 'tier1', 6000, 1500, 1000),
    ('L1', 'rest', 4500, 1200, 800),
    ('L1', 'intlA', 25000, 8000, 5000),
    ('L1', 'intlB', 16000, 6000, 4000),
    ('DEFAULT', 'metro', 3500, 900, 600),
    ('DEFAULT', 'tier1', 2800, 750, 500),
    ('DEFAULT', 'rest', 2200, 600, 400),
    ('DEFAULT', 'intlA', 14000, 5000, 3000),
    ('DEFAULT', 'intlB', 9000, 3500, 2000)
  ) as v(grade, tier, hotel_per_night, meals_per_day, conveyance_per_day)
  on conflict (company_id, grade, tier) do nothing;

  -- ---- city tiers. hub_region groups cities that share an airport and a station ----
  insert into te_city_tiers (company_id, city, state_code, tier, hub_region)
  select p_company_id, v.* from (values
    ('Gurugram', '06', 'metro', 'NCR'),
    ('Delhi', '07', 'metro', 'NCR'),
    ('Bengaluru', '29', 'metro', null),
    ('Mumbai', '27', 'metro', null),
    ('Chennai', '33', 'metro', null),
    ('Hyderabad', '36', 'metro', null),
    ('Kolkata', '19', 'metro', null),
    ('Pune', '27', 'tier1', null),
    ('Ahmedabad', '24', 'tier1', null),
    ('Jaipur', '08', 'tier1', null),
    ('Lucknow', '09', 'tier1', null),
    ('Kochi', '32', 'tier1', null),
    ('Chandigarh', '04', 'tier1', null),
    ('Indore', '23', 'tier1', null),
    ('Nagpur', '27', 'rest', null),
    ('Dehradun', '05', 'rest', null),
    ('Raipur', '22', 'rest', null),
    ('Guwahati', '18', 'rest', null),
    ('New Delhi', '07', 'metro', 'NCR'),
    ('Noida', '09', 'metro', 'NCR'),
    ('Greater Noida', '09', 'metro', 'NCR'),
    ('Ghaziabad', '09', 'metro', 'NCR'),
    ('Faridabad', '06', 'metro', 'NCR'),
    ('Manesar', '06', 'metro', 'NCR')
  ) as v(city, state_code, tier, hub_region)
  on conflict (company_id, city) do nothing;

  -- ---- places: the company's own offices, from the locations master ------------
  if to_regclass('public.locations') is not null then
    insert into te_places (company_id, source, place_type, short_name, name, address, city, state, pin_code, country, lat, lng, created_by)
    select l.company_id, 'company',
           case when l.location_type ilike '%plant%' or l.location_type ilike '%factory%' then 'factory'
                when l.location_type ilike '%warehouse%' or l.location_type ilike '%depot%' then 'warehouse'
                when l.location_type ilike '%branch%' or l.location_type ilike '%regional%' then 'branch'
                else 'corp' end,
           left(l.location_name, 40), l.location_name,
           concat_ws(', ', nullif(l.address_line1, ''), nullif(l.city, ''), nullif(l.state, ''), nullif(l.pin_code, '')),
           l.city, l.state, case when l.pin_code ~ '^[1-9][0-9]{5}$' then l.pin_code end, 'India',
           l.latitude, l.longitude, p_actor
      from locations l
     where l.company_id = p_company_id and l.latitude is not null and l.longitude is not null
       and l.latitude between -90 and 90 and l.longitude between -180 and 180
       and coalesce(l.status, 'Active') = 'Active'
       and not exists (select 1 from te_places p where p.company_id = l.company_id and p.owner_employee_id is null
                          and p.source = 'company' and p.name = l.location_name);
  end if;

  -- ---- places: airports and stations --------------------------------------------
  insert into te_places (company_id, source, place_type, short_name, name, address, city, state, pin_code, country, lat, lng, code, created_by)
  select p_company_id, 'hub', v.place_type, v.short_name, v.name, v.address, v.city, v.state, v.pin_code, v.country, v.lat, v.lng, v.code, p_actor
    from (values
    ('airport', 'Delhi airport T3', 'IGI Airport T3', 'Terminal 3, Indira Gandhi International Airport, New Delhi, Delhi 110037', 'Delhi', 'Delhi', '110037', 'India', 28.5562, 77.1, 'DEL'),
    ('station', 'New Delhi station', 'New Delhi Railway Station', 'New Delhi Railway Station, Ajmeri Gate side, New Delhi, Delhi 110002', 'Delhi', 'Delhi', '110002', 'India', 28.643, 77.2194, 'NDLS'),
    ('airport', 'Bengaluru airport', 'Kempegowda International Airport T1', 'Terminal 1, Kempegowda International Airport, Devanahalli, Bengaluru, Karnataka 560300', 'Bengaluru', 'Karnataka', '560300', 'India', 13.1986, 77.7066, 'BLR'),
    ('airport', 'Mumbai airport T2', 'Chhatrapati Shivaji Maharaj International Airport T2', 'Terminal 2, Chhatrapati Shivaji Maharaj International Airport, Andheri East, Mumbai, Maharashtra 400099', 'Mumbai', 'Maharashtra', '400099', 'India', 19.0896, 72.8656, 'BOM'),
    ('airport', 'Pune airport', 'Pune International Airport', 'Pune International Airport, Lohegaon, Pune, Maharashtra 411032', 'Pune', 'Maharashtra', '411032', 'India', 18.5821, 73.9197, 'PNQ'),
    ('station', 'Jaipur Junction', 'Jaipur Junction railway station', 'Jaipur Junction, Station Road, Jaipur, Rajasthan 302006', 'Jaipur', 'Rajasthan', '302006', 'India', 26.9196, 75.7878, 'JP'),
    ('airport', 'Dubai airport T3', 'Dubai International Airport T3', 'Terminal 3, Dubai International Airport, Al Garhoud, Dubai, United Arab Emirates', 'Dubai', null, null, 'United Arab Emirates', 25.2532, 55.3657, 'DXB')
    ) as v(place_type, short_name, name, address, city, state, pin_code, country, lat, lng, code)
   where not exists (select 1 from te_places p where p.company_id = p_company_id and p.source = 'hub' and p.code = v.code);

  insert into te_hubs (company_id, area, kind, place_id)
  select p_company_id, v.area, v.kind, p.id
    from (values
    ('NCR', 'air', 'DEL'),
    ('NCR', 'rail', 'NDLS'),
    ('Bengaluru', 'air', 'BLR'),
    ('Mumbai', 'air', 'BOM'),
    ('Pune', 'air', 'PNQ'),
    ('Jaipur', 'rail', 'JP'),
    ('Dubai', 'air', 'DXB')
    ) as v(area, kind, code)
    join te_places p on p.company_id = p_company_id and p.source = 'hub' and p.code = v.code
  on conflict (company_id, area, kind) do nothing;

  -- ---- the two default workflows ------------------------------------------------
  if not exists (select 1 from te_workflows w where w.company_id = p_company_id and w.code = 'claim') then
    perform te_workflow_save(p_company_id, 'claim', te_default_levels('claim'), p_actor);
  end if;
  if not exists (select 1 from te_workflows w where w.company_id = p_company_id and w.code = 'trip') then
    perform te_workflow_save(p_company_id, 'trip', te_default_levels('trip'), p_actor);
  end if;

  -- ---- expense months: this one and the next --------------------------------------
  perform travel_ensure_period(p_company_id, v_today);
  perform travel_ensure_period(p_company_id, (date_trunc('month', v_today) + interval '1 month')::date);

  return jsonb_build_object('company_id', p_company_id, 'fallback_approver_id', v_fallback, 'seeded', true);
end;
$$;

-- ============================================================================
-- The seeded check catalogue, for companies that already exist.
-- te_seed_company above fixes this for any company created from now on; these
-- three rows were written when each existing company was set up. The WHERE
-- clause matches the old default exactly, so a company that renamed its own
-- check keeps its wording.
-- ============================================================================

update te_checks set title = 'Journey started or checked in away from the planned start point'
 where code = 'G1' and title = 'Leg started or checked in away from the planned start point';

update te_checks set title = 'Journey ended or checked in away from the planned destination'
 where code = 'G2' and title = 'Leg ended or checked in away from the planned destination';

update te_checks set title = 'Travel journey without a GPS record or check-ins'
 where code = 'G7' and title = 'Travel leg without a GPS record or check-ins';
