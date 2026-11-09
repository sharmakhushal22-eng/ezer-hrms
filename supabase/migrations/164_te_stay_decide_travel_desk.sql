-- 164_te_stay_decide_travel_desk.sql — the hotel choice belongs to the Travel
-- desk, which is what its own refusal has always said.
-- SAFE TO RUN TWICE. NEEDS 161 (te_desk_members, travel_desk).
-- ----------------------------------------------------------------------------
-- THE BUG, which was a complete deadlock and not a rough edge. te_stay_decide
-- refused anybody who was not in te_finance_members, while telling them
-- "Only the Travel Desk can choose the hotel." When 159 was written that was
-- the closest thing to a desk that existed, so it was a stand-in rather than a
-- mistake — but after 161 gave the Travel desk its own membership, the two
-- halves of the flow pointed at different people:
--
--   the one person on the Travel desk has the tab, and SQL refused him
--   the 41 people on the Finance desk passed SQL, and have no tab to click
--
-- So nobody could choose a hotel. Verified against the live data before
-- writing this: te_on_desk('travel') is true and te_finance_members() false
-- for the only Travel desk member.
--
-- WHAT IT CHECKS NOW. te_desk_members('travel', company, the raiser's branch) —
-- the same branch -> company -> group ladder as every other scoped decision,
-- so a hotel for a trip raised at Mumbai is chosen by Mumbai's travel desk,
-- or whoever covers it.
--
-- WHAT IS DELIBERATELY NOT CHANGED. There is still no status guard, so a hotel
-- can be chosen while the trip is still waiting for its manager. That is worth
-- knowing but it is not wrong: lining up a room early is useful, and BOOKING
-- it still waits for approval — v_te_to_book requires status = 'APPROVED'.
-- Choosing records which hotel was chosen and no money, which is exactly the
-- separation 159's own header describes.
--
-- te_stay_decide is taken verbatim from 159, its only definition.
-- ============================================================================

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
  -- THE TRAVEL DESK, which is what this refusal has always SAID. It checked
  -- te_finance_members, because when 159 was written there was no travel desk
  -- to check — and the result was that nobody could choose a hotel at all:
  -- the one person with the Travel Desk tab is not on the Finance desk, and
  -- the Finance people who passed this test have no Travel Desk tab to reach
  -- the screen from. Migration 161 created travel_desk; this is the check
  -- catching up with its own error message.
  --
  -- Scoped to the branch the trip was raised at, through the same
  -- branch -> company -> group ladder everything else uses.
  if not (p_actor = any (te_desk_members('travel', t.company_id,
                           (select e.location_id from employees e where e.id = t.employee_id)))) then
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
notify pgrst, 'reload schema';
