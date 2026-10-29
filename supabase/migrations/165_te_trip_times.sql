-- 165_te_trip_times.sql — a trip can say what TIME it leaves and gets back,
-- not only what day.
-- SAFE TO RUN TWICE. Independent of every other pending migration.
-- ----------------------------------------------------------------------------
-- WHY. te_trip_points has carried arrive_on and leave_on as DATES since
-- migration 144, so the planner could only ever ask what day. "I leave on the
-- 16th" does not tell an approver, or the Travel Desk booking the ticket,
-- whether that is a 6am flight needing a cab at 4 or an evening train. The
-- planner's step 2 now asks for the time beside each date, and this is where
-- it is kept.
--
-- NULLABLE, AND NULL IS NOT MIDNIGHT. Every trip planned before these columns
-- existed has no time, and so does any trip whose traveller only knows the
-- date. '' from the form becomes NULL here rather than 00:00, because a trip
-- that leaves at midnight and a trip whose departure time nobody recorded are
-- different facts and must not read the same.
--
-- time, NOT timestamptz. The date is already its own column, and a trip's
-- departure is a wall-clock time where the traveller is standing — 6am in
-- Mumbai is 6am whatever the server thinks. Storing it as an instant would
-- invite a timezone conversion that is wrong for an international trip, which
-- is exactly the case this field matters most for.
--
-- NOTHING COMPUTES ON IT YET, deliberately. No estimate, no leg date, no
-- approval rule reads these columns: the time is recorded, shown to the
-- approver and shown to the Travel Desk. Making the engine derive leg
-- timings from it is a separate change with its own refusals to design.
--
-- Two functions are replaced, each taken verbatim from its CURRENT definition:
--   te__trip_write_parts  from 156  (NOT 146 — 146's copy predates the
--                                    journey wording and would revert it)
--   te_trip_json          from 159  (NOT 158 or 148 — 159 added the stay
--                                    decision fields this must keep)
-- ============================================================================

alter table te_trip_points add column if not exists leave_at  time;
alter table te_trip_points add column if not exists arrive_at time;

comment on column te_trip_points.leave_at is
  'Local wall-clock time of departure from this place. NULL = not recorded, which is not the same as midnight.';
comment on column te_trip_points.arrive_at is
  'Local wall-clock time of arrival at this place. NULL = not recorded.';

-- ── the times are written with the rest of the point ────────────────────────
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
    insert into te_trip_points (trip_id, seq, place_id, place_type, what, arrive_on, leave_on, is_return,
                                leave_at, arrive_at)
    values (p_trip.id, i, (r->>'place_id')::uuid, nullif(r->>'place_type', ''), nullif(btrim(r->>'what'), ''),
            nullif(r->>'arrive_on', '')::date, nullif(r->>'leave_on', '')::date, coalesce((r->>'is_return')::boolean, false),
            -- A time of day, or nothing. Nothing is the honest answer for every
            -- trip planned before these columns existed, and for anybody who
            -- only knows the date.
            nullif(r->>'leave_at', '')::time, nullif(r->>'arrive_at', '')::time);
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
-- ── and read back for the planner and the approver ──────────────────────────
create or replace function te_trip_json(t te_trips)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'no', t.trip_no, 'emp', t.employee_id, 'co', to_jsonb(te_trip_co(t.id)),
    'status', t.status, 'display', te_trip_status(t.id), 'origin', t.origin,
    'name', t.name, 'scope', t.scope, 'pattern', t.pattern, 'purpose', t.purpose, 'project', coalesce(t.project, ''),
    'points', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'place', p.place_id, 'pt', coalesce(p.place_type, ''), 'what', coalesce(p.what, ''),
                 'arrive', coalesce(p.arrive_on::text, ''), 'leave', coalesce(p.leave_on::text, ''),
                 -- HH:MM, not HH:MM:SS: it goes straight into <input type="time">,
                 -- which rejects seconds.
                 'leaveAt', coalesce(to_char(p.leave_at, 'HH24:MI'), ''),
                 'arriveAt', coalesce(to_char(p.arrive_at, 'HH24:MI'), ''),
                 'ret', case when p.is_return then true end)) order by p.seq), '[]'::jsonb)
                 from te_trip_points p where p.trip_id = t.id),
    'segs', (select coalesce(jsonb_agg(jsonb_build_object(
                 'mode', s.mode, 'bookedBy', s.booked_by, 'vehicleId', s.vehicle_id,
                 'xfer', jsonb_strip_nulls(jsonb_build_object('first', s.first_mile_mode, 'last', s.last_mile_mode,
                                                              'hubA', s.hub_from_place_id, 'hubB', s.hub_to_place_id))) order by s.seq), '[]'::jsonb)
               from te_trip_segments s where s.trip_id = t.id),
    'pax', t.pax,
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', q.emp_code_entered, 'name', q.name_entered,
                                                            'emp', q.employee_id, 'found', q.found_in_ezer) order by q.seq), '[]'::jsonb)
                 from te_trip_people q where q.trip_id = t.id),
    'start', t.start_date, 'end', t.end_date,
    'from', coalesce(t.from_label, ''), 'to', coalesce(t.to_label, ''),
    'fromPlace', (select p.place_id from te_trip_points p where p.trip_id = t.id and p.seq = 0),
    'type', case when t.scope = 'international' then 'international' else 'domestic' end,
    'country', coalesce(t.country, ''),
    'estimate', t.estimate, 'estimateTotal', t.estimate_total, 'selfEstimate', t.self_estimate, 'plannedKm', t.planned_km,
    'stayBy', t.stay_by, 'advance', t.advance_requested,
    -- Did they ask for a stay, did they ask for food, and which hotels would
    -- they accept. stayWanted/foodWanted are null on a trip planned before the
    -- question existed, so the screens can tell "no" from "never asked".
    'stayWanted', t.stay_wanted, 'foodWanted', t.food_wanted,
    'stayOptions', coalesce(t.stay_options, '[]'::jsonb),
    -- What the desk decided about those hotels, if anything yet. 'NONE' is
    -- "waiting", which is what the desk's own list is built from.
    'stay', jsonb_build_object(
       'status', coalesce(t.stay_status, 'NONE'), 'chosen', t.stay_chosen,
       'name', coalesce(t.stay_chosen_name, ''), 'remark', coalesce(t.stay_remark, ''),
       'by', t.stay_decided_by, 'at', t.stay_decided_at,
       -- te_emp_name(null) answers 'EZER', which would make an undecided trip
       -- look like somebody decided it. Undecided stays null.
       'byName', case when t.stay_decided_by is not null then te_emp_name(t.stay_decided_by) end),
    'pfReason', coalesce(t.post_facto_reason, ''), 'pfNote', coalesce(t.post_facto_note, ''),
    'legIds', (select coalesce(jsonb_agg(l.id order by l.leg_no), '[]'::jsonb) from te_legs l where l.trip_id = t.id),
    'chain', te_steps_json('trip', t.id), 'why', to_jsonb(t.chain_notes),
    'createdAt', t.created_at, 'approvedAt', t.approved_at);
$$;
notify pgrst, 'reload schema';
