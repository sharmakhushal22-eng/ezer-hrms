-- 169_te_notice_lead_time.sql -- a trip that has to be booked needs notice.
-- SAFE TO RUN TWICE. One function redefined. No table, no data.
-- ----------------------------------------------------------------------------
-- WHAT THIS ADDS. te_trip_save already refused a plan dated in the past, a
-- plan with no name and a purpose of bare "Other". It now also refuses one
-- that leaves sooner than the company's notice -- three days by default, for
-- domestic and international travel.
--
-- WHY IT IS HERE AND NOT ONLY IN THE ENGINE. The engine raises it in
-- tripIssues and te-service refuses on plan.blocked before calling this, so
-- in the app the employee never reaches this message. That is the point of
-- the arrangement: the engine computes and SQL decides, and a rule about
-- money that lives only in a browser is a rule anybody with the RPC can skip.
--
-- HOW TO CHANGE IT, without touching SQL again:
--   te_settings.notice_days            how many days  (0 = off)
--   te_settings.gps_rules.noticeScopes which kinds of trip  (default
--                                      ["domestic","international"])
--   te_settings.gps_rules.noticeAction 'block' or 'warn'    (default block)
-- All three are edited in Admin -> Trip and GPS rules -> Notice before travel.
--
-- DERIVED FROM 163, which holds the current definition: that function was
-- taken verbatim, the declarations and one guard inserted, and the result
-- diffed to prove nothing else moved.
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
  v_notice_days  int;
  v_notice_act   text;
  v_notice_scope text[];
  v_old_start    date;
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
  -- "OTHER" IS NOT A REASON. The planner offers seven purposes and ends with
  -- Other, and the trip whose purpose is not on that list is exactly the one
  -- whose reason an approver most needs to read. The form folds the
  -- explanation into this same column as "Other — <what they wrote>", so a
  -- value that is still the bare word arrived with nothing said.
  --
  -- Ten characters past the word, matching MIN_WHY in lib/te/other-reason.ts.
  -- The browser says this first; this is what makes it true.
  -- One test, in two parts, so neither operator precedence nor a bracket
  -- expression holding a multibyte dash can get it wrong: is this an Other at
  -- all, and if so is there anything after the word.
  if btrim(p->>'purpose') ~* '^other([[:space:]]*(-|—)[[:space:]]*.*)?$'
     and length(btrim(regexp_replace(btrim(p->>'purpose'), '^other[[:space:]]*(-|—)?[[:space:]]*', '', 'i'))) < 10 then
    perform te_fail('TE_TRIP', 'Say in your own words why you are travelling. Choosing Other on its own does not tell your approver anything.');
  end if;
  if p->>'origin' = 'POST_FACTO' and coalesce(btrim(p->>'post_facto_reason'), '') = '' then
    perform te_fail('TE_TRIP', 'Say why this trip was not approved or tracked before.');
  end if;
  -- The same rule for the post-facto reason, which has its own note column and
  -- so needs no folding: Other there means the note is the explanation.
  if p->>'origin' = 'POST_FACTO'
     and lower(btrim(coalesce(p->>'post_facto_reason', ''))) = 'other'
     and length(btrim(coalesce(p->>'post_facto_note', ''))) < 10 then
    perform te_fail('TE_TRIP', 'You chose Other. Say what actually happened, in your own words.');
  end if;

  -- THE BOOKING LEAD TIME. A plan is not a ticket: the Travel Desk has to find
  -- a fare and Finance has to release the money, and a seat asked for the same
  -- week is dearer when it can be had at all. So a trip of a kind that has to
  -- be booked cannot leave sooner than the notice the company asks for.
  --
  -- NOTHING HERE IS A CONSTANT. The number is te_settings.notice_days, the
  -- kinds of trip are gps_rules.noticeScopes and whether falling short refuses
  -- the plan or only tells the approver is gps_rules.noticeAction. Zero days,
  -- an empty list of kinds, or 'warn' switches the refusal off. All three are
  -- edited in Admin -> Trip and GPS rules.
  --
  -- The engine says this first, in tripIssues, which is what the planner shows
  -- while somebody types. This is what makes it true: tripSave refuses on the
  -- engine's blockers before it ever calls here, so this is the floor under
  -- that and not the message anybody normally reads.
  --
  -- A trip that already happened is never held to a lead time, and neither is
  -- an edit that leaves the date alone -- fixing the purpose of a trip that
  -- leaves tomorrow must not lock somebody out of their own plan. Moving the
  -- date closer is asking for a booking again, so that is checked.
  if coalesce(p->>'origin', '') <> 'POST_FACTO' then
    select coalesce(s.notice_days, 0),
           coalesce(nullif(s.gps_rules->>'noticeAction', ''), 'block'),
           coalesce((select array_agg(x) from jsonb_array_elements_text(
                       case when jsonb_typeof(s.gps_rules->'noticeScopes') = 'array'
                            then s.gps_rules->'noticeScopes'
                            else '["domestic","international"]'::jsonb end) x),
                    array[]::text[])
      into v_notice_days, v_notice_act, v_notice_scope
      from te_settings s where s.company_id = v_company;

    if v_edit then
      select k.start_date into v_old_start from te_trips k where k.id = v_id;
    else
      v_old_start := null;
    end if;

    if coalesce(v_notice_days, 0) > 0
       and v_notice_act <> 'warn'
       and coalesce(p->>'scope', '') = any (v_notice_scope)
       and (p->>'start_date')::date < v_today + coalesce(v_notice_days, 0)
       and (v_old_start is null or v_old_start is distinct from (p->>'start_date')::date)
    then
      perform te_fail('TE_TRIP', format(
        '%s has to be planned at least %s %s before you leave, so the Travel Desk can book the ticket and Finance can release the money. The earliest you can leave is %s.',
        case p->>'scope' when 'international' then 'International travel'
                         when 'domestic' then 'Domestic travel'
                         else 'This trip' end,
        v_notice_days,
        case when v_notice_days = 1 then 'day' else 'days' end,
        to_char(v_today + v_notice_days, 'FMDD Mon')));
    end if;
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

notify pgrst, 'reload schema';
