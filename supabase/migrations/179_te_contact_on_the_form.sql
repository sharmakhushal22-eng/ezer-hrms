-- 179_te_contact_on_the_form.sql — how to reach the traveller, captured on the
-- form rather than read from their HR record.
-- SAFE TO RUN TWICE. Adds six columns and replaces two functions.
-- ----------------------------------------------------------------------------
-- WHY THIS IS NOT JUST A JOIN. The travel desk was shown the mobile and email
-- from the employee record, live, which is the right answer to "what is on file
-- for this person" and the wrong answer to "how do I reach them about this
-- trip". A traveller abroad is on a local SIM; one whose handset is being
-- repaired is on a colleague's; one travelling at the weekend wants the desk to
-- use a different address. None of that belongs on their permanent HR record,
-- and none of it should change it.
--
-- So the form asks. It PREFILLS from the employee record — the same record ESS
-- edits, read at the moment the form opens — and the traveller may change what
-- it put there. What they leave is stored on the trip, and that is what the
-- desk rings and what the ticket email goes to. The ESS record is never
-- written back to.
--
-- ALL THREE ARE REQUIRED on a trip, because the desk's problem is always
-- urgent: a fare moved, a flight was cancelled, an airline wants a date of
-- birth before it will ticket. The second number is for when the first cannot
-- be reached, which abroad is most of the time.
--
-- ON A CLAIM, only when there is no trip. "Other expenses" never passes through
-- the planner, so the claim screen is the only place it can be asked. A claim
-- that belongs to a trip inherits what the trip already carries, so nobody is
-- asked the same question twice and one set of details answers for both.
--
-- EXISTING ROWS KEEP NULL. These are refusals inside the functions, not NOT
-- NULL on the columns: every trip and claim already in the system stays exactly
-- as it is. The screens fall back to the employee record when a trip carries
-- nothing, so the desk never shows a blank where a number should be.
-- ============================================================================

alter table te_trips  add column if not exists contact_mobile     text;
alter table te_trips  add column if not exists contact_alt_mobile text;
alter table te_trips  add column if not exists contact_email      text;
alter table te_claims add column if not exists contact_mobile     text;
alter table te_claims add column if not exists contact_alt_mobile text;
alter table te_claims add column if not exists contact_email      text;

comment on column te_trips.contact_mobile is
  'How to reach the traveller about THIS trip. Prefilled from the employee record, editable on the form, and never written back to it.';
comment on column te_claims.contact_mobile is
  'As te_trips.contact_mobile. Inherited from the trip when there is one; asked on the claim when there is not.';

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
  -- HOW TO REACH THEM ON THIS TRIP. Not the same question as what is on their
  -- ESS record: a traveller may be on a local SIM, on a borrowed handset, or
  -- reachable on a number they only use while away. The form prefills from ESS
  -- and they may change it; what they leave here is what the travel desk rings.
  if coalesce(btrim(p->>'contact_mobile'), '') = '' then
    perform te_fail('TE_TRIP', 'Give a mobile number the travel desk can reach you on.');
  end if;
  if coalesce(btrim(p->>'contact_alt_mobile'), '') = '' then
    perform te_fail('TE_TRIP', 'Give a second number, for when the first one cannot be reached.');
  end if;
  if coalesce(btrim(p->>'contact_email'), '') = '' then
    perform te_fail('TE_TRIP', 'Give an email address for the tickets to be sent to.');
  end if;
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
                          contact_mobile, contact_alt_mobile, contact_email,
                          start_date, end_date, from_label, to_label, country, estimate, estimate_total, self_estimate,
                          planned_km, advance_requested, post_facto_reason, post_facto_note, status)
    values (v_company, te_next_no(v_company, 'trip'), v_emp, btrim(p->>'name'), p->>'scope', p->>'pattern',
            coalesce(nullif(p->>'origin', ''), 'PRE_APPROVED'), p->>'purpose', nullif(btrim(p->>'project'), ''),
            coalesce((p->>'pax')::int, 1), coalesce(nullif(p->>'stay_by', ''), 'self'),
            (p->>'stay_wanted')::boolean, (p->>'food_wanted')::boolean,
            coalesce(p->'stay_options', '[]'::jsonb),
            btrim(p->>'contact_mobile'), btrim(p->>'contact_alt_mobile'), btrim(p->>'contact_email'),
            (p->>'start_date')::date, (p->>'end_date')::date, p->>'from_label', p->>'to_label', nullif(p->>'country', ''),
            coalesce(p->'estimate', '{}'::jsonb), v_total, coalesce((p->>'self_estimate')::numeric, 0), v_km,
            case when p->>'scope' = 'local' then 0 else coalesce((p->>'advance')::numeric, 0) end,
            nullif(btrim(p->>'post_facto_reason'), ''), nullif(btrim(p->>'post_facto_note'), ''), 'DRAFT')
    returning * into t;
  end if;

  -- An edit carries them as well: a number that changed before departure is
  -- exactly the case this exists for.
  if v_edit then
    update te_trips
       set contact_mobile     = btrim(p->>'contact_mobile'),
           contact_alt_mobile = btrim(p->>'contact_alt_mobile'),
           contact_email      = btrim(p->>'contact_email')
     where id = t.id;
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

  -- CONTACT DETAILS ON A CLAIM WITH NO TRIP. "Other expenses" never passes
  -- through the planner, so this is the only place it can be asked; a claim
  -- that belongs to a trip inherits what the trip already carries and does not
  -- ask the same question twice.
  if v_trip is null then
    if coalesce(btrim(p->>'contact_mobile'), '') = '' then
      perform te_fail('TE_CLAIM', 'Give a mobile number we can reach you on about this claim.');
    end if;
    if coalesce(btrim(p->>'contact_alt_mobile'), '') = '' then
      perform te_fail('TE_CLAIM', 'Give a second number, for when the first one cannot be reached.');
    end if;
    if coalesce(btrim(p->>'contact_email'), '') = '' then
      perform te_fail('TE_CLAIM', 'Give an email address for anything about this claim.');
    end if;
  end if;

  insert into te_claims (company_id, claim_no, employee_id, trip_id, claim_type, claim_seq, period_id, is_late, note,
                         claimed_total, eligible_total, approved_total, risk_score, risk_band, is_exception, is_post_facto,
                         declaration_at, stage, status, submitted_at, first_submitted_at, workflow_version,
                         contact_mobile, contact_alt_mobile, contact_email)
  values (v_company, te_next_no(v_company, 'claim'), v_emp, v_trip, case when v_trip is null then 'GENERAL' else 'TRIP' end,
          coalesce(v_seq, 0), v_period, v_late, nullif(btrim(p->>'note'), ''),
          0, coalesce((a->>'eligible')::numeric, 0), coalesce((a->>'eligible')::numeric, 0),
          coalesce((a->>'score')::int, 0), coalesce(nullif(a->>'band', ''), 'Low'),
          coalesce((a->>'exception')::boolean, false), coalesce(t.origin = 'POST_FACTO', false),
          now(), 'manager', 'IN_APPROVAL', now(), now(),
          (select w.version from te_workflows w where w.company_id = v_company and w.code = 'claim'),
          coalesce(nullif(btrim(p->>'contact_mobile'), ''), t.contact_mobile),
          coalesce(nullif(btrim(p->>'contact_alt_mobile'), ''), t.contact_alt_mobile),
          coalesce(nullif(btrim(p->>'contact_email'), ''), t.contact_email))
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

notify pgrst, 'reload schema';
