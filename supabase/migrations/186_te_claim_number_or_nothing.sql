-- 186_te_claim_number_or_nothing.sql — "already in claim a claim".
-- SAFE TO RUN TWICE. One function replaced. No table or column changes.
-- ----------------------------------------------------------------------------
-- WHAT IT SAID. Moving an expense line that a claim already carries refused
-- with:
--
--     This line is already in claim a claim. A claim was approved against
--     the trip it was on, so the line stays there.
--
-- "in claim a claim". The fallback for a missing claim number was dropped into
-- the middle of a sentence that had already said the word "claim", so the two
-- halves read as one broken phrase. Caught by reading the actual output of an
-- end-to-end run on 25 October 2026, not by any test — the refusal fired
-- correctly, which is all a test was asserting.
--
-- WHEN THE FALLBACK IS EVEN REACHED. A line with status IN_CLAIM normally has
-- claim_id set, so in ordinary use the number is there and the sentence was
-- fine. The fallback is for the case where the two disagree — which is exactly
-- the moment somebody is looking at the screen wondering what went wrong, and
-- exactly the wrong moment to show them a sentence that looks like a bug.
--
-- So the number or nothing, never both, chosen before the sentence is built
-- rather than patched into the middle of it.
--
-- This is the third time a refusal of mine has needed its wording fixed after
-- the fact (181, 183, now this). All three were found by reading real output.
-- ============================================================================

create or replace function te_expense_move_trip(p_id uuid, p_trip uuid, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  x          te_expenses;
  v_cat      te_categories;
  t_old      te_trips;
  t_new      te_trips;
  v_claim_no text;
begin
  perform te_assert_active(p_actor);

  select * into x from te_expenses where id = p_id for update;
  if not found or x.employee_id <> p_actor then
    -- The same wording te_expense_save uses, and for the same reason: somebody
    -- else's line must not be distinguishable from one that does not exist.
    perform te_fail('TE_EXPENSE', 'Expense not found.');
  end if;

  if x.paid_by = 'company' then
    perform te_fail('TE_EXPENSE', 'This was booked and paid by the company. It cannot be moved here.');
  end if;
  if x.booking_id is not null then
    perform te_fail('TE_EXPENSE', 'This line is the record of a booking. Moving it would leave the ticket on one trip and its cost on another.');
  end if;
  if x.status <> 'UNCLAIMED' or x.claim_id is not null then
    select c.claim_no into v_claim_no from te_claims c where c.id = x.claim_id;
    -- THE NUMBER OR NOTHING, never both. This read "already in claim a claim"
    -- whenever the number could not be found, because the fallback was dropped
    -- into the middle of a sentence that already said "claim". Reproduced in
    -- end-to-end testing on 25 October.
    perform te_fail('TE_EXPENSE',
      case when v_claim_no is null
             then 'This line is already in a claim.'
             else 'This line is already in claim ' || v_claim_no || '.'
      end
      || ' A claim was approved against the trip it was on, so the line stays there.');
  end if;

  select * into t_old from te_trips where id = x.trip_id;

  if p_trip is not null then
    select * into t_new from te_trips where id = p_trip;
    if not found then
      perform te_fail('TE_EXPENSE', 'Trip not found.');
    end if;
    if t_new.id = x.trip_id then
      -- Not an error. Asking for the bucket it is already in is a no-op, and
      -- saying so beats writing an audit line that records nothing happening.
      return jsonb_build_object('moved', false, 'expense_no', x.expense_no, 'trip_no', t_new.trip_no);
    end if;
    -- YOUR OWN TRIP, OR ONE YOU WERE TAKEN ON — the test 155 applies when a
    -- line is first filed. Reaching further here would make this function a way
    -- round the form.
    if not (t_new.employee_id = p_actor
            or exists (select 1 from te_trip_people tp where tp.trip_id = t_new.id and tp.employee_id = p_actor)) then
      perform te_fail('TE_EXPENSE', 'That trip is not yours and you are not on it.');
    end if;
    if t_new.status in ('REJECTED','CANCELLED') then
      perform te_fail('TE_EXPENSE', 'This trip was cancelled or rejected. Nothing can be added to it.');
    end if;
    if t_new.status = 'CLOSED' then
      perform te_fail('TE_EXPENSE', 'This trip is closed and settled. A new line cannot be added to it now.');
    end if;
    if t_new.status in ('DRAFT','PENDING_APPROVAL','SENT_BACK') then
      perform te_fail('TE_EXPENSE', 'This trip has not been approved yet. Wait until it is, then move the bill in.');
    end if;
  else
    if x.trip_id is null then
      return jsonb_build_object('moved', false, 'expense_no', x.expense_no, 'trip_no', null);
    end if;
  end if;

  -- A category that belongs to a trip cannot be moved out of every trip.
  select * into v_cat from te_categories k
   where k.company_id = x.company_id and k.code = x.category_code;
  if p_trip is null and found and v_cat.needs_trip then
    perform te_fail('TE_EXPENSE', v_cat.name || ' belongs to a trip. It cannot be moved out of one.');
  end if;

  update te_expenses
     set trip_id    = p_trip,
         -- the leg belonged to the trip it is leaving; see the header
         leg_id     = null,
         updated_at = now()
   where id = x.id;

  perform te_log(x.company_id, 'expense', x.id, x.expense_no, 'EXPENSE_MOVED', p_actor,
    case
      when p_trip is null then 'Moved off trip ' || coalesce(t_old.trip_no, '?') || ' — not on a trip now'
      when x.trip_id is null then 'Moved into trip ' || t_new.trip_no
      else 'Moved from trip ' || coalesce(t_old.trip_no, '?') || ' to ' || t_new.trip_no
    end,
    true,
    jsonb_build_object('trip_id', x.trip_id, 'trip_no', t_old.trip_no, 'leg_id', x.leg_id),
    jsonb_build_object('trip_id', p_trip, 'trip_no', t_new.trip_no));

  return jsonb_build_object('moved', true, 'expense_no', x.expense_no,
                            'from_no', t_old.trip_no, 'trip_no', t_new.trip_no);
end;
$$;
comment on function te_expense_move_trip is
  'Move one of the actor''s own unclaimed expense lines into a trip, or out of every trip when p_trip is null. Refuses a line that is in a claim, was paid by the company, or mirrors a booking. The leg is cleared, because a leg belongs to the trip the line is leaving.';

-- ── the grants are re-asserted, because create or replace keeps the old ones ─
-- but a dropped-and-recreated function would not. Cheap, and it means this file
-- is safe to run on a database where 185 was never applied.
do $$
declare
  sig text;
begin
  for sig in
    select format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'te_expense_move_trip'
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
