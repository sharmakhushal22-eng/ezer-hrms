-- 180_te_journey_route_and_review.sql -- the route a sub-trip actually took,
-- and the two desks looking at it.
-- SAFE TO RUN TWICE. Nine columns, four new functions, one view, two replaced.
-- ----------------------------------------------------------------------------
-- WHAT A "GPS SUB-TRIP" IS HERE. It is a journey added during the trip:
-- te_legs with kind='extra' and segment_seq null, created by te_leg_add, which
-- has existed since 146 and is already wired from the trip screen. Land in
-- Mumbai, add a journey to the client office, record it, add another. Nothing
-- in this migration invents a second mechanism; a parallel sub-trip table would
-- have had to repeat the GPS recorder, the mileage engine, the twelve journey
-- flags, the claim gate and the nightly ping purge, all of which already work.
--
-- TWO THINGS WERE GENUINELY MISSING, and this is both of them.
--
-- 1. THE ROUTE WAS NEVER ON RECORD. te_legs.route_polyline has existed since
--    144 and te_leg_end has always written it from p_stats->>'route_polyline'.
--    The engine never emitted that key, so the column was NULL on every row
--    ever written; and nothing in the application ever read it. Dead at both
--    ends. The engine fills it now and te_leg_json below hands it out, so a
--    screen can draw the real trail -- and can still draw it in two years, when
--    te_daily() has purged the raw pings but the polyline remains.
--
-- 2. NEITHER DESK COULD SEE A JOURNEY. v_te_to_book shows a leg only while it
--    is PLANNED and booked_by='desk'; an added journey is always booked_by
--    ='self' (te_leg_add), so it could never appear there at all. No Finance
--    view joins te_legs in any form. Journey evidence reached a human only
--    bundled inside a claim, after the fact. v_te_journey_review below is the
--    work list, and te_leg_confirm / te_leg_send_back are the two things a desk
--    can do about it.
--
-- CONFIRMATION IS NOT A STATUS, on purpose. te_legs.status drives the recorder
-- (PLANNED/ACTIVE/PAUSED), the claim gate (which blocks on four of its values)
-- and uq_te_leg_running, the partial unique index that allows one running
-- journey per employee. Widening that check constraint would put all three at
-- risk in order to answer a question that is really "has anybody looked at this
-- yet". So the answer lives in columns beside it and leaves status alone.
--
-- WHO MUST CONFIRM IS A SETTING, te_settings.extra->>'journeyConfirm':
--   'both'    the travel desk confirms the journey happened, then Finance
--             confirms the money. The default.
--   'finance' Finance alone. The desk still sees every journey and can still
--             send one back; it is simply not a gate.
--   'desk'    the travel desk alone.
--   'none'    nobody has to. The list stays, as a record.
-- Read through te_journey_confirm_policy() so one function answers it and a
-- company that has never touched the setting gets 'both'.
--
-- SENDING ONE BACK HOLDS THE CLAIM. That is the point of it -- the desk asked
-- for the reason, the bill or the route to be explained, and letting the claim
-- past would ask the approver to sign off the very thing just queried. The
-- traveller answers with te_leg_answer and the hold lifts. As everywhere else
-- in this module, it is MINE only: a colleague's queried journey never blocks
-- this claimant, for the same reason the unfinished-journey gate is per
-- employee.
--
-- NOTHING HERE PAYS ANYTHING. Confirming does not move money and refusing does
-- not take it away; the money is still the claim's, decided by the chain and by
-- Finance on the claim. This records who looked, when, and what they asked.
-- ============================================================================

-- te_legs has never been altered since 144 created it. These are additive and
-- nullable: every journey already recorded stays exactly as it is, unconfirmed
-- and unqueried, which is the truth about it.
alter table te_legs add column if not exists desk_confirmed_at timestamptz;
alter table te_legs add column if not exists desk_confirmed_by uuid references employees(id);
alter table te_legs add column if not exists fin_confirmed_at  timestamptz;
alter table te_legs add column if not exists fin_confirmed_by  uuid references employees(id);
alter table te_legs add column if not exists sent_back_at      timestamptz;
alter table te_legs add column if not exists sent_back_by      uuid references employees(id);
alter table te_legs add column if not exists sent_back_desk    text;
alter table te_legs add column if not exists sent_back_reason  text;
alter table te_legs add column if not exists review_answer     text;

comment on column te_legs.route_polyline is
  'The route actually travelled, Google encoded-polyline format, written by te_leg_end from the engine. Survives the nightly purge of te_leg_pings, which is the whole reason it is stored rather than derived.';
comment on column te_legs.desk_confirmed_at is
  'When the travel desk agreed this journey happened as recorded. Not a status and not a payment: see 180_te_journey_route_and_review.sql.';
comment on column te_legs.sent_back_reason is
  'What a desk asked the traveller for. While sent_back_at is set the claim for this trip is held.';

-- Who has to confirm, for this company. One function, so no caller has to know
-- where the setting lives or what it defaults to.
create or replace function te_journey_confirm_policy(p_company uuid)
returns text language sql stable as $$
  select coalesce(nullif(btrim(s.extra->>'journeyConfirm'), ''), 'both')
    from te_settings s where s.company_id = p_company;
$$;

-- A member of the right desk, acting on a journey their desk answers for.
--
-- te_on_desk answers "is this person on that desk at all". It does NOT answer
-- "whose company", because a desk row carries a company and a group flag of its
-- own -- so a member of Company A's travel desk passes te_on_desk and still has
-- no business confirming Company B's cab rides. The second half of this
-- function is that question, asked against the desk row itself: the member's
-- own company, or any company in the group where their row is group-scoped.
create or replace function te__journey_desk_actor(p_leg_id uuid, p_actor uuid, p_desk text)
returns te_legs language plpgsql as $$
declare
  l    te_legs;
  v_ok boolean;
begin
  if p_desk not in ('travel', 'finance') then
    perform te_fail('TE_FORBIDDEN', format('There is no %s desk.', p_desk));
  end if;
  select * into l from te_legs where id = p_leg_id for update;
  if not found then
    perform te_fail('TE_LEG', 'Journey not found.');
  end if;
  perform te_assert_active(p_actor);
  if not te_on_desk(p_desk, p_actor) then
    perform te_fail('TE_FORBIDDEN', case when p_desk = 'travel'
      then 'Only the travel desk can do that.' else 'Only the Finance team can do that.' end);
  end if;
  if p_desk = 'travel' then
    select exists (
      select 1 from travel_desk d
       where d.employee_id = p_actor and d.is_active
         and (d.company_id = l.company_id
              or (d.is_group_scope and exists (
                    select 1 from companies c1, companies c2
                     where c1.id = d.company_id and c2.id = l.company_id
                       and c1.group_id is not null and c1.group_id = c2.group_id)))
    ) into v_ok;
  else
    select exists (
      select 1 from finance_team f
       where f.employee_id = p_actor and f.is_active and f.can_approve
         and (f.company_id = l.company_id
              or (f.is_group_scope and exists (
                    select 1 from companies c1, companies c2
                     where c1.id = f.company_id and c2.id = l.company_id
                       and c1.group_id is not null and c1.group_id = c2.group_id)))
    ) into v_ok;
  end if;
  if not v_ok then
    perform te_fail('TE_FORBIDDEN', 'That journey belongs to a company your desk does not answer for.');
  end if;
  return l;
end;
$$;

-- ── a desk agrees the journey happened as recorded ──────────────────────────
create or replace function te_leg_confirm(p_leg_id uuid, p_actor uuid, p_desk text)
returns jsonb language plpgsql as $$
declare
  l        te_legs := te__journey_desk_actor(p_leg_id, p_actor, p_desk);
  v_policy text;
  v_name   text;
begin
  -- REPORTED FIRST. Confirming a journey still being recorded would be
  -- confirming a route that is still growing, and confirming one with no report
  -- would be agreeing to a fare nobody has entered.
  if l.status <> 'SUBMITTED' then
    perform te_fail('TE_LEG', case l.status
      when 'PLANNED' then 'This journey has not been recorded yet.'
      when 'ACTIVE'  then 'This journey is still running.'
      when 'PAUSED'  then 'This journey is still running.'
      when 'ENDED'   then 'The traveller has not reported this journey yet.'
      when 'SKIPPED' then 'This journey was skipped, so there is nothing to confirm.'
      else 'This journey cannot be confirmed.' end);
  end if;

  v_policy := te_journey_confirm_policy(l.company_id);
  if v_policy = 'none' then
    perform te_fail('TE_LEG', 'This company does not ask anyone to confirm journeys.');
  end if;
  if p_desk = 'travel' and v_policy = 'finance' then
    perform te_fail('TE_LEG', 'Here, Finance confirms journeys. You can still send one back.');
  end if;
  if p_desk = 'finance' and v_policy = 'desk' then
    perform te_fail('TE_LEG', 'Here, the travel desk confirms journeys. You can still send one back.');
  end if;
  -- IN TURN, WHERE BOTH CONFIRM. Finance is being asked whether to pay for a
  -- journey; the desk is being asked whether it happened. Answering the second
  -- question first is the only order in which the first one means anything.
  if p_desk = 'finance' and v_policy = 'both' and l.desk_confirmed_at is null then
    perform te_fail('TE_LEG', 'The travel desk has not confirmed this journey yet.');
  end if;

  if p_desk = 'travel' then
    if l.desk_confirmed_at is not null then
      perform te_fail('TE_LEG', 'The travel desk has already confirmed this journey.');
    end if;
    update te_legs set desk_confirmed_at = now(), desk_confirmed_by = p_actor,
           -- Confirming answers the query: a desk that was going to insist
           -- would not be pressing this button.
           sent_back_at = null, sent_back_by = null, sent_back_desk = null, sent_back_reason = null
     where id = l.id;
  else
    if l.fin_confirmed_at is not null then
      perform te_fail('TE_LEG', 'Finance has already confirmed this journey.');
    end if;
    update te_legs set fin_confirmed_at = now(), fin_confirmed_by = p_actor,
           sent_back_at = null, sent_back_by = null, sent_back_desk = null, sent_back_reason = null
     where id = l.id;
  end if;

  select p.short_name into v_name from te_places p where p.id = l.to_place_id;
  perform te__leg_log(l, 'LEG_CONFIRMED',
    case when p_desk = 'travel' then 'The travel desk' else 'Finance' end
    || ' confirmed this journey to ' || coalesce(v_name, 'the destination') || '.', p_actor);
  return jsonb_build_object('leg_id', l.id, 'desk', p_desk, 'policy', v_policy);
end;
$$;

-- ── a desk asks the traveller for something ─────────────────────────────────
create or replace function te_leg_send_back(p_leg_id uuid, p_actor uuid, p_desk text, p_reason text)
returns jsonb language plpgsql as $$
declare
  l      te_legs := te__journey_desk_actor(p_leg_id, p_actor, p_desk);
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if l.status <> 'SUBMITTED' then
    perform te_fail('TE_LEG', 'Only a journey that has been reported can be sent back.');
  end if;
  -- A REASON IS THE WHOLE POINT. "Sent back" with nothing attached tells the
  -- traveller only that somebody was unhappy, and they cannot act on that.
  if v_why is null then
    perform te_fail('TE_COMMENT', 'Say what you want the traveller to do about this journey.');
  end if;
  if l.sent_back_at is not null then
    perform te_fail('TE_LEG', 'This journey has already been sent back and is waiting on the traveller.');
  end if;

  update te_legs set sent_back_at = now(), sent_back_by = p_actor,
         sent_back_desk = case when p_desk = 'travel' then 'travel_desk' else 'finance_team' end,
         sent_back_reason = v_why,
         -- Asking again withdraws the agreement that desk had given. The other
         -- desk's confirmation is left alone: it is not theirs to withdraw.
         --
         -- The bare column names read the OLD value, which is what is wanted.
         -- Writing l.desk_confirmed_at would reach the plpgsql record instead;
         -- it holds the same thing today, but only because nothing above
         -- reassigns it, and that is not a thing to depend on.
         desk_confirmed_at = case when p_desk = 'travel' then null else desk_confirmed_at end,
         desk_confirmed_by = case when p_desk = 'travel' then null else desk_confirmed_by end,
         fin_confirmed_at  = case when p_desk = 'finance' then null else fin_confirmed_at end,
         fin_confirmed_by  = case when p_desk = 'finance' then null else fin_confirmed_by end,
         review_answer = null
   where id = l.id;

  perform te__leg_log(l, 'LEG_SENT_BACK',
    case when p_desk = 'travel' then 'The travel desk' else 'Finance' end
    || ' sent this journey back: ' || v_why, p_actor);
  return jsonb_build_object('leg_id', l.id, 'desk', p_desk);
end;
$$;

-- ── the traveller answers ───────────────────────────────────────────────────
create or replace function te_leg_answer(p_leg_id uuid, p_actor uuid, p_text text)
returns jsonb language plpgsql as $$
declare
  l     te_legs := te__leg_for_actor(p_leg_id, p_actor);
  v_say text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if l.sent_back_at is null then
    perform te_fail('TE_LEG', 'Nobody has asked you anything about this journey.');
  end if;
  if v_say is null then
    perform te_fail('TE_COMMENT', 'Answer what the desk asked about this journey.');
  end if;
  -- THE HOLD LIFTS, the confirmation does not come back. The desk asked and has
  -- been answered; whether the answer satisfies them is theirs to say, by
  -- confirming or by asking again.
  update te_legs set sent_back_at = null, sent_back_by = null, sent_back_desk = null,
         -- The question is kept with the answer. A reviewer reading this later
         -- needs both halves; dropping the question would leave an answer to
         -- nothing.
         review_answer = coalesce(nullif(btrim(sent_back_reason), '') || ' --- ', '') || v_say
   where id = l.id;

  perform te__leg_log(l, 'LEG_ANSWERED', 'The traveller answered: ' || v_say, p_actor);
  return jsonb_build_object('leg_id', l.id);
end;
$$;

-- ── the work list both desks read ───────────────────────────────────────────
-- One view, two readers. The travel desk and Finance are asking different
-- questions of the same row, so the row carries the answer to both and each
-- route filters for its own.
--
-- REPORTED ONLY. A journey still being recorded has nothing to look at, and the
-- route it would show is still growing.
create or replace view v_te_journey_review as
select l.id              as leg_id,
       l.company_id,
       l.trip_id,
       t.trip_no,
       t.name            as trip_name,
       t.scope,
       l.employee_id,
       l.leg_no,
       l.kind,
       -- An added journey is the local sub-trip of an outstation trip: no
       -- segment behind it, added while away. The screens say so, because a
       -- planned leg of the main route is a different kind of thing to look at.
       (l.segment_seq is null and l.kind = 'extra') as is_subtrip,
       l.leg_date,
       l.mode,
       l.booked_by,
       l.gps_mode,
       l.is_manual,
       coalesce(l.no_gps_reason, '')  as no_gps_reason,
       coalesce(l.added_reason, '')   as added_reason,
       pf.short_name     as from_name,
       pt.short_name     as to_name,
       l.planned_km,
       l.gps_km,
       l.route_km,
       l.payable_km,
       coalesce(l.route_polyline, '') as route_polyline,
       l.start_lat, l.start_lng, l.end_lat, l.end_lng,
       l.start_off_m, l.end_off_m,
       l.gps_points,
       l.expense_id,
       x.claimed_amount  as claimed,
       x.eligible_amount as eligible,
       x.category_code   as category,
       -- Whether there is a bill behind it. A cab fare is paid on the bill, so
       -- its absence is the first thing a desk wants to know.
       (select count(*) from te_expense_files f where f.expense_id = l.expense_id) as file_count,
       l.desk_confirmed_at, l.desk_confirmed_by,
       l.fin_confirmed_at,  l.fin_confirmed_by,
       l.sent_back_at, l.sent_back_by, coalesce(l.sent_back_desk, '') as sent_back_desk,
       coalesce(l.sent_back_reason, '') as sent_back_reason,
       coalesce(l.review_answer, '')    as review_answer,
       te_journey_confirm_policy(l.company_id) as confirm_policy
  from te_legs l
  join te_trips t on t.id = l.trip_id
  left join te_places pf      on pf.id = l.from_place_id
  left join te_places pt      on pt.id = l.to_place_id
  left join te_expenses x     on x.id = l.expense_id
 where l.status = 'SUBMITTED';

create or replace function te_leg_json(l te_legs, p_track boolean default false)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', l.id, 'emp', l.employee_id, 'tripId', l.trip_id, 'n', l.leg_no, 'seg', l.segment_seq, 'kind', l.kind,
    'from', l.from_place_id, 'to', l.to_place_id, 'date', l.leg_date, 'purpose', coalesce(l.purpose, ''),
    'why', (select t.name from te_trips t where t.id = l.trip_id),
    'mode', l.mode, 'vehicleId', l.vehicle_id, 'bookedBy', l.booked_by, 'gps', l.gps_mode, 'plannedKm', l.planned_km,
    'status', l.status, 'startedAt', l.started_at, 'endedAt', l.ended_at, 'filedAt', l.filed_at,
    'manual', l.is_manual, 'noGps', coalesce(l.no_gps_reason, ''), 'skipReason', coalesce(l.skip_reason, ''),
    'addedWhy', coalesce(l.added_reason, ''), 'expenseId', l.expense_id,
    'stats', l.stats, 'gpsKm', l.gps_km, 'routeKm', l.route_km, 'payKm', l.payable_km,
    -- THE ROUTE ACTUALLY DRIVEN, encoded, so a screen can draw it long after
    -- the raw pings are purged. The column has existed since 144 and te_leg_end
    -- has always written it; nothing ever put a value in it and nothing ever
    -- read it. The engine fills it now (legEndStats) and this hands it out.
    'routeLine', coalesce(l.route_polyline, ''),
    -- WHERE THE REVIEW HAS GOT TO. Confirmation is deliberately NOT a status:
    -- te_legs.status drives the recorder, the claim gate and the one-running-
    -- journey index, and widening it would put all three at risk to answer a
    -- question that is really "has somebody looked at this yet".
    'review', jsonb_build_object(
       'deskAt', l.desk_confirmed_at, 'deskBy', l.desk_confirmed_by,
       'deskName', case when l.desk_confirmed_by is not null then te_emp_name(l.desk_confirmed_by) end,
       'finAt', l.fin_confirmed_at, 'finBy', l.fin_confirmed_by,
       'finName', case when l.fin_confirmed_by is not null then te_emp_name(l.fin_confirmed_by) end,
       'backAt', l.sent_back_at, 'backBy', l.sent_back_by,
       'backName', case when l.sent_back_by is not null then te_emp_name(l.sent_back_by) end,
       'backDesk', coalesce(l.sent_back_desk, ''), 'backWhy', coalesce(l.sent_back_reason, ''),
       'answer', coalesce(l.review_answer, '')),
    'track', case when p_track then
               (select coalesce(jsonb_agg(jsonb_build_object(
                         'lat', g.lat, 'lng', g.lng,
                         't', greatest(0, round(extract(epoch from (g.recorded_at - l.started_at))))::int,
                         'sp', coalesce(g.speed_kmh, 0), 'acc', coalesce(g.accuracy_m, 0),
                         'fake', coalesce(g.is_mock, false)) order by g.recorded_at, g.seq), '[]'::jsonb)
                  from te_leg_pings g where g.leg_id = l.id)
             else '[]'::jsonb end,
    'shown', 0,
    'stops', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', s.id, 'n', s.seq,
                -- the trail point the stop was made at
                'i', greatest(0, (select count(*) from te_leg_pings g where g.leg_id = l.id and g.recorded_at <= s.started_at) - 1),
                't', greatest(0, round(extract(epoch from (s.started_at - l.started_at))))::int,
                'lat', s.lat, 'lng', s.lng, 'acc', coalesce(s.accuracy_m, 0),
                'name', coalesce(s.place_name, 'a point on the way'), 'addr', coalesce(s.address, ''),
                'reason', s.reason_code, 'biz', s.is_business, 'note', coalesce(s.note, ''),
                'dwell', s.minutes, 'at', s.started_at) order by s.seq), '[]'::jsonb)
                from te_leg_stops s where s.leg_id = l.id),
    'checkin', jsonb_strip_nulls(jsonb_build_object(
       'start', case when l.started_at is not null then jsonb_build_object('at', l.started_at, 'lat', l.start_lat, 'lng', l.start_lng,
                     'acc', l.start_accuracy_m, 'addr', coalesce(l.start_address, ''), 'off', l.start_off_m) end,
       'end',   case when l.end_lat is not null then jsonb_build_object('at', l.ended_at, 'lat', l.end_lat, 'lng', l.end_lng,
                     'acc', l.end_accuracy_m, 'addr', coalesce(l.end_address, ''), 'off', l.end_off_m) end)),
    'history', '[]'::jsonb);
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
      perform te_fail('TE_CLAIM', 'Journey ' || v_open.leg_no || ' was sent back to you: '
        || coalesce(nullif(btrim(v_open.sent_back_reason), ''), 'no reason was given')
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

-- ── locked down ─────────────────────────────────────────────────────────────
-- 151_te_lockdown.sql revoked the browser keys from the v_te_ views and te_
-- functions that existed when it ran. These are new, so they have whatever the
-- database hands a brand new object -- which for a work list naming every
-- traveller's routes, and for three functions that all take p_actor, is not
-- something to leave to a default. An open te_leg_confirm would let anybody
-- confirm anything as anybody.
do $$
declare
  v text;
  sig text;
begin
  for v in select unnest(array['v_te_journey_review']) loop
    execute format('revoke all on table %I from public', v);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', v);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', v);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant select on table %I to service_role', v);
    end if;
  end loop;

  for sig in
    select format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('te_leg_confirm', 'te_leg_send_back', 'te_leg_answer',
                         'te__journey_desk_actor', 'te_journey_confirm_policy')
  loop
    execute format('revoke all on function %s from public', sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', sig);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
