-- 185_te_one_bucket_per_trip.sql — every rupee of a trip in one bucket, and a
-- loose bill that can be moved into it.
-- SAFE TO RUN TWICE. Two functions replaced/added. No table or column changes.
-- ----------------------------------------------------------------------------
-- WHAT WAS WRONG. te_trip_detail has returned `advance` and `bookings` since
-- 153, and the trip ledger on screen reads neither: it adds up expense lines
-- and calls the result "Total on TRP-2026-0007". So a ₹40,000 flight the Travel
-- Desk booked and paid for is absent from the one figure that claims to be what
-- the trip cost — unless a mirror expense row happens to exist for it. A
-- booking still in REQUESTED has no mirror row at all and is invisible in every
-- total.
--
-- Fixing that on the client needs one fact the server has never sent:
-- te_expenses.booking_id. Without it the bucket cannot tell a desk-booked
-- ticket that ALREADY has an expense row from one that has none, and adding
-- both is how you overstate a trip by the price of a flight. The only route to
-- the id was the fabricated f.sha = 'bk-<uuid>' inside the `file` fallback,
-- which is not a key anybody should join on.
--
-- So: part 1 exposes bookingId. The grouping, the totals and the netting are
-- the client's job and are tested there (lib/te/trip-ledger.ts) — SQL's job
-- here is only to tell the truth about what belongs to what.
--
-- ============================================================================
-- PART 2 — MOVING A LINE INTO A TRIP.
--
-- A bill filed before the trip was raised, or against the wrong trip, is stuck
-- today. te_expense_save REFUSES to re-parent on purpose — `v_trip :=
-- prev.trip_id` throws away whatever the browser sent, which is right, because
-- the trip is the thing the policy engine priced the line against and a form
-- POST must not be able to quietly move money between trips.
--
-- That guard stays exactly as it is. Re-parenting gets its OWN function, with
-- its own narrow conditions and its own audit line, so the dangerous act is
-- named rather than smuggled through the save path:
--
--   * your own line only, and only while it is UNCLAIMED and in no claim.
--     Once a claim carries it, the claim was approved against a trip and its
--     totals were computed there; moving it afterwards rewrites history.
--   * never a company-paid line, and never one that mirrors a booking. That
--     row is the desk's record of a ticket it bought; separating it from the
--     booking would leave the ticket on one trip and its cost on another.
--   * into your own trip, or one you were taken on — the same test 155 applies
--     to filing a line in the first place, so this cannot reach further than
--     the form could.
--   * not into a cancelled or rejected trip, and not into a trip that is
--     CLOSED: closed means settled, and a new line would land after the money.
--   * p_trip null is allowed, and means OUT of the trip, back to the bucket of
--     things that are not on a trip. A client lunch filed against a trip by
--     mistake has to have a way home.
--
-- THE LEG GOES WITH IT, which is to say it does not. A line reporting journey 3
-- of trip A means nothing on trip B, so the leg is cleared on a real move. The
-- alternative — carrying a leg id that belongs to another trip — is the kind of
-- dangling reference that reads fine for a year and then renders somebody
-- else's journey inside your claim.
--
-- A LOCKED MONTH IS ALREADY REFUSED and is not re-checked here.
-- trg_te_expenses_locked (145) rejects any update to a line whose period is
-- LOCKED, so a move in a closed month fails at the table whatever this function
-- thinks. That is the floor working as intended; duplicating the test here
-- would only add a second copy of the wording to keep in step.
-- ============================================================================

-- ── part 1: bookingId, verbatim from 148 plus one key ──────────────────────
create or replace function te_expense_json(x te_expenses)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', x.id, 'no', x.expense_no, 'emp', x.employee_id, 'tripId', x.trip_id, 'legId', x.leg_id,
    -- WHY THIS IS HERE. The booking a line mirrors. Without it, a trip's one
    -- bucket cannot tell a desk-booked ticket that already has an expense row
    -- from one that has none, and the only way to the id was f.sha = 'bk-<uuid>'
    -- fabricated below. Counting both would overstate what the trip cost.
    'bookingId', x.booking_id,
    -- a line that is the report of a leg carries journeyId; a ticket the Travel Desk booked does not
    'journeyId', case when x.paid_by = 'self' then x.leg_id end,
    'cat', x.category_code, 'date', x.expense_date, 'checkIn', x.check_in, 'checkOut', x.check_out,
    'merchant', coalesce(x.merchant, ''), 'gstin', coalesce(x.merchant_gstin, ''), 'billNo', coalesce(x.bill_no, ''),
    'pnr', case when x.category_code in ('air','train','bus') then coalesce(x.reference, '') else '' end,
    'ref', case when x.category_code in ('air','train','bus') then '' else coalesce(x.reference, '') end,
    'cls', coalesce(x.travel_class, ''),
    'bill', x.bill_amount, 'claimed', x.claimed_amount, 'eligible', x.eligible_amount, 'approved', x.approved_amount,
    'pay', x.paid_by, 'payMode', coalesce(x.payment_mode, ''), 'desc', coalesce(x.description, ''),
    'reason', coalesce(x.employee_reason, ''), 'wantException', x.wants_exception, 'dreason', coalesce(x.decision_reason, ''),
    'vehicleId', x.vehicle_id, 'from', x.from_place_id, 'to', x.to_place_id,
    'payKm', x.payable_km, 'rate', x.rate_applied, 'km', nullif(x.details->>'km', '')::numeric,
    'client', coalesce(x.client_name, ''), 'attendees', x.attendees,
    'shared', coalesce((x.details->>'shared')::boolean, false),
    'curr', case when x.currency <> 'INR' then x.currency else '' end, 'fxAmt', coalesce(x.fx_amount, 0), 'fxRate', coalesce(x.fx_rate, 0),
    -- a line the Travel Desk booked is its own proof: the booking stands in for the bill
    'file', coalesce((select jsonb_strip_nulls(jsonb_build_object(
                      'id', f.id, 'name', coalesce(f.file_name, 'bill'), 'path', f.storage_path, 'kind', f.kind,
                      'sha', f.sha256, 'phash', f.phash,
                      'ocrAmount', nullif(f.ocr->>'amount', '')::numeric, 'text', f.ocr->>'text',
                      'editedWith', f.metadata->>'software', 'producer', f.metadata->>'producer'))
               from te_expense_files f where f.expense_id = x.id order by f.uploaded_at, f.id limit 1),
             (select jsonb_build_object('name', b.booking_no || '-ticket', 'sha', 'bk-' || b.id::text, 'path', coalesce(b.ticket_url, ''), 'booking', true)
                from te_bookings b where b.id = x.booking_id)),
    'files', (select count(*) from te_expense_files f where f.expense_id = x.id),
    'status', x.status, 'claimId', x.claim_id,
    'claimNo', (select c.claim_no from te_claims c where c.id = x.claim_id),
    'fix', x.needs_fix, 'lstatus', x.line_decision, 'details', x.details);
$$;

-- ── part 2: move one unclaimed line between buckets ─────────────────────────
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
    perform te_fail('TE_EXPENSE',
      'This line is already in claim ' || coalesce(v_claim_no, 'a claim')
      || '. A claim was approved against the trip it was on, so the line stays there.');
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

-- ── locked down, the same way 176 and 184 lock the other actor-taking fns ───
-- It takes p_actor, so an open execute grant would let anybody move anybody's
-- expenses between trips with the key that ships in the browser.
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
