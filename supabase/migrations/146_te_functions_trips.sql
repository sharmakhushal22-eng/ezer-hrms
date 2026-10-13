-- 146_te_functions_trips.sql
-- ============================================================================
-- EZER HRMS — TRAVEL & EXPENSE v2  ·  3 of 6: PLACES, VEHICLES, TRIPS, LEGS, EXPENSES
-- SAFE TO RUN TWICE. Run AFTER 145.
-- ----------------------------------------------------------------------------
-- Every function here is one user action and one transaction. It checks who is
-- asking and what state the record is in, writes, and logs. A refusal is an
-- exception raised through te_fail(), so nothing is half-written.
--
-- WHO DOES WHAT
--   The API route identifies the caller from the signed token and passes that
--   employee id as p_actor. These functions never take the actor from a
--   payload field the browser could change.
--
--   The rules engine (engine/te-engine.js) runs in the API before these calls. It
--   validates the plan, builds the legs, prices the mileage and raises the
--   flags. These functions then store the result and own the state changes.
--   What the engine computes is named "computed by the engine" below.
--
-- FUNCTIONS
--   te_place_save            a start, end or stop the employee adds
--   te_vehicle_add           any vehicle, by its number, with the RC result
--   te_vehicle_verify        HR confirms the type from an RC photo
--   te_trip_save             plan a trip, record a past trip, or edit one
--   te_trip_decide           approve, send back or reject a trip plan
--   te_trip_answer           the employee answers a send-back without editing
--   te_trip_cancel
--   te_booking_record        the Travel Desk books a leg or a stay
--   te_booking_cancel
--   te_leg_start             start a leg or check in
--   te_leg_pings_add         the GPS trail, in batches
--   te_leg_stop_add / te_leg_stop_end
--   te_leg_end               end a leg or check in on arrival
--   te_leg_file              the leg report: what was paid for this leg
--   te_leg_skip / te_leg_no_gps / te_leg_add / te_trip_record_missed
--   te_expense_save / te_expense_discard
-- ============================================================================


-- ============================================================================
-- SECTION 1 — GEOMETRY
-- ============================================================================

create or replace function te_haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric language sql immutable as $$
  select (6371 * 2 * asin(sqrt(
           power(sin(radians((lat2 - lat1)::float8) / 2), 2)
           + cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)
         )))::numeric;
$$;

-- How far a fix is from a place, in metres.
create or replace function te_off_m(p_place_id uuid, p_lat numeric, p_lng numeric)
returns int language sql stable as $$
  select round(te_haversine_km(p.lat, p.lng, p_lat, p_lng) * 1000)::int from te_places p where p.id = p_place_id;
$$;

-- Distance along the stored trail of a leg, straight from the pings. The
-- engine's figure (which also removes impossible jumps) is what is paid; this
-- one exists so Finance can check any leg without the app.
create or replace function te_leg_distance_km(p_leg_id uuid)
returns numeric language sql stable as $$
  -- in the order of time, not of arrival: a batch that was sent late does not make the trail jump back
  select coalesce(round(sum(te_haversine_km(x.plat, x.plng, x.lat, x.lng)), 2), 0)
    from (select g.lat, g.lng,
                 lag(g.lat) over (order by g.recorded_at, g.seq) as plat,
                 lag(g.lng) over (order by g.recorded_at, g.seq) as plng
            from te_leg_pings g where g.leg_id = p_leg_id) x
   where x.plat is not null;
$$;


-- ============================================================================
-- SECTION 2 — PLACES
-- ============================================================================

-- p = {"employee_id","source":"gps|address|saved","place_type","short_name","name","address","city",
--      "state","pin_code","country","lat","lng","gps_accuracy_m","code"}
-- The address checks (PIN matches the state, a real locality) are done by the
-- engine and the map provider before this is called.
create or replace function te_place_save(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  v_emp     uuid := nullif(p->>'employee_id', '')::uuid;
  v_company uuid;
  v_id      uuid;
begin
  if v_emp is distinct from p_actor then
    perform te_fail('TE_FORBIDDEN', 'You can only add places for yourself.');
  end if;
  perform te_assert_active(v_emp);
  select company_id into v_company from employees where id = v_emp;
  if coalesce(btrim(p->>'address'), '') = '' or p->>'lat' is null or p->>'lng' is null then
    perform te_fail('TE_PLACE', 'A place needs its address and its position on the map.');
  end if;

  insert into te_places (company_id, owner_employee_id, source, place_type, short_name, name, address, city, state,
                         pin_code, country, lat, lng, gps_accuracy_m, code, created_by)
  values (v_company, v_emp, coalesce(nullif(p->>'source', ''), 'address'), nullif(p->>'place_type', ''),
          coalesce(nullif(btrim(p->>'short_name'), ''), left(btrim(p->>'address'), 40)), nullif(btrim(p->>'name'), ''),
          btrim(p->>'address'), nullif(btrim(p->>'city'), ''), nullif(btrim(p->>'state'), ''),
          nullif(btrim(p->>'pin_code'), ''), coalesce(nullif(btrim(p->>'country'), ''), 'India'),
          (p->>'lat')::numeric, (p->>'lng')::numeric, nullif(p->>'gps_accuracy_m', '')::numeric,
          nullif(p->>'code', ''), p_actor)
  returning id into v_id;
  return jsonb_build_object('place_id', v_id);
end;
$$;


-- ============================================================================
-- SECTION 3 — VEHICLES
-- ============================================================================

create or replace function te_reg_norm(p_reg text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_reg, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- State-series (HR26DK4821) or BH-series (22BH1234AA).
create or replace function te_reg_valid(p_reg text)
returns boolean language sql immutable as $$
  select te_reg_norm(p_reg) ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{3,4}$' or te_reg_norm(p_reg) ~ '^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$';
$$;

-- Add a vehicle.
-- p = {"employee_id","type_code","reg_no","ownership":"self|family|other","rc_file_url",
--      "rc":{"type","maker","model","cls","body","fuel","owner","regd","rcValid","insValid","pucValid","match"}}
-- "rc" is what the API got from the Vahan provider (null when the number was
-- not found or the RC check is switched off). rc.type is the vehicle type the
-- RC maps to and rc.match is how the owner's name compares with the
-- employee's: both computed by the engine (rcType, nameMatch).
create or replace function te_vehicle_add(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  v_emp      uuid := nullif(p->>'employee_id', '')::uuid;
  v_company  uuid;
  v_today    date;
  v_rules    jsonb;
  v_rc       jsonb := case when jsonb_typeof(p->'rc') = 'object' then p->'rc' end;
  v_reg      text := upper(regexp_replace(btrim(coalesce(p->>'reg_no', '')), '\s+', ' ', 'g'));
  v_norm     text := te_reg_norm(p->>'reg_no');
  v_type     text;
  v_vt       te_vehicle_types;
  v_whose    text;
  v_photo    text := nullif(p->>'rc_file_url', '');
  v_id       uuid;
begin
  if v_emp is distinct from p_actor then
    perform te_fail('TE_FORBIDDEN', 'You can only add your own vehicles.');
  end if;
  perform te_assert_active(v_emp);
  select company_id into v_company from employees where id = v_emp;
  v_today := te_today(v_company);
  select coalesce(s.vehicle_rules, '{}'::jsonb) into v_rules from te_settings s where s.company_id = v_company;

  if not te_reg_valid(v_reg) then
    perform te_fail('TE_VEHICLE', 'Enter the vehicle number as on the RC, like HR26 DK 4821, or 22 BH 1234 AA.');
  end if;
  if exists (select 1 from te_employee_vehicles v where v.employee_id = v_emp and v.reg_no_norm = v_norm and v.is_active) then
    perform te_fail('TE_VEHICLE', v_reg || ' is already in your vehicles.');
  end if;
  if exists (select 1 from te_employee_vehicles v where v.company_id = v_company and v.reg_no_norm = v_norm and v.is_active) then
    perform te_fail('TE_VEHICLE', v_reg || ' is already added by another employee. Ask HR to move it to you.');
  end if;

  -- the RC decides the type that is paid; without an RC it is what the employee said
  v_type := coalesce(nullif(v_rc->>'type', ''), nullif(p->>'type_code', ''));
  select * into v_vt from te_vehicle_types t where t.company_id = v_company and t.code = v_type;
  if not found then
    perform te_fail('TE_VEHICLE', 'Choose what vehicle it is.');
  end if;
  if not v_vt.is_active then
    perform te_fail('TE_VEHICLE', 'Your company does not pay for a ' || lower(v_vt.name) || '.');
  end if;
  if v_rc is null and coalesce((v_rules->>'rcCheck')::boolean, true) and v_photo is null then
    perform te_fail('TE_VEHICLE', 'Attach a photo of the RC. HR checks it before the vehicle is paid.');
  end if;
  if v_rc is not null and nullif(v_rc->>'rcValid', '') is not null and (v_rc->>'rcValid')::date < v_today then
    perform te_fail('TE_VEHICLE', 'The RC of ' || v_reg || ' has expired. It cannot be used for paid travel.');
  end if;

  v_whose := case when v_rc->>'match' = 'match' then 'self' else nullif(p->>'ownership', '') end;
  if v_whose is null then
    perform te_fail('TE_VEHICLE', case when v_rc is not null then 'The RC is in another name. Say whose vehicle it is.' else 'Say whose vehicle it is.' end);
  end if;
  if v_rules->>'owner' = 'self' and v_whose <> 'self' then
    perform te_fail('TE_VEHICLE', 'Your company pays only for a vehicle registered in your name.');
  end if;
  if v_rules->>'owner' = 'family' and v_whose = 'other' then
    perform te_fail('TE_VEHICLE', 'Your company pays only for your own vehicle or a family member’s.');
  end if;
  if v_rc is not null and v_rules->>'insurance' = 'block'
     and nullif(v_rc->>'insValid', '') is not null and (v_rc->>'insValid')::date < v_today then
    perform te_fail('TE_VEHICLE', 'The insurance of ' || v_reg || ' has expired. Renew it, then add the vehicle.');
  end if;

  insert into te_employee_vehicles (company_id, employee_id, reg_no, reg_no_norm, vehicle_type_code, declared_type_code,
      ownership, rc_source, rc, rc_owner_name, rc_owner_match, rc_valid_to, insurance_valid_to, puc_valid_to,
      rc_checked_at, rc_file_url, is_verified, verified_via, verified_at)
  values (v_company, v_emp, v_reg, v_norm, v_type, nullif(p->>'type_code', ''),
      v_whose, case when v_rc is not null then 'vahan' when v_photo is not null then 'photo' end, v_rc,
      v_rc->>'owner', nullif(v_rc->>'match', ''), nullif(v_rc->>'rcValid', '')::date,
      nullif(v_rc->>'insValid', '')::date, nullif(v_rc->>'pucValid', '')::date,
      case when v_rc is not null then now() end, v_photo,
      v_rc is not null, case when v_rc is not null then 'rc' end, case when v_rc is not null then now() end)
  returning id into v_id;

  perform te_log(v_company, 'vehicle', v_id, v_reg, 'VEHICLE_ADDED', p_actor,
    'Added vehicle ' || v_reg || case
      when v_rc is not null then '. RC: ' || coalesce(v_rc->>'maker', '') || ' ' || coalesce(v_rc->>'model', '') || ', paid as ' || v_vt.name
        || case when nullif(p->>'type_code', '') is distinct from v_type and nullif(p->>'type_code', '') is not null
                then ' (employee said ' || coalesce((select t.name from te_vehicle_types t where t.company_id = v_company and t.code = p->>'type_code'), p->>'type_code') || ')' else '' end
      else '. RC photo sent to HR' end);
  return jsonb_build_object('vehicle_id', v_id, 'vehicle_type_code', v_type, 'is_verified', v_rc is not null);
end;
$$;

-- HR looked at the RC photo and confirms (or corrects) the type.
create or replace function te_vehicle_verify(p_vehicle_id uuid, p_actor uuid, p_type_code text default null)
returns jsonb language plpgsql as $$
declare
  v te_employee_vehicles;
begin
  select * into v from te_employee_vehicles where id = p_vehicle_id for update;
  if not found then
    perform te_fail('TE_VEHICLE', 'Vehicle not found.');
  end if;
  if p_actor = v.employee_id then
    perform te_fail('TE_FORBIDDEN', 'Nobody verifies their own vehicle.');
  end if;
  if p_type_code is not null and not exists (select 1 from te_vehicle_types t where t.company_id = v.company_id and t.code = p_type_code) then
    perform te_fail('TE_VEHICLE', 'Choose the vehicle type shown on the RC.');
  end if;
  update te_employee_vehicles
     set vehicle_type_code = coalesce(p_type_code, vehicle_type_code),
         is_verified = true, verified_via = 'hr', verified_by = p_actor, verified_at = now()
   where id = p_vehicle_id;
  perform te_log(v.company_id, 'vehicle', v.id, v.reg_no, 'VEHICLE_VERIFIED', p_actor,
                 'Checked the RC of ' || v.reg_no || ': ' || coalesce((select t.name from te_vehicle_types t
                    where t.company_id = v.company_id and t.code = coalesce(p_type_code, v.vehicle_type_code)), ''));
  return jsonb_build_object('vehicle_id', v.id, 'vehicle_type_code', coalesce(p_type_code, v.vehicle_type_code));
end;
$$;


-- Take a vehicle off an employee's list (sold, mistyped, or HR moving it to
-- another employee, who then adds it). The row is kept, switched off, so old
-- claims still show what was driven. p_admin = the API checked the HR role.
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
    perform te_fail('TE_VEHICLE', v.reg_no || ' is on a leg that is not closed yet. Close or skip that leg first.');
  end if;
  update te_employee_vehicles set is_active = false where id = v.id;
  perform te_log(v.company_id, 'vehicle', v.id, v.reg_no, 'VEHICLE_REMOVED', p_actor, 'Removed vehicle ' || v.reg_no);
  return jsonb_build_object('vehicle_id', v.id, 'removed', true);
end;
$$;

-- Remove one of the employee's own saved places from the pick list. Trips that used it keep it.
create or replace function te_place_remove(p_place_id uuid, p_actor uuid)
returns jsonb language plpgsql as $$
begin
  update te_places set is_active = false where id = p_place_id and owner_employee_id = p_actor and is_active;
  if not found then
    perform te_fail('TE_PLACE', 'Place not found.');
  end if;
  return jsonb_build_object('place_id', p_place_id, 'removed', true);
end;
$$;


-- ============================================================================
-- SECTION 4 — TRIPS
-- ============================================================================

-- the co-travellers of a trip who are employees
create or replace function te_trip_co(p_trip_id uuid)
returns uuid[] language sql stable as $$
  select coalesce(array_agg(p.employee_id), '{}') from te_trip_people p where p.trip_id = p_trip_id and p.employee_id is not null;
$$;

-- (re)write the itinerary rows of a trip from the payload
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
    perform te_fail('TE_TRIP', 'This plan has no legs. Choose where you go and how.');
  end if;
end;
$$;

-- every leg of a trip recorded after the travel is a leg without GPS
create or replace function te__trip_mark_manual(p_trip_id uuid, p_reason text)
returns void language sql as $$
  update te_legs set status = 'ENDED', is_manual = true, no_gps_reason = coalesce(nullif(p_reason, ''), 'Recorded after the travel'),
                     ended_at = leg_date::timestamptz
   where trip_id = p_trip_id and status = 'PLANNED';
$$;

create or replace function te__trip_request_advance(p_trip te_trips, p_actor uuid)
returns void language plpgsql as $$
declare
  a      te_advances;
  v_days int;
  v_pct  int;
  v_cap  numeric;
begin
  select s.claim_deadline_days, s.advance_max_pct into v_days, v_pct from te_settings s where s.company_id = p_trip.company_id;
  if p_trip.advance_requested > 0 and p_trip.origin <> 'POST_FACTO' then
    -- the cap: a share of what the employee will pay, rounded down to ₹100
    v_cap := floor(p_trip.self_estimate * coalesce(v_pct, 80) / 100 / 100) * 100;
    if p_trip.advance_requested > v_cap then
      perform te_fail('TE_ADVANCE', 'Advance is above the cap of ' || te_rs(v_cap) || '.');
    end if;
    if exists (select 1 from te_advances x
                where x.employee_id = p_trip.employee_id and x.trip_id <> p_trip.id
                  and x.outstanding_amount > 0 and te_advance_status(x.id) = 'RECOVERY_DUE') then
      perform te_fail('TE_ADVANCE', 'An earlier advance is overdue. Settle it before asking for a new one.');
    end if;
  end if;
  select * into a from te_advances x where x.trip_id = p_trip.id and x.status not in ('REJECTED','CANCELLED');
  if found then
    if a.status = 'REQUESTED' then
      if p_trip.advance_requested > 0 then
        update te_advances set requested_amount = p_trip.advance_requested, due_date = p_trip.end_date + coalesce(v_days, 15) where id = a.id;
      else
        update te_advances set status = 'CANCELLED' where id = a.id;
      end if;
    end if;
  elsif p_trip.advance_requested > 0 and p_trip.origin <> 'POST_FACTO' then
    insert into te_advances (company_id, advance_no, trip_id, employee_id, requested_amount, due_date)
    values (p_trip.company_id, te_next_no(p_trip.company_id, 'advance'), p_trip.id, p_trip.employee_id,
            p_trip.advance_requested, p_trip.end_date + coalesce(v_days, 15));
  end if;
end;
$$;

-- freeze the settings and limits in force when the trip is approved
create or replace function te__trip_mark_approved(p_trip_id uuid)
returns void language plpgsql as $$
declare
  t te_trips;
begin
  select * into t from te_trips where id = p_trip_id;
  update te_trips
     set status = 'APPROVED', approved_at = now(),
         policy_snapshot = te_config(t.company_id) - 'checks' - 'cats' - 'ptypes' - 'stopReasons' - 'flows' - 'teams',
         policy_version = (select s.version from te_settings s where s.company_id = t.company_id)
   where id = p_trip_id;
end;
$$;

-- PLAN A TRIP, RECORD A PAST TRIP, OR EDIT ONE.
--
-- p = {
--   "trip_id": null,                      -- set to edit
--   "employee_id": "<uuid>",
--   "name","scope","pattern","origin","purpose","project","pax","stay_by","advance",
--   "post_facto_reason","post_facto_note",
--   "answer": "what I changed",           -- needed when the plan was sent back
--   "start_date","end_date","from_label","to_label","country",
--   "estimate": {"travel":…,"desk":…,"hotel":…,"meals":…,"conv":…},
--   "estimate_total","self_estimate","planned_km",          -- computed by the engine
--   "points":   [{"place_id","place_type","what","arrive_on","leave_on","is_return"}],
--   "segments": [{"mode","booked_by","vehicle_id","first_mile_mode","last_mile_mode","hub_from_place_id","hub_to_place_id"}],
--   "people":   [{"emp_code","name"}],
--   "legs":     [{"leg_no","segment_seq","kind","from_place_id","to_place_id","leg_date","mode","vehicle_id","booked_by","gps_mode","planned_km"}]
-- }
--
-- What happens to a new plan:
--   recorded after travel  -> DRAFT, every leg is a leg without GPS, the fares are added next
--   local, within the no-approval distance -> APPROVED at once
--   anything else          -> the trip chain is built; PENDING_APPROVAL, or APPROVED when no level applies
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
      perform te_fail('TE_TRIP', 'A leg already has a GPS record or a report. Delete the draft and record the trip again.');
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
           else 'Recorded after travel: ' || v_legs || ' leg' || case when v_legs = 1 then '' else 's' end || ', ' || v_km
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
           else 'Planned ' || v_legs || ' leg' || case when v_legs = 1 then '' else 's' end || ', ' || v_km
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
      'Planned ' || v_legs || ' legs, ' || v_km || ' km. No approval level applies to this plan in the workflow.');
    return jsonb_build_object('trip_id', t.id, 'trip_no', t.trip_no, 'status', 'APPROVED');
  end if;

  update te_trips set status = 'PENDING_APPROVAL' where id = t.id;
  perform te__notify_waiting('trip', t.id, 'Trip plan from ' || te_emp_name(v_emp), t.name || ', ' || te_rs(v_total) || ' estimated. Waiting for your approval.', p_actor);
  perform te_log(v_company, 'trip', t.id, t.trip_no, 'TRIP_SUBMITTED', p_actor,
    case when v_edit then 'Plan changed to ' || v_km || ' km. It now needs approval.'
         else 'Sent for approval. ' || v_legs || ' legs, ' || v_km || ' km by road' || case when v_flights then ' plus flights' else '' end
              || '. Estimate ' || te_rs(v_total)
              || case when t.advance_requested > 0 then ', advance asked ' || te_rs(t.advance_requested) else '' end || '.' end);
  return jsonb_build_object('trip_id', t.id, 'trip_no', t.trip_no, 'status', 'PENDING_APPROVAL', 'steps', v_steps);
end;
$$;

-- APPROVE, SEND BACK OR REJECT A TRIP PLAN.  p_action = approve | sendback | reject
create or replace function te_trip_decide(p_trip_id uuid, p_actor uuid, p_action text, p_comment text default null)
returns jsonb language plpgsql as $$
declare
  t       te_trips;
  st      te_approval_steps;
  v_why   text;
  v_desk  boolean;
  v_adv   boolean;
  v_note  text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into t from te_trips where id = p_trip_id for update;
  if not found then
    perform te_fail('TE_TRIP', 'Trip not found.');
  end if;
  if te_trip_status(t.id) = 'EXPIRED' then
    perform te_fail('TE_TRIP', 'The trip dates have passed. Ask the employee to record it as I already travelled.');
  end if;
  if t.status <> 'PENDING_APPROVAL' then
    perform te_fail('TE_NOT_WAITING', 'This trip is not waiting for you.');
  end if;
  if p_actor = t.employee_id then
    perform te_fail('TE_FORBIDDEN', 'Nobody approves their own trip.');
  end if;
  st := te_current_step('trip', t.id);
  v_why := te_step_block_reason(st, p_actor);
  if v_why <> '' then
    perform te_fail('TE_NOT_WAITING', v_why);
  end if;
  if p_action not in ('approve','sendback','reject') then
    perform te_fail('TE_TRIP', 'Unknown action.');
  end if;
  if p_action <> 'approve' and v_note is null then
    perform te_fail('TE_COMMENT', 'Write a comment so the employee knows why.');
  end if;

  if p_action = 'approve' then
    update te_approval_steps set status = 'approved', acted_by = p_actor, acted_at = now(), comment = v_note,
                                 delegated_from = case when p_actor <> st.approver_id then st.approver_id end
     where id = st.id;
    perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'TRIP_STEP_APPROVED', p_actor,
                   'Approved as ' || st.role_label || coalesce(': ' || v_note, '.'), true, null, null, st.role_label);
    if not exists (select 1 from te_approval_steps s where s.entity_type = 'trip' and s.entity_id = t.id and s.status = 'pending') then
      perform te__trip_mark_approved(t.id);
      v_desk := t.stay_by = 'desk' or exists (select 1 from te_legs l where l.trip_id = t.id and l.booked_by = 'desk');
      v_adv  := exists (select 1 from te_advances a where a.trip_id = t.id and a.status not in ('REJECTED','CANCELLED'));
      perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'TRIP_APPROVED', null,
                     'Trip approved. Policy version frozen.' || case when v_desk then ' Sent to Travel Desk.' else '' end
                       || case when v_adv then ' Advance sent to Finance.' else '' end);
      perform te_notify(t.employee_id, 'TRAVEL_APPROVED', 'Trip approved: ' || t.name, 'Your trip plan is approved.', '/ess?tab=claims&ref=' || t.id, 'NORMAL', p_actor);
      return jsonb_build_object('trip_id', t.id, 'status', 'APPROVED');
    end if;
    perform te__notify_waiting('trip', t.id, 'Trip plan from ' || te_emp_name(t.employee_id), t.name || ' is waiting for your approval.', p_actor);
    return jsonb_build_object('trip_id', t.id, 'status', 'PENDING_APPROVAL');

  elsif p_action = 'reject' then
    update te_approval_steps set status = 'rejected', acted_by = p_actor, acted_at = now(), comment = v_note where id = st.id;
    update te_approval_steps set status = 'cancelled' where entity_type = 'trip' and entity_id = t.id and status = 'pending';
    update te_trips set status = 'REJECTED' where id = t.id;
    -- money already given is recovered; a request that was never paid is dropped
    update te_advances set status = case when outstanding_amount > 0 then 'RECOVERY_DUE' else 'CANCELLED' end
     where trip_id = t.id and status not in ('REJECTED','CANCELLED','SETTLED');
    update te_legs set status = 'CANCELLED' where trip_id = t.id and status = 'PLANNED';
    perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'TRIP_REJECTED', p_actor, 'Rejected: ' || v_note, true, null, null, st.role_label);
    perform te_notify(t.employee_id, 'TRAVEL_REJECTED', 'Trip not approved: ' || t.name, v_note, '/ess?tab=claims&ref=' || t.id, 'HIGH', p_actor);
    return jsonb_build_object('trip_id', t.id, 'status', 'REJECTED');

  else
    -- the step stays pending: the same approver sees the plan again after the answer
    update te_trips set status = 'SENT_BACK' where id = t.id;
    insert into te_messages (entity_type, entity_id, author_id, body) values ('trip', t.id, p_actor, v_note);
    perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'TRIP_SENT_BACK', p_actor, 'Sent back: ' || v_note, true, null, null, st.role_label);
    perform te_notify(t.employee_id, 'TRAVEL_SENT_BACK', 'Trip plan needs your answer: ' || t.name, v_note, '/ess?tab=claims&ref=' || t.id, 'HIGH', p_actor);
    return jsonb_build_object('trip_id', t.id, 'status', 'SENT_BACK');
  end if;
end;
$$;

-- The employee answers a send-back without changing the plan.
create or replace function te_trip_answer(p_trip_id uuid, p_actor uuid, p_text text)
returns jsonb language plpgsql as $$
declare
  t te_trips;
begin
  select * into t from te_trips where id = p_trip_id for update;
  if not found or t.employee_id <> p_actor or t.status <> 'SENT_BACK' then
    perform te_fail('TE_TRIP', 'Nothing to answer.');
  end if;
  if coalesce(btrim(p_text), '') = '' then
    perform te_fail('TE_COMMENT', 'Write your answer.');
  end if;
  update te_trips set status = 'PENDING_APPROVAL' where id = t.id;
  insert into te_messages (entity_type, entity_id, author_id, body) values ('trip', t.id, p_actor, btrim(p_text));
  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'TRIP_ANSWERED', p_actor, 'Answered: ' || btrim(p_text));
  perform te__notify_waiting('trip', t.id, 'Trip plan answered by ' || te_emp_name(p_actor), left(btrim(p_text), 120), p_actor);
  return jsonb_build_object('trip_id', t.id, 'status', 'PENDING_APPROVAL');
end;
$$;

-- Cancel a trip that has not started. A draft recorded after travel is removed
-- the same way. The employee who owns it may cancel; so may anyone on its
-- approval chain; so may an admin (p_admin = the API checked the role).
drop function if exists te_trip_cancel(uuid, uuid);
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
      perform te_fail('TE_TRIP', 'This trip has started and can no longer be cancelled. Skip the legs you did not take.');
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
-- SECTION 5 — EXPENSES
-- ============================================================================

-- Write one expense line. Used by te_expense_save, te_leg_file and
-- te_booking_record; not called from the API directly.
create or replace function te__expense_write(p jsonb, p_actor uuid)
returns te_expenses language plpgsql as $$
declare
  v_id      uuid := nullif(p->>'expense_id', '')::uuid;
  v_emp     uuid := (p->>'employee_id')::uuid;
  v_company uuid;
  x         te_expenses;
  f         jsonb;
  v_con     text;
begin
  select company_id into v_company from employees where id = v_emp;
  if not exists (select 1 from te_categories c where c.company_id = v_company and c.code = p->>'category_code' and c.is_active) then
    perform te_fail('TE_EXPENSE', 'Choose what the expense was for.');
  end if;
  -- a bill the employee paid cannot be dated tomorrow; a ticket the Travel Desk booked for next week can
  if coalesce(nullif(p->>'paid_by', ''), 'self') = 'self' and (p->>'expense_date')::date > te_today(v_company) then
    perform te_fail('TE_EXPENSE', 'The date of an expense cannot be in the future.');
  end if;

  -- a bill abroad: the rupee amount is the foreign amount times the rate (within 1%, or ₹1)
  if coalesce(nullif(p->>'currency', ''), 'INR') <> 'INR' and nullif(p->>'fx_amount', '') is not null and nullif(p->>'fx_rate', '') is not null
     and abs(coalesce((p->>'bill_amount')::numeric, 0) - (p->>'fx_amount')::numeric * (p->>'fx_rate')::numeric)
         > greatest(1, 0.01 * (p->>'fx_amount')::numeric * (p->>'fx_rate')::numeric) then
    perform te_fail('TE_EXPENSE', 'The rupee amount does not match ' || (p->>'currency') || ' ' || (p->>'fx_amount') || ' at ₹' || (p->>'fx_rate') || '. Check the amount or the rate.');
  end if;

  begin
    if v_id is null then
      insert into te_expenses (company_id, expense_no, employee_id, trip_id, leg_id, booking_id, category_code, expense_date,
          check_in, check_out, merchant, merchant_gstin, bill_no, reference, travel_class, bill_amount, claimed_amount,
          currency, fx_amount, fx_rate, paid_by, payment_mode, description, employee_reason, wants_exception,
          vehicle_id, from_place_id, to_place_id, payable_km, rate_applied, client_name, attendees, details)
      values (v_company, te_next_no(v_company, 'expense'), v_emp, nullif(p->>'trip_id', '')::uuid, nullif(p->>'leg_id', '')::uuid,
          nullif(p->>'booking_id', '')::uuid, p->>'category_code', (p->>'expense_date')::date,
          nullif(p->>'check_in', '')::date, nullif(p->>'check_out', '')::date,
          nullif(btrim(p->>'merchant'), ''), nullif(upper(btrim(p->>'merchant_gstin')), ''), nullif(btrim(p->>'bill_no'), ''),
          nullif(upper(btrim(p->>'reference')), ''), nullif(p->>'travel_class', ''),
          coalesce((p->>'bill_amount')::numeric, 0), coalesce((p->>'claimed_amount')::numeric, 0),
          coalesce(nullif(p->>'currency', ''), 'INR'), nullif(p->>'fx_amount', '')::numeric, nullif(p->>'fx_rate', '')::numeric,
          coalesce(nullif(p->>'paid_by', ''), 'self'), nullif(p->>'payment_mode', ''), nullif(btrim(p->>'description'), ''),
          nullif(btrim(p->>'employee_reason'), ''), coalesce((p->>'wants_exception')::boolean, false),
          nullif(p->>'vehicle_id', '')::uuid, nullif(p->>'from_place_id', '')::uuid, nullif(p->>'to_place_id', '')::uuid,
          nullif(p->>'payable_km', '')::numeric, nullif(p->>'rate_applied', '')::numeric,
          nullif(btrim(p->>'client_name'), ''), nullif(p->>'attendees', '')::int, coalesce(p->'details', '{}'::jsonb))
      returning * into x;
    else
      update te_expenses set
          category_code = p->>'category_code', expense_date = (p->>'expense_date')::date,
          check_in = nullif(p->>'check_in', '')::date, check_out = nullif(p->>'check_out', '')::date,
          merchant = nullif(btrim(p->>'merchant'), ''), merchant_gstin = nullif(upper(btrim(p->>'merchant_gstin')), ''),
          bill_no = nullif(btrim(p->>'bill_no'), ''), reference = nullif(upper(btrim(p->>'reference')), ''),
          travel_class = nullif(p->>'travel_class', ''),
          bill_amount = coalesce((p->>'bill_amount')::numeric, 0), claimed_amount = coalesce((p->>'claimed_amount')::numeric, 0),
          currency = coalesce(nullif(p->>'currency', ''), 'INR'), fx_amount = nullif(p->>'fx_amount', '')::numeric,
          fx_rate = nullif(p->>'fx_rate', '')::numeric, payment_mode = nullif(p->>'payment_mode', ''),
          description = nullif(btrim(p->>'description'), ''), employee_reason = nullif(btrim(p->>'employee_reason'), ''),
          wants_exception = coalesce((p->>'wants_exception')::boolean, false),
          vehicle_id = nullif(p->>'vehicle_id', '')::uuid, from_place_id = nullif(p->>'from_place_id', '')::uuid,
          to_place_id = nullif(p->>'to_place_id', '')::uuid, payable_km = nullif(p->>'payable_km', '')::numeric,
          rate_applied = nullif(p->>'rate_applied', '')::numeric, client_name = nullif(btrim(p->>'client_name'), ''),
          attendees = nullif(p->>'attendees', '')::int, details = coalesce(p->'details', '{}'::jsonb),
          approved_amount = case when status = 'UNCLAIMED' then null else least(approved_amount, coalesce((p->>'claimed_amount')::numeric, 0)) end
          -- needs_fix stays as it is: a line marked to fix can be edited as often as
          -- needed until the employee answers the send-back (te_claim_respond clears it)
        where id = v_id
        returning * into x;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'uq_te_exp_invoice' then
      perform te_fail('TE_DUPLICATE_INVOICE', 'This invoice number from this supplier is already in a claim. A bill is paid once.');
    end if;
    raise;                                             -- anything else is a real error, not a duplicate bill
  end;

  if jsonb_typeof(p->'files') = 'array' then
    delete from te_expense_files where expense_id = x.id;
    for f in select * from jsonb_array_elements(p->'files') loop
      insert into te_expense_files (expense_id, company_id, kind, storage_path, file_name, mime_type, file_size, sha256, phash, ocr, metadata, uploaded_by)
      values (x.id, v_company, coalesce(nullif(f->>'kind', ''), 'BILL'), f->>'storage_path', f->>'file_name', f->>'mime_type',
              nullif(f->>'file_size', '')::int, nullif(f->>'sha256', ''), nullif(f->>'phash', ''), f->'ocr', f->'metadata', p_actor);
    end loop;
  end if;
  return x;
end;
$$;

-- ADD OR CHANGE AN EXPENSE LINE (the employee's own, self-paid).
-- p = {"expense_id","employee_id","trip_id","category_code","expense_date","check_in","check_out","merchant",
--      "merchant_gstin","bill_no","reference","travel_class","bill_amount","claimed_amount","currency","fx_amount",
--      "fx_rate","payment_mode","description","employee_reason","wants_exception","vehicle_id","from_place_id",
--      "to_place_id","payable_km","rate_applied","client_name","attendees","details":{}, "files":[…]}
-- For an own-vehicle line the amounts, payable_km and rate_applied are computed by the engine (mileage).
create or replace function te_expense_save(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  v_id   uuid := nullif(p->>'expense_id', '')::uuid;
  v_emp  uuid := nullif(p->>'employee_id', '')::uuid;
  v_trip uuid := nullif(p->>'trip_id', '')::uuid;
  prev   te_expenses;
  c      te_claims;
  x      te_expenses;
  v_cat  te_categories;
begin
  if v_emp is distinct from p_actor then
    perform te_fail('TE_FORBIDDEN', 'You can only add your own expenses.');
  end if;
  perform te_assert_active(v_emp);

  if v_id is not null then
    select * into prev from te_expenses where id = v_id for update;
    if not found or prev.employee_id <> v_emp then
      perform te_fail('TE_EXPENSE', 'Expense not found.');
    end if;
    if prev.paid_by = 'company' then
      perform te_fail('TE_EXPENSE', 'This was booked and paid by the company. It cannot be changed here.');
    end if;
    if prev.status <> 'UNCLAIMED' then
      select * into c from te_claims where id = prev.claim_id;
      if not (c.status = 'SENT_BACK' and (prev.needs_fix or c.fix_all)) then
        perform te_fail('TE_EXPENSE', 'This line is in a claim and cannot be changed now.');
      end if;
    end if;
    v_trip := prev.trip_id;
  end if;

  if v_trip is not null and not exists (select 1 from te_trips t where t.id = v_trip and t.employee_id = v_emp) then
    perform te_fail('TE_EXPENSE', 'That trip is not yours.');
  end if;
  if v_trip is not null and exists (select 1 from te_trips t where t.id = v_trip and t.status in ('REJECTED','CANCELLED')) then
    perform te_fail('TE_EXPENSE', 'This trip was cancelled or rejected. Nothing can be added to it.');
  end if;
  select * into v_cat from te_categories k
   where k.company_id = (select company_id from employees where id = v_emp) and k.code = p->>'category_code';
  if found and v_cat.needs_trip and v_trip is null then
    perform te_fail('TE_EXPENSE', v_cat.name || ' belongs to a trip. Add it inside the trip.');
  end if;

  -- the leg a line belongs to is never taken from the browser
  x := te__expense_write(p || jsonb_build_object('trip_id', v_trip, 'paid_by', 'self', 'leg_id', prev.leg_id,
                                                 'booking_id', null), p_actor);
  if v_id is null then
    perform te_log(x.company_id, 'expense', x.id, x.expense_no, 'EXPENSE_SAVED', p_actor, 'Saved expense line');
  else
    perform te_log(x.company_id, 'expense', x.id, x.expense_no, 'EXPENSE_EDITED', p_actor,
                   'Changed expense line' || case when prev.claimed_amount is distinct from x.claimed_amount
                     then ': claimed ' || te_rs(prev.claimed_amount) || ' to ' || te_rs(x.claimed_amount) else '' end, true,
                   jsonb_build_object('bill_amount', prev.bill_amount, 'claimed_amount', prev.claimed_amount, 'expense_date', prev.expense_date, 'merchant', prev.merchant, 'bill_no', prev.bill_no),
                   jsonb_build_object('bill_amount', x.bill_amount, 'claimed_amount', x.claimed_amount, 'expense_date', x.expense_date, 'merchant', x.merchant, 'bill_no', x.bill_no));
    if prev.claim_id is not null then
      perform te_log(x.company_id, 'claim', prev.claim_id, (select k.claim_no from te_claims k where k.id = prev.claim_id), 'LINE_EDITED', p_actor,
                     'Edited line ' || coalesce(x.merchant, x.category_code) || case when prev.claimed_amount is distinct from x.claimed_amount
                       then ': ' || te_rs(prev.claimed_amount) || ' to ' || te_rs(x.claimed_amount) else '' end);
    end if;
  end if;
  return jsonb_build_object('expense_id', x.id, 'expense_no', x.expense_no, 'status', x.status);
end;
$$;

-- Throw away a saved line that is not in a claim. The row is kept (status
-- DISCARDED) so the audit trail and the duplicate checks still see it existed.
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
    perform te_fail('TE_EXPENSE', 'This line is the report of a leg. Change the fare in the leg instead.');
  end if;
  update te_expenses set status = 'DISCARDED' where id = x.id;
  perform te_log(x.company_id, 'expense', x.id, x.expense_no, 'EXPENSE_DISCARDED', p_actor, 'Removed expense line');
  return jsonb_build_object('expense_id', x.id, 'status', 'DISCARDED');
end;
$$;


-- ============================================================================
-- SECTION 6 — TRAVEL DESK
-- ============================================================================

-- The Travel Desk books one ticket leg, or the stay at one point of the trip.
-- p = {"trip_id","leg_id" | "point_seq","vendor","reference","amount","ticket_url"}
-- The booking also becomes a company-paid line of the trip, so the trip cost
-- sheet shows it and check B7 can catch the employee claiming the same ticket.
create or replace function te_booking_record(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  t       te_trips;
  l       te_legs;
  pt      te_trip_points;
  b       te_bookings;
  x       te_expenses;
  v_leg   uuid := nullif(p->>'leg_id', '')::uuid;
  v_seq   int  := nullif(p->>'point_seq', '')::int;
  v_cat   text;
begin
  select * into t from te_trips where id = (p->>'trip_id')::uuid for update;
  if not found then
    perform te_fail('TE_BOOKING', 'Trip not found.');
  end if;
  if t.status <> 'APPROVED' then
    perform te_fail('TE_BOOKING', 'Only an approved trip can be booked.');
  end if;
  if coalesce(btrim(p->>'vendor'), '') = '' or coalesce(btrim(p->>'reference'), '') = '' or coalesce((p->>'amount')::numeric, 0) <= 0 then
    perform te_fail('TE_BOOKING', 'Enter vendor, reference and amount.');
  end if;
  if v_leg is not null then
    select * into l from te_legs where id = v_leg and trip_id = t.id;
  elsif v_seq is not null then
    select * into pt from te_trip_points where trip_id = t.id and seq = v_seq;
  end if;
  if l.id is null and pt.id is null then
    perform te_fail('TE_BOOKING', 'Choose what is booked.');
  end if;

  insert into te_bookings (company_id, booking_no, trip_id, leg_id, point_seq, kind, vendor, reference, amount, ticket_url, booked_by)
  values (t.company_id, te_next_no(t.company_id, 'booking'), t.id, l.id, case when l.id is null then v_seq end,
          case when l.id is not null then 'travel' else 'hotel' end, btrim(p->>'vendor'), upper(btrim(p->>'reference')),
          (p->>'amount')::numeric, nullif(p->>'ticket_url', ''), p_actor)
  returning * into b;

  if l.id is not null then
    select coalesce(m.category_code, 'air') into v_cat from te_modes m where m.company_id = t.company_id and m.code = l.mode;
  end if;
  x := te__expense_write(jsonb_build_object(
         'employee_id', t.employee_id, 'trip_id', t.id, 'leg_id', l.id, 'booking_id', b.id,
         'category_code', case when l.id is not null then coalesce(v_cat, 'air') else 'hotel' end,
         'expense_date', coalesce(l.leg_date, pt.arrive_on, t.start_date),
         'check_in', pt.arrive_on, 'check_out', pt.leave_on,
         'merchant', b.vendor, 'reference', b.reference, 'bill_amount', b.amount, 'claimed_amount', 0,
         'paid_by', 'company', 'payment_mode', 'Paid by company',
         'description', 'Booked by Travel Desk, ' || b.booking_no), p_actor);

  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'BOOKED', p_actor,
                 'Travel Desk booked ' || b.vendor || ' (' || b.reference || ') for ' || te_rs(b.amount) || '. Paid by company.');
  return jsonb_build_object('booking_id', b.id, 'booking_no', b.booking_no, 'expense_id', x.id);
end;
$$;


-- The Travel Desk cancels a booking (the ticket was cancelled or booked again).
-- Its company-paid line leaves the trip cost sheet. Refused once that line has
-- gone into a claim: by then Finance has seen it.
create or replace function te_booking_cancel(p_booking_id uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql as $$
declare
  b te_bookings;
  t te_trips;
begin
  select * into b from te_bookings where id = p_booking_id for update;
  if not found or b.status = 'CANCELLED' then
    perform te_fail('TE_BOOKING', 'Booking not found.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    perform te_fail('TE_COMMENT', 'Say why the booking is cancelled.');
  end if;
  if exists (select 1 from te_expenses x where x.booking_id = b.id and x.status <> 'UNCLAIMED') then
    perform te_fail('TE_BOOKING', 'This booking is already part of a claim. Ask Finance to correct it there.');
  end if;
  select * into t from te_trips where id = b.trip_id;
  update te_bookings set status = 'CANCELLED' where id = b.id;
  update te_expenses set status = 'DISCARDED' where booking_id = b.id and status = 'UNCLAIMED';
  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'BOOKING_CANCELLED', p_actor,
                 'Travel Desk cancelled booking ' || b.booking_no || ' (' || b.vendor || ', ' || b.reference || '): ' || btrim(p_reason) || '.');
  return jsonb_build_object('booking_id', b.id, 'status', 'CANCELLED');
end;
$$;


-- ============================================================================
-- SECTION 7 — LEGS
-- ============================================================================

create or replace function te__leg_for_actor(p_leg_id uuid, p_actor uuid)
returns te_legs language plpgsql as $$
declare
  l te_legs;
begin
  select * into l from te_legs where id = p_leg_id for update;
  if not found or l.employee_id is distinct from p_actor then
    perform te_fail('TE_LEG', 'Leg not found.');
  end if;
  perform te_assert_active(p_actor);
  return l;
end;
$$;

create or replace function te__leg_log(l te_legs, p_action text, p_summary text, p_actor uuid)
returns void language sql as $$
  select te_log(l.company_id, 'leg', l.id,
                (select t.trip_no from te_trips t where t.id = l.trip_id) || ' leg ' || l.leg_no,
                p_action, p_actor, p_summary);
$$;

-- When the last open leg of a trip closes: say so, and close the trip outright
-- when there is nothing to claim on it.
create or replace function te__after_leg(p_trip_id uuid, p_actor uuid)
returns void language plpgsql as $$
declare
  t te_trips;
begin
  if exists (select 1 from te_legs l where l.trip_id = p_trip_id and l.status in ('PLANNED','ACTIVE','PAUSED','ENDED')) then
    return;
  end if;
  select * into t from te_trips where id = p_trip_id;
  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'LEGS_CLOSED', p_actor, 'All legs are closed.');
  if not exists (select 1 from te_expenses x where x.trip_id = t.id and x.status = 'UNCLAIMED' and x.paid_by = 'self')
     and not exists (select 1 from te_claims c where c.trip_id = t.id and c.status <> 'CANCELLED') then
    update te_trips set status = 'CLOSED' where id = t.id and status in ('APPROVED','DRAFT');
    perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'TRIP_CLOSED', null, 'Nothing to claim on this trip. Closed.');
  end if;
end;
$$;

-- START A LEG, OR CHECK IN AT THE START.
-- p_fix = {"lat","lng","accuracy_m","address","recorded_at","device":{…}}  — the phone's GPS fix
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
    perform te_fail('TE_LEG', 'This leg cannot be started.');
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
    perform te_fail('TE_LEG', 'Finish or skip leg ' || v_prev || ' first.');
  end if;
  if v_today > t.end_date + 1 then
    perform te_fail('TE_LEG', 'The trip dates are over. Add this leg without GPS, or skip it.');
  end if;
  if l.leg_date > v_today then
    perform te_fail('TE_LEG', 'This leg is planned for ' || to_char(l.leg_date, 'Dy, FMDD Mon') || '.');
  end if;
  if exists (select 1 from te_legs k where k.employee_id = l.employee_id and k.status in ('ACTIVE','PAUSED')) then
    perform te_fail('TE_LEG_RUNNING', 'End the leg that is running first.');
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
    perform te_fail('TE_LEG_RUNNING', 'End the leg that is running first.');
  end;
  insert into te_leg_pings (leg_id, seq, recorded_at, lat, lng, accuracy_m, is_mock)
  values (l.id, 1, v_at, (p_fix->>'lat')::numeric, (p_fix->>'lng')::numeric, nullif(p_fix->>'accuracy_m', '')::numeric,
          nullif(p_fix->>'is_mock', '')::boolean)
  on conflict do nothing;

  select p.short_name into v_name from te_places p where p.id = l.from_place_id;
  perform te__leg_log(l, 'LEG_STARTED',
    case when l.gps_mode = 'checkin' then 'Checked in at ' else 'Leg started at ' end || coalesce(v_name, 'the start')
      || '. GPS fix within ' || coalesce(round((p_fix->>'accuracy_m')::numeric)::text, '?') || ' m, '
      || v_off || ' m from the planned point.', p_actor);
  return jsonb_build_object('leg_id', l.id, 'status', 'ACTIVE', 'start_off_m', v_off);
end;
$$;

-- THE GPS TRAIL. The app sends fixes in batches (every ping, or all at once
-- when the phone was offline). p_pings = [{"lat","lng","accuracy_m","speed_kmh","recorded_at","is_mock"}]
-- A late batch is accepted until the leg report is saved.
create or replace function te_leg_pings_add(p_leg_id uuid, p_actor uuid, p_pings jsonb)
returns jsonb language plpgsql as $$
declare
  l      te_legs;
  v_base int;
  v_n    int;
begin
  select * into l from te_legs where id = p_leg_id;
  if not found or l.employee_id is distinct from p_actor then
    perform te_fail('TE_LEG', 'Leg not found.');
  end if;
  if l.status not in ('ACTIVE','PAUSED','ENDED') or l.started_at is null then
    perform te_fail('TE_LEG', 'This leg is not recording.');
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

-- A STOP ON THE WAY. p_stop = {"reason_code","note","lat","lng","accuracy_m","address","place_name","recorded_at"}
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
    perform te_fail('TE_STOP', 'Start the leg first.');
  end if;
  select * into m from te_modes where company_id = l.company_id and code = l.mode;
  if not coalesce(m.stops_allowed, false) then
    perform te_fail('TE_STOP', case when l.mode = 'flight'
      then 'A stop cannot be added during a flight. A connecting flight is a leg of its own.'
      else 'On a ' || lower(coalesce(m.name, 'ride like this')) || ' the stops are the operator’s. If you get off, end this leg and start a new one.' end);
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

-- CONTINUE AFTER A STOP. The minutes are measured from the stop's start unless given.
create or replace function te_leg_stop_end(p_leg_id uuid, p_actor uuid, p_minutes int default null, p_at timestamptz default null)
returns jsonb language plpgsql as $$
declare
  l te_legs := te__leg_for_actor(p_leg_id, p_actor);
  s te_leg_stops;
  v_end timestamptz;
  v_min int;
begin
  select * into s from te_leg_stops where leg_id = l.id order by seq desc limit 1;
  if l.status <> 'PAUSED' or s.id is null or s.ended_at is not null then
    perform te_fail('TE_STOP', 'You are not at a stop.');
  end if;
  v_end := coalesce(p_at, case when p_minutes is not null then s.started_at + make_interval(mins => p_minutes) else now() end);
  v_min := greatest(1, coalesce(p_minutes, round(extract(epoch from (v_end - s.started_at)) / 60)::int));
  update te_leg_stops set ended_at = v_end, minutes = v_min where id = s.id;
  update te_legs set status = 'ACTIVE' where id = l.id;
  perform te__leg_log(l, 'STOP_ENDED', 'Left the stop after ' || v_min || ' min.', p_actor);
  return jsonb_build_object('leg_id', l.id, 'stop_id', s.id, 'minutes', v_min, 'status', 'ACTIVE');
end;
$$;

-- END A LEG, OR CHECK IN ON ARRIVAL.
-- p_fix   = {"lat","lng","accuracy_m","address","recorded_at"}
-- p_stats = {"gps_km","route_km","payable_km","gps_points","gps_gap_max_sec","gps_max_speed_kmh","moving_minutes",
--            "route_polyline","stats":{…}}
--           computed by the engine (jStats, viaKm) from the stored pings. "stats"
--           is the engine's whole result, kept as it is. When p_stats is left
--           out, gps_km is the plain distance along the pings.
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
    perform te_fail('TE_LEG', 'This leg is not running.');
  end if;
  if p_fix->>'lat' is null or p_fix->>'lng' is null then
    perform te_fail('TE_GPS', 'Your location is needed to end the leg.');
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
         else 'Leg ended at ' || coalesce(v_name, 'the destination') || '. ' || v_km || ' km recorded from ' || (v_n + 1) || ' location points.' end
      || ' ' || v_off || ' m from the planned point.', p_actor);
  return jsonb_build_object('leg_id', l.id, 'status', 'ENDED', 'gps_km', v_km, 'end_off_m', v_off);
end;
$$;

-- THE LEG REPORT: what the employee paid for this leg.
-- p_expense is the line the engine built (legLine) with its amounts, or null
-- when there is nothing to claim: a company vehicle, or a ticket the Travel
-- Desk booked. A blocked line never reaches here: the API runs the engine's
-- preview first and refuses it.
create or replace function te_leg_file(p_leg_id uuid, p_actor uuid, p_expense jsonb default null)
returns jsonb language plpgsql as $$
declare
  l        te_legs := te__leg_for_actor(p_leg_id, p_actor);
  m        te_modes;
  x        te_expenses;
  v_booked boolean;
begin
  if l.status <> 'ENDED' then
    perform te_fail('TE_LEG', 'End the leg first.');
  end if;
  select * into m from te_modes where company_id = l.company_id and code = l.mode;
  v_booked := exists (select 1 from te_bookings b where b.leg_id = l.id and b.status <> 'CANCELLED');

  if m.basis = 'none' or (m.basis = 'ticket' and l.booked_by = 'desk' and v_booked) then
    update te_legs set status = 'SUBMITTED', filed_at = now() where id = l.id;
    perform te__leg_log(l, 'LEG_FILED', case when m.basis = 'none' then 'Leg closed. Company vehicle, nothing to claim.'
                                             else 'Leg closed. The ticket was booked and paid by the company.' end, p_actor);
  else
    if p_expense is null then
      perform te_fail('TE_LEG', 'Add what you paid for this leg.');
    end if;
    x := te__expense_write(p_expense || jsonb_build_object(
           'expense_id', null, 'employee_id', l.employee_id, 'trip_id', l.trip_id, 'leg_id', l.id, 'paid_by', 'self',
           'expense_date', l.leg_date, 'vehicle_id', l.vehicle_id,
           'from_place_id', l.from_place_id, 'to_place_id', l.to_place_id), p_actor);
    update te_legs set status = 'SUBMITTED', filed_at = now(), expense_id = x.id,
                       payable_km = coalesce(x.payable_km, payable_km) where id = l.id;
    perform te__leg_log(l, 'LEG_FILED', 'Leg report saved. ' || te_rs(x.claimed_amount) || ' claimed.', p_actor);
  end if;
  perform te__after_leg(l.trip_id, p_actor);
  return jsonb_build_object('leg_id', l.id, 'status', 'SUBMITTED', 'expense_id', x.id,
                            'trip_status', te_trip_status(l.trip_id));
end;
$$;

-- A leg that was not needed.
create or replace function te_leg_skip(p_leg_id uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql as $$
declare
  l te_legs := te__leg_for_actor(p_leg_id, p_actor);
begin
  if l.status <> 'PLANNED' then
    perform te_fail('TE_LEG', 'Only a leg that has not started can be skipped.');
  end if;
  if not exists (select 1 from te_trips t where t.id = l.trip_id and t.status = 'APPROVED') then
    perform te_fail('TE_LEG', 'The trip is not open for travel.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    perform te_fail('TE_COMMENT', 'Say why this leg was not needed.');
  end if;
  update te_legs set status = 'SKIPPED', skip_reason = btrim(p_reason) where id = l.id;
  perform te__leg_log(l, 'LEG_SKIPPED', 'Skipped: ' || btrim(p_reason) || '.', p_actor);
  perform te__after_leg(l.trip_id, p_actor);
  return jsonb_build_object('leg_id', l.id, 'status', 'SKIPPED', 'trip_status', te_trip_status(l.trip_id));
end;
$$;

-- A leg that happened without GPS. On a local trip the days-back limit and the
-- monthly limit apply (Trip and GPS rules: pastDays, pastPerMonth).
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
    perform te_fail('TE_LEG', 'This leg cannot be added now.');
  end if;
  select * into t from te_trips where id = l.trip_id;
  if t.status <> 'APPROVED' then
    perform te_fail('TE_LEG', case when t.status = 'PENDING_APPROVAL' then 'The trip is waiting for approval.' else 'The trip is not open for travel.' end);
  end if;
  select s.gps_rules into v_rules from te_settings s where s.company_id = l.company_id;
  v_today := te_today(l.company_id);
  if l.leg_date > v_today then
    perform te_fail('TE_LEG', 'This leg is in the future.');
  end if;
  if not coalesce((v_rules->>'manualAllowed')::boolean, true) then
    perform te_fail('TE_LEG', 'Your company accepts legs only with a GPS record.');
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
      perform te_fail('TE_LEG', 'You have added ' || v_used || ' legs without GPS in ' || to_char(l.leg_date, 'FMMonth')
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

-- A LEG NOBODY PLANNED: a ride at the destination, or a change of plan. It
-- goes in after the last leg that has begun; the later legs move down one.
-- p_leg = {"from_place_id","to_place_id","mode","vehicle_id","why","gps_mode","planned_km",
--          "next_planned_km","next_gps_mode"}
-- gps_mode and planned_km are computed by the engine (legGps, legKm). The next_
-- pair is for the planned leg that follows, which now starts where this one ends.
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
    perform te_fail('TE_LEG', 'Legs can be added only during the trip.');
  end if;
  if v_from is null or v_to is null or not exists (select 1 from te_places where id = v_from) or not exists (select 1 from te_places where id = v_to) then
    perform te_fail('TE_LEG', 'Choose where the leg starts and ends.');
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
      update te_legs set status = 'SKIPPED', skip_reason = 'Replaced by the leg added before it' where id = nx.id;
      perform te__leg_log(nx, 'LEG_SKIPPED', 'Skipped: the added leg goes to the same place.', p_actor);
    else
      update te_legs set from_place_id = v_to,
                         planned_km = coalesce(nullif(p_leg->>'next_planned_km', '')::numeric, planned_km),
                         gps_mode = coalesce(nullif(p_leg->>'next_gps_mode', ''), gps_mode)
       where id = nx.id;
      perform te__leg_log(nx, 'LEG_REWIRED', 'Now starts at ' || (select short_name from te_places where id = v_to) || ' instead of '
                           || (select short_name from te_places where id = nx.from_place_id) || ', because a leg was added before it.', p_actor);
    end if;
  end if;
  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'LEG_ADDED', p_actor,
                 'Leg added: ' || (select short_name from te_places where id = v_from) || ' to '
                   || (select short_name from te_places where id = v_to) || ' by ' || lower(m.name) || '.');
  return jsonb_build_object('leg_id', l.id, 'leg_no', v_at);
end;
$$;

-- A local trip whose day passed with no leg started: every planned leg becomes
-- a leg without GPS, within the days-back limit.
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
  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'TRIP_RECORDED_LATE', p_actor, 'Not tracked on the day. Legs added without GPS.');
  return jsonb_build_object('trip_id', t.id, 'status', te_trip_status(t.id));
end;
$$;

notify pgrst, 'reload schema';
