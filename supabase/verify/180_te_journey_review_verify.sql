-- 180_te_journey_review_verify.sql — proves a recorded journey reaches both
-- desks, that confirming it is ordered and refused in the right places, and
-- that a journey sent back holds the claim.
--
-- NOT A MIGRATION. Run it in the SQL editor whenever you want the proof again.
-- APPLY 180 FIRST.
--
-- WRITES NOTHING THAT SURVIVES. It takes a journey that is already SUBMITTED,
-- confirms it, sends it back, answers it — and then raises an exception on
-- purpose. The exception aborts the block, so every column is exactly as it
-- was. The report survives because a PL/pgSQL variable is not transactional;
-- that is the whole trick, and it is the same one 175, 176 and 177 use.
--
-- IT FINISHES WITH AN ERROR IN RED. That is the success case. Read the message.
--
-- WHAT IS BEING PROVED:
--
--   the view holds it        a SUBMITTED journey is in v_te_journey_review with
--                            its route, its distance and its bill count. Before
--                            180 no desk could see a journey at all.
--   a sub-trip is named      is_subtrip is true for a journey added mid-trip
--                            (segment_seq null, kind 'extra') and false for a
--                            planned leg. The screens lean on that distinction.
--   the order is enforced    under 'both', Finance cannot confirm before the
--                            travel desk has. This is the half most likely to
--                            rot: it is the only rule here that depends on the
--                            setting AND on another column.
--   a stranger is refused    somebody on no desk cannot confirm anything, and a
--                            desk member cannot reach another company's journey.
--   sending back holds       te_claim_submit refuses the trip's claim while the
--                            journey is sent back, naming the reason.
--   answering releases       te_leg_answer lifts the hold and keeps the question
--                            beside the answer. It does NOT restore the
--                            confirmation that was withdrawn.
-- ============================================================================
do $$
declare
  r         text := E'\n=== 180 journey route and review ===\n';
  v_leg     te_legs;
  v_trip    te_trips;
  v_company uuid;
  v_desk    uuid;
  v_fin     uuid;
  v_other   uuid;
  v_row     record;
  v_policy  text;
  v_err     text;
  ok        boolean;
begin
  -- A journey that has been reported. Any one will do; the rules under test are
  -- not about which.
  select * into v_leg from te_legs where status = 'SUBMITTED' order by filed_at desc nulls last limit 1;
  if not found then
    raise exception E'%\n  NO SUBMITTED JOURNEY to test with. Record and report one, then run this again.', r;
  end if;
  select * into v_trip from te_trips where id = v_leg.trip_id;
  v_company := v_leg.company_id;
  r := r || format('  journey %s of %s, %s, %s' || E'\n', v_leg.leg_no, v_trip.trip_no, v_leg.mode, v_leg.status);

  -- ── the view holds it ─────────────────────────────────────────────────────
  select * into v_row from v_te_journey_review where leg_id = v_leg.id;
  if not found then
    raise exception E'%\n  FAIL: a SUBMITTED journey is not in v_te_journey_review.', r;
  end if;
  r := r || format('  in the view            yes — %s km, %s bill(s), route %s' || E'\n',
        coalesce(v_row.gps_km, v_row.planned_km, 0), v_row.file_count,
        case when v_row.route_polyline = '' then 'NOT kept (recorded before 180, or never tracked)'
             else length(v_row.route_polyline) || ' chars' end);
  r := r || format('  named as a sub-trip   %s  (segment_seq %s, kind %s)' || E'\n',
        v_row.is_subtrip, coalesce(v_leg.segment_seq::text, 'null'), v_leg.kind);

  v_policy := te_journey_confirm_policy(v_company);
  r := r || format('  who must confirm      %s' || E'\n', v_policy);

  -- ── somebody on no desk at all ───────────────────────────────────────────
  select e.id into v_other from employees e
   where e.company_id = v_company
     and not exists (select 1 from travel_desk d where d.employee_id = e.id and d.is_active)
     and not exists (select 1 from finance_team f where f.employee_id = e.id and f.is_active)
   limit 1;
  if v_other is not null then
    begin
      perform te_leg_confirm(v_leg.id, v_other, 'travel');
      raise exception E'%\n  FAIL: somebody on no desk confirmed a journey.', r;
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err like '%FAIL:%' then raise; end if;
      r := r || format('  a stranger            refused: "%s"' || E'\n', v_err);
    end;
  end if;

  -- ── the order, where both must confirm ───────────────────────────────────
  select d.employee_id into v_desk from travel_desk d
   where d.company_id = v_company and d.is_active limit 1;
  select f.employee_id into v_fin from finance_team f
   where f.company_id = v_company and f.is_active and f.can_approve limit 1;

  if v_policy = 'both' and v_fin is not null and v_leg.desk_confirmed_at is null then
    begin
      perform te_leg_confirm(v_leg.id, v_fin, 'finance');
      raise exception E'%\n  FAIL: Finance confirmed before the travel desk, under the "both" policy.', r;
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err like '%FAIL:%' then raise; end if;
      r := r || format('  Finance goes second   refused: "%s"' || E'\n', v_err);
    end;
  end if;

  -- ── the travel desk confirms ─────────────────────────────────────────────
  if v_desk is not null and v_policy in ('both', 'desk') then
    perform te_leg_confirm(v_leg.id, v_desk, 'travel');
    select desk_confirmed_at is not null into ok from te_legs where id = v_leg.id;
    r := r || format('  the desk confirms     %s' || E'\n', case when ok then 'recorded' else 'FAILED TO RECORD' end);
    if not ok then raise exception E'%\n  FAIL: te_leg_confirm did not record the confirmation.', r; end if;

    -- and not twice
    begin
      perform te_leg_confirm(v_leg.id, v_desk, 'travel');
      raise exception E'%\n  FAIL: the same desk confirmed the same journey twice.', r;
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err like '%FAIL:%' then raise; end if;
      r := r || format('  not twice             refused: "%s"' || E'\n', v_err);
    end;
  end if;

  -- ── sending it back, and what that does to the claim ─────────────────────
  if v_desk is not null then
    perform te_leg_send_back(v_leg.id, v_desk, 'travel', 'The route stops short of the client office.');
    select sent_back_at is not null and desk_confirmed_at is null into ok from te_legs where id = v_leg.id;
    r := r || format('  sent back             %s' || E'\n',
          case when ok then 'recorded, and the desk''s own confirmation withdrawn with it'
               else 'FAILED: either not recorded, or the confirmation was left standing' end);
    if not ok then raise exception E'%\n  FAIL: te_leg_send_back did not do both halves.', r; end if;

    -- a reason is the whole point
    begin
      perform te_leg_send_back(v_leg.id, v_desk, 'travel', '   ');
      raise exception E'%\n  FAIL: a journey was sent back with no reason.', r;
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err like '%FAIL:%' then raise; end if;
      r := r || format('  a reason is required  refused: "%s"' || E'\n', v_err);
    end;

    -- THE CLAIM GATE. This is the one that matters: the hold has to be real.
    begin
      perform te_claim_submit(
        jsonb_build_object('employee_id', v_leg.employee_id, 'trip_id', v_leg.trip_id,
                           'line_ids', jsonb_build_array(gen_random_uuid()), 'declared', true),
        v_leg.employee_id);
      raise exception E'%\n  FAIL: the claim was accepted while a journey was sent back.', r;
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err like '%FAIL:%' then raise; end if;
      -- Any refusal proves the gate is reached; the sent-back one proves it is
      -- THIS gate. An earlier refusal (a bogus line id) is reported honestly
      -- rather than counted as a pass for something it did not test.
      r := r || format('  the claim is held     %s: "%s"' || E'\n',
            case when v_err like '%sent back to you%' then 'by this rule' else 'by an earlier rule, so this run did not reach it' end,
            v_err);
    end;

    -- ── the traveller answers ───────────────────────────────────────────────
    perform te_leg_answer(v_leg.id, v_leg.employee_id, 'Signal dropped in the basement; I walked the last 200 m.');
    select sent_back_at is null and review_answer like '%client office%' and review_answer like '%basement%'
      into ok from te_legs where id = v_leg.id;
    r := r || format('  answering releases    %s' || E'\n',
          case when ok then 'hold lifted, and the question kept beside the answer' else 'FAILED' end);
    if not ok then raise exception E'%\n  FAIL: te_leg_answer did not lift the hold, or dropped the question.', r; end if;

    select desk_confirmed_at is null into ok from te_legs where id = v_leg.id;
    r := r || format('  but does not confirm  %s' || E'\n',
          case when ok then 'correct — the desk still has to look again'
               else 'FAILED: answering restored the confirmation' end);
    if not ok then raise exception E'%\n  FAIL: answering restored a withdrawn confirmation.', r; end if;
  end if;

  -- Everything passed. Abort on purpose so none of it survives.
  raise exception E'%\n  ALL CHECKS PASSED. This error is deliberate: it rolls back every write above, so the journey is exactly as it was.', r;
end $$;
