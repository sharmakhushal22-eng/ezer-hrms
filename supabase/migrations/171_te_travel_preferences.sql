-- 171_te_travel_preferences.sql -- what the traveller asks the desk to book.
-- SAFE TO RUN TWICE. Three columns, two functions and one view. No data moves.
-- ----------------------------------------------------------------------------
-- WHY. The plan says "Mumbai to Jaipur by flight on the 2nd". That is not
-- enough to buy a ticket: there are a dozen flights that day. The Travel Desk
-- has been guessing, or writing to the traveller to ask. These are the answers
-- to the questions it would have asked.
--
--   pref_time  the time of day they want to leave
--   pref_url   a link to the flight, train or fare they found
--   pref_note  anything the other two cannot say -- "either the 6am or after
--              8pm", "same airline as the outbound"
--
-- ALL THREE ARE OPTIONAL and nothing computes on them. The leg's own date and
-- times stay on the route where they belong; these are a request, not a fact.
-- A trip that says none of them is exactly the trip that was sent before.
--
-- NOT ON YOUR OWN VEHICLE. Nothing is booked when you drive yourself, so the
-- planner does not ask. That is a screen decision, not a constraint here: the
-- columns are on every segment and an own-vehicle one simply leaves them null.
--
-- v_te_to_book CARRIES THEM, so the desk sees the request beside the leg it is
-- about rather than having to open the trip. Left-joined: a leg added during
-- the trip has no segment behind it.
--
-- DERIVED FROM 170 (both functions) and 145 (the view): each taken verbatim,
-- patched, and diffed to prove nothing else moved.
-- ============================================================================

alter table te_trip_segments add column if not exists pref_time time;
alter table te_trip_segments add column if not exists pref_url  text;
alter table te_trip_segments add column if not exists pref_note text;

comment on column te_trip_segments.pref_time is
  'Time of day the traveller would like to leave on this segment. A request to the Travel Desk, not a fact: nothing computes on it.';
comment on column te_trip_segments.pref_url is
  'Link to the flight, train or fare the traveller found, for the desk to match.';
comment on column te_trip_segments.pref_note is
  'Anything pref_time and pref_url cannot say.';

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
                                leave_at, arrive_at, is_stop)
    values (p_trip.id, i, (r->>'place_id')::uuid, nullif(r->>'place_type', ''), nullif(btrim(r->>'what'), ''),
            nullif(r->>'arrive_on', '')::date, nullif(r->>'leave_on', '')::date, coalesce((r->>'is_return')::boolean, false),
            -- A time of day, or nothing. Nothing is the honest answer for every
            -- trip planned before these columns existed, and for anybody who
            -- only knows the date.
            nullif(r->>'leave_at', '')::time, nullif(r->>'arrive_at', '')::time,
            -- A place passed through rather than the one being travelled to.
            -- Absent on every trip saved before this column, which reads as
            -- false and keeps those trips exactly as they were.
            coalesce((r->>'is_stop')::boolean, false));
    i := i + 1;
  end loop;
  if i < 2 then
    perform te_fail('TE_TRIP', 'A trip needs a start and at least one place to go.');
  end if;

  i := 0;
  for r in select * from jsonb_array_elements(coalesce(p->'segments', '[]'::jsonb)) loop
    insert into te_trip_segments (trip_id, seq, mode, booked_by, vehicle_id, first_mile_mode, last_mile_mode, hub_from_place_id, hub_to_place_id,
                                  pref_time, pref_url, pref_note)
    values (p_trip.id, i, r->>'mode', coalesce(nullif(r->>'booked_by', ''), 'self'), nullif(r->>'vehicle_id', '')::uuid,
            nullif(r->>'first_mile_mode', ''), nullif(r->>'last_mile_mode', ''),
            nullif(r->>'hub_from_place_id', '')::uuid, nullif(r->>'hub_to_place_id', '')::uuid,
            -- What the traveller asked the desk for. Absent on every trip
            -- planned before these columns, which reads as "no preference".
            nullif(r->>'pref_time', '')::time, nullif(btrim(r->>'pref_url'), ''), nullif(btrim(r->>'pref_note'), ''));
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
                 'ret', case when p.is_return then true end,
                 -- jsonb_strip_nulls drops it when false, so the draft sees
                 -- the flag only where it is actually set.
                 'stop', case when p.is_stop then true end)) order by p.seq), '[]'::jsonb)
                 from te_trip_points p where p.trip_id = t.id),
    'segs', (select coalesce(jsonb_agg(jsonb_build_object(
                 'mode', s.mode, 'bookedBy', s.booked_by, 'vehicleId', s.vehicle_id,
                 'xfer', jsonb_strip_nulls(jsonb_build_object('first', s.first_mile_mode, 'last', s.last_mile_mode,
                                                              'hubA', s.hub_from_place_id, 'hubB', s.hub_to_place_id)),
                 -- HH:MM for <input type="time">, which rejects seconds.
                 'prefTime', coalesce(to_char(s.pref_time, 'HH24:MI'), ''),
                 'prefUrl', coalesce(s.pref_url, ''),
                 'prefNote', coalesce(s.pref_note, '')) order by s.seq), '[]'::jsonb)
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

create or replace view v_te_to_book as
select t.company_id, t.id as trip_id, t.trip_no, t.name as trip_name, t.employee_id,
       'leg'::text as kind, l.id as leg_id, null::int as point_seq, l.leg_date as on_date, l.mode,
       pf.short_name as from_name, pt.short_name as to_name,
       -- WHAT THE TRAVELLER ASKED FOR, beside the leg it is about. Without
       -- it the desk has the route and the date and has to write to the
       -- traveller to find out which flight they actually want.
       to_char(sg.pref_time, 'HH24:MI') as pref_time, sg.pref_url, sg.pref_note
  from te_trips t
  join te_legs l on l.trip_id = t.id and l.booked_by = 'desk' and l.status = 'PLANNED'
  join te_places pf on pf.id = l.from_place_id
  join te_places pt on pt.id = l.to_place_id
  -- left: a leg added during the trip has no segment behind it.
  left join te_trip_segments sg on sg.trip_id = t.id and sg.seq = l.segment_seq
 where t.status = 'APPROVED' and te_today(t.company_id) <= t.end_date
   and not exists (select 1 from te_bookings b where b.leg_id = l.id and b.status <> 'CANCELLED')
union all
select t.company_id, t.id, t.trip_no, t.name, t.employee_id,
       'hotel', null::uuid, p.seq, p.arrive_on, null::text, null::text, pl.short_name,
       null::text, null::text, null::text
  from te_trips t
  join te_trip_points p on p.trip_id = t.id and p.seq > 0 and not p.is_return
                       and p.arrive_on is not null and coalesce(p.leave_on, p.arrive_on) > p.arrive_on
  join te_places pl on pl.id = p.place_id
 where t.status = 'APPROVED' and t.stay_by = 'desk' and te_today(t.company_id) <= t.end_date
   and not exists (select 1 from te_bookings b where b.trip_id = t.id and b.point_seq = p.seq and b.status <> 'CANCELLED');


notify pgrst, 'reload schema';
