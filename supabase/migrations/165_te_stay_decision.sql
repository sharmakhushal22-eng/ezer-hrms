-- 159_te_stay_decision.sql — the Travel Desk picks one of the three hotels.
-- SAFE TO RUN TWICE.
-- ----------------------------------------------------------------------------
-- 164 let an employee name three hotels they would accept. This is the other
-- end of that: somebody on the desk reads the three, picks one or turns them
-- all down with a reason, and the employee is told which.
--
-- WHERE THE DECISION LIVES. Its own columns on te_trips, not inside the
-- stay_options jsonb. The desk's work list is "every trip still waiting", and
-- that has to be a cheap indexed read -- `stay_status = 'NONE'` is, and
-- picking apart a jsonb array to find out whether any element was chosen is
-- not. The options themselves stay jsonb: they are read whole, by a person.
--
-- 'NONE' MEANS NOBODY HAS DECIDED, which is why te_trip_save is untouched by
-- this file. Planning a trip does not have to know the decision exists; the
-- column defaults to NONE and the desk moves it from there. That also keeps
-- te_trip_save from being reproduced a third time (146 -> 162 -> 164), each
-- reproduction being another chance to drop something.
--
-- THE NAME IS COPIED, NOT JUST THE INDEX. stay_chosen_name records which hotel
-- was picked as text at the moment it was picked. An index into an array that
-- the employee can still edit is a pointer that goes stale silently: reorder
-- the options and last week's decision would appear to name a different hotel.
--
-- HOW THE EMPLOYEE IS TOLD. te_log with employee_visible = true, which is what
-- te_timeline reads, so the decision appears in the trip's own History beside
-- everything else that happened to it. This module has no separate notification
-- table and inventing one here would be a second system to keep in step.
-- ============================================================================

-- ── the decision ────────────────────────────────────────────────────────────

alter table te_trips add column if not exists stay_status text not null default 'NONE';
alter table te_trips add column if not exists stay_chosen int;
alter table te_trips add column if not exists stay_chosen_name text;
alter table te_trips add column if not exists stay_remark text;
alter table te_trips add column if not exists stay_decided_by uuid references employees(id) on delete set null;
alter table te_trips add column if not exists stay_decided_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'te_trips_stay_status_chk') then
    alter table te_trips add constraint te_trips_stay_status_chk
      check (stay_status in ('NONE', 'CHOSEN', 'REJECTED'));
  end if;
end $$;

comment on column te_trips.stay_status is
  'NONE = the desk has not decided yet, and the desk list is built from it. CHOSEN / REJECTED once it has.';
comment on column te_trips.stay_chosen_name is
  'The hotel picked, as text at the time. The index alone would go stale if the employee reorders the options.';

-- The desk only ever wants the handful still waiting, so the index covers
-- exactly that and nothing else.
create index if not exists idx_te_trips_stay_waiting
  on te_trips (company_id)
  where stay_wanted and stay_status = 'NONE';

-- ── the function the desk calls ─────────────────────────────────────────────
-- p = { "trip_id": uuid, "action": "choose" | "reject",
--       "choice": <index into stay_options, for choose>, "remark": "…" }

create or replace function te_stay_decide(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  t        te_trips;
  v_action text := coalesce(nullif(btrim(p->>'action'), ''), '');
  v_choice int  := nullif(p->>'choice', '')::int;
  v_remark text := nullif(btrim(p->>'remark'), '');
  v_count  int;
  v_name   text;
begin
  select * into t from te_trips where id = (p->>'trip_id')::uuid for update;
  if not found then
    perform te_fail('TE_STAY', 'Trip not found.');
  end if;
  -- Only the Travel Desk and Finance decide this. The employee proposed the
  -- hotels; letting them pick their own would make the ask meaningless.
  if not (p_actor = any (te_finance_members(t.company_id))) then
    perform te_fail('TE_FORBIDDEN', 'Only the Travel Desk can choose the hotel.');
  end if;
  if not coalesce(t.stay_wanted, false) then
    perform te_fail('TE_STAY', 'No stay was asked for on this trip.');
  end if;

  v_count := jsonb_array_length(coalesce(t.stay_options, '[]'::jsonb));
  if v_count = 0 then
    perform te_fail('TE_STAY', 'No hotels were suggested on this trip.');
  end if;

  if v_action = 'choose' then
    if v_choice is null or v_choice < 0 or v_choice >= v_count then
      perform te_fail('TE_STAY', 'Pick one of the hotels that was suggested.');
    end if;
    v_name := coalesce(t.stay_options -> v_choice ->> 'name', 'the hotel');
    update te_trips
       set stay_status = 'CHOSEN', stay_chosen = v_choice, stay_chosen_name = v_name,
           stay_remark = v_remark, stay_decided_by = p_actor, stay_decided_at = now()
     where id = t.id
     returning * into t;
    perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'STAY_CHOSEN', p_actor,
                   'Travel Desk picked ' || v_name || ' for your stay.'
                   || coalesce(' ' || v_remark, ''));

  elsif v_action = 'reject' then
    -- A refusal has to say why. The employee is being asked to go and find
    -- other hotels, and "no" on its own tells them nothing about what to look
    -- for instead.
    if v_remark is null then
      perform te_fail('TE_STAY', 'Say why none of these work, so they know what to look for.');
    end if;
    update te_trips
       set stay_status = 'REJECTED', stay_chosen = null, stay_chosen_name = null,
           stay_remark = v_remark, stay_decided_by = p_actor, stay_decided_at = now()
     where id = t.id
     returning * into t;
    perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'STAY_REJECTED', p_actor,
                   'Travel Desk turned down the hotels suggested: ' || v_remark);

  else
    perform te_fail('TE_STAY', 'Unknown action.');
  end if;

  return jsonb_build_object('trip_id', t.id, 'status', t.stay_status,
                            'chosen', t.stay_chosen, 'name', coalesce(t.stay_chosen_name, ''));
end;
$$;

-- ============================================================================
-- te_trip_json — from 158_te_stay_and_food.sql
-- Change: returns the desk decision alongside the options.
-- ============================================================================

create or replace function te_trip_json(t te_trips)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'no', t.trip_no, 'emp', t.employee_id, 'co', to_jsonb(te_trip_co(t.id)),
    'status', t.status, 'display', te_trip_status(t.id), 'origin', t.origin,
    'name', t.name, 'scope', t.scope, 'pattern', t.pattern, 'purpose', t.purpose, 'project', coalesce(t.project, ''),
    'points', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'place', p.place_id, 'pt', coalesce(p.place_type, ''), 'what', coalesce(p.what, ''),
                 'arrive', coalesce(p.arrive_on::text, ''), 'leave', coalesce(p.leave_on::text, ''),
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
