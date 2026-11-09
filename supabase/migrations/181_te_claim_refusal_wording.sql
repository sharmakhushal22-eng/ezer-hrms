-- 181_te_claim_refusal_wording.sql -- one sentence, with one full stop.
-- SAFE TO RUN TWICE. Replaces one function; changes no data and no rule.
-- ----------------------------------------------------------------------------
-- 180 added the refusal that holds a claim while one of the traveller's
-- journeys has been sent back, and quoted the desk's reason inside it. A desk
-- member who ends their question with a question mark -- which is what a
-- question looks like -- got this:
--
--   Journey 2 was sent back to you: did you walk in, and who was the client?.
--   Answer it, then send the claim.
--
-- Caught by reading it, in an end-to-end run, rather than by any test: nothing
-- asserts the shape of a sentence. The reason keeps whatever punctuation its
-- author gave it, and ours is only added where theirs left off.
--
-- DERIVED FROM 180, which holds the current definition: taken verbatim,
-- patched, and diffed to prove nothing else moved.
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
    -- A JOURNEY SOMEBODY SENT BACK HOLDS THE CLAIM. The desk or Finance looked
    -- at the route, the reason or the bill and asked for something; sending the
    -- claim on regardless would ask them to approve the very thing they just
    -- queried. Answering it (te_leg_answer) clears this.
    --
    -- Mine only, for the same reason the gate above is mine only: a colleague's
    -- queried journey is not this claimant's to answer.
    select * into v_open from te_legs l where l.trip_id = v_trip and l.employee_id = v_emp
       and l.sent_back_at is not null order by l.leg_no limit 1;
    if found then
      -- The desk's own words, then ours. A reason that already ends in its own
      -- punctuation does not get a full stop bolted onto it: "who was the
      -- client?. Answer it" is what the first version of this produced.
      perform te_fail('TE_CLAIM', 'Journey ' || v_open.leg_no || ' was sent back to you: '
        || regexp_replace(coalesce(nullif(btrim(v_open.sent_back_reason), ''), 'no reason was given'),
                          '[.!?]+$', '')
        || '. Answer it, then send the claim.');
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
