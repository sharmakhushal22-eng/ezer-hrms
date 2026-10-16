-- 158_te_stay_and_food.sql — "do you need a stay?", and the food budget.
-- SAFE TO RUN TWICE.
-- ----------------------------------------------------------------------------
-- WHAT THE PLANNER NOW ASKS
--
--   A stay?  yes/no. If yes, three hotels the employee would accept, each with
--            a name, where it is, and the page they found it on. Three,
--            because one suggestion is a demand and the desk needs room to
--            find a rate. Fewer than three is allowed and shows the approver
--            that fewer were given -- a trip should not be held up because
--            somebody could only find two hotels they liked.
--
--   Food?    yes/no, and nothing else. Nobody can say in advance where they
--            will eat, so asking for a food plan would collect fiction. What
--            the employee is shown instead is the budget the company already
--            set, and the bills come off it during the trip.
--
-- THE FOOD BUDGET IS NOT A NEW NUMBER. It is the trip's own meals estimate,
-- which the engine builds by summing te_grade_limits.meals_per_day for each day
-- of the trip, per the employee's grade and the city they are in that day --
-- the figure an admin edits under Policy as "Food a day". Nothing is stored
-- here for it: a second copy would drift from the first, and the employee and
-- the approver would be reading different numbers.
--
-- WHY stay_options IS jsonb AND NOT A TABLE. It is read back whole, by a
-- person, and never filtered, joined or aggregated on -- the same reasoning
-- 153 used for te_bookings.details. A table would buy nothing and cost a join
-- on every trip read.
--
-- NULL IS NOT NO. stay_wanted and food_wanted are nullable, and every trip
-- planned before today has null in both. That means "never asked", which the
-- screens need to tell apart from a deliberate no.
--
-- te_trip_save IS REPRODUCED FROM 156, NOT 146. 156 is the live definition and
-- carries the journey wording; taking 146's would quietly undo it.
--
-- A LOCAL TRIP CAN NOW HAVE A HOTEL. Three things used to say otherwise: the
-- browser forced "I book it myself" on local trips, the estimate gave local no
-- hotel line, and engine check C11 refused a hotel bill on a local trip
-- outright. Those are being relaxed together -- a late finish near the client
-- is a real thing. The first two are in the TypeScript and the engine; nothing
-- in this file enforced it.
-- ============================================================================

-- ── the columns ─────────────────────────────────────────────────────────────

alter table te_trips add column if not exists stay_wanted  boolean;
alter table te_trips add column if not exists food_wanted  boolean;
alter table te_trips add column if not exists stay_options jsonb not null default '[]'::jsonb;

comment on column te_trips.stay_wanted is
  'Did the employee ask for a stay when planning. null = planned before we asked.';
comment on column te_trips.food_wanted is
  'Did the employee say they will spend on food. null = planned before we asked. The budget itself is the meals line of the estimate, never stored twice.';
comment on column te_trips.stay_options is
  'Hotels the employee would accept: [{name, location, url, price?}]. Read whole, never filtered on.';

-- ============================================================================
-- te_trip_save — from 156_te_journey_wording.sql
-- Change: carries the stay/food answers and the hotel options.
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
        -- The three asks the planner now makes. stay_wanted and food_wanted are
        -- nullable on purpose: null means "this trip was planned before we
        -- asked", which is not the same as a no.
        stay_wanted = (p->>'stay_wanted')::boolean,
        food_wanted = (p->>'food_wanted')::boolean,
        stay_options = coalesce(p->'stay_options', '[]'::jsonb),
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
                          stay_wanted, food_wanted, stay_options,
                          start_date, end_date, from_label, to_label, country, estimate, estimate_total, self_estimate,
                          planned_km, advance_requested, post_facto_reason, post_facto_note, status)
    values (v_company, te_next_no(v_company, 'trip'), v_emp, btrim(p->>'name'), p->>'scope', p->>'pattern',
            coalesce(nullif(p->>'origin', ''), 'PRE_APPROVED'), p->>'purpose', nullif(btrim(p->>'project'), ''),
            coalesce((p->>'pax')::int, 1), coalesce(nullif(p->>'stay_by', ''), 'self'),
            (p->>'stay_wanted')::boolean, (p->>'food_wanted')::boolean,
            coalesce(p->'stay_options', '[]'::jsonb),
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
-- te_trip_json — from 148_te_functions_read.sql
-- Change: returns them to the screens.
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
    'pfReason', coalesce(t.post_facto_reason, ''), 'pfNote', coalesce(t.post_facto_note, ''),
    'legIds', (select coalesce(jsonb_agg(l.id order by l.leg_no), '[]'::jsonb) from te_legs l where l.trip_id = t.id),
    'chain', te_steps_json('trip', t.id), 'why', to_jsonb(t.chain_notes),
    'createdAt', t.created_at, 'approvedAt', t.approved_at);
$$;
