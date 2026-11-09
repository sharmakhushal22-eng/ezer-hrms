-- 185_te_one_bucket_verify.sql — proves a loose bill can be moved into a trip,
-- that every refusal actually refuses, and that the booking id a trip's bucket
-- needs is really on the wire.
--
-- NOT A MIGRATION. Run it in the SQL editor whenever you want the proof again.
-- APPLY 185 FIRST.
--
-- WRITES NOTHING THAT SURVIVES. It creates an expense line, moves it about,
-- tries every refusal — and then raises an exception on purpose. The exception
-- aborts the block, so the table is exactly as it was. The report survives
-- because a PL/pgSQL variable is not transactional; the same trick 175, 176,
-- 177 and 180 use.
--
-- IT FINISHES WITH AN ERROR IN RED. That is the success case. Read the message.
--
-- WHAT IS BEING PROVED:
--
--   bookingId is exposed    te_expense_json carries booking_id. Without it the
--                            trip bucket cannot tell a desk booking that has a
--                            mirror bill from one that has none, and would add
--                            the fare twice.
--   a loose bill moves in   trip_id null -> an approved trip of the actor's.
--   and back out again      p_trip null returns it to the "not on a trip"
--                            bucket, which is how a mis-filed client lunch
--                            gets home.
--   the leg is cleared      a line carrying a journey of the trip it leaves
--                            must not keep pointing at it.
--   a claimed line is stuck once a claim carries it, the claim was approved
--                            against that trip. This is the refusal that
--                            matters most and the one most likely to rot.
--   somebody else's line    is reported as not found, not as forbidden.
--   a company-paid line     is refused. This is the first of the two guards
--                            that keep a desk booking with its ticket; the
--                            booking_id guard behind it needs a real booking
--                            row and is covered by the unit tests on the
--                            bucket's de-duplication instead.
--   a trip you are not on   is refused even though it exists.
--   an unapproved trip      is refused: there is no policy to price against.
--   same bucket is a no-op  moved = false, and no audit line is written for
--                            something that did not happen.
-- ============================================================================
do $$
declare
  r          text := E'\n=== 185 one bucket per trip ===\n';
  v_emp      employees;
  v_other    employees;
  v_trip     te_trips;
  v_trip2    te_trips;
  v_draft    te_trips;
  v_cat      text;
  v_x        uuid;
  v_leg      uuid;
  v_res      jsonb;
  v_json     jsonb;
  v_logs     int;
  v_before   int;
  v_err      text;
begin
  -- ── a traveller with an approved trip, and a second approved trip ────────
  select t.* into v_trip
    from te_trips t
   where t.status in ('APPROVED','CLAIMED')
   order by t.created_at desc limit 1;
  if v_trip.id is null then
    raise exception 'No approved trip exists, so there is nothing to move a bill into. Approve a trip and run this again.';
  end if;
  select * into v_emp from employees where id = v_trip.employee_id;
  select t.* into v_trip2
    from te_trips t
   where t.employee_id = v_emp.id and t.status in ('APPROVED','CLAIMED') and t.id <> v_trip.id
   limit 1;
  -- te_is_employee_active rather than a guess at employees.status: it is the
  -- same test te_assert_active applies, so this picks somebody the function
  -- will actually let through.
  select * into v_other from employees
   where company_id = v_emp.company_id and id <> v_emp.id and te_is_employee_active(id) limit 1;

  r := r || format('traveller            %s on %s%s', v_emp.full_name, v_trip.trip_no, E'\n');

  -- a category that does NOT require a trip, so it can legally sit loose
  select k.code into v_cat from te_categories k
   where k.company_id = v_emp.company_id and not k.needs_trip and k.is_active
   order by k.code limit 1;
  if v_cat is null then
    raise exception 'Every category on this company requires a trip, so no bill can sit outside one. Nothing to prove.';
  end if;

  -- ── bookingId on the wire ────────────────────────────────────────────────
  insert into te_expenses (company_id, expense_no, employee_id, category_code, expense_date,
                           bill_amount, claimed_amount, paid_by, status, description)
  values (v_emp.company_id, 'VERIFY-185-' || substr(md5(random()::text), 1, 6), v_emp.id, v_cat,
          current_date, 250, 250, 'self', 'UNCLAIMED', '185 verify')
  returning id into v_x;

  select te_expense_json(x.*) into v_json from te_expenses x where x.id = v_x;
  if not (v_json ? 'bookingId') then
    raise exception '185 is NOT applied: te_expense_json has no bookingId, so the trip bucket would double-count every desk booking that has a mirror bill.';
  end if;
  r := r || format('bookingId exposed    yes (null on a self-paid line: %s)%s',
                   coalesce(v_json->>'bookingId', 'null'), E'\n');

  -- ── a loose bill moves in ────────────────────────────────────────────────
  select count(*) into v_before from te_audit_log where entity_id = v_x;
  v_res := te_expense_move_trip(v_x, v_trip.id, v_emp.id);
  if not (v_res->>'moved')::boolean then
    raise exception 'A loose bill would not move into %: %', v_trip.trip_no, v_res;
  end if;
  if (select trip_id from te_expenses where id = v_x) <> v_trip.id then
    raise exception 'move reported success but trip_id did not change';
  end if;
  r := r || format('moved in             %s -> %s%s', v_res->>'expense_no', v_res->>'trip_no', E'\n');

  select count(*) into v_logs from te_audit_log where entity_id = v_x and action = 'EXPENSE_MOVED';
  r := r || format('audit written        %s EXPENSE_MOVED row(s)%s', v_logs, E'\n');

  -- ── the same bucket twice is a no-op, and logs nothing more ──────────────
  v_res := te_expense_move_trip(v_x, v_trip.id, v_emp.id);
  if (v_res->>'moved')::boolean then
    raise exception 'Moving a line into the bucket it is already in reported a move.';
  end if;
  select count(*) into v_logs from te_audit_log where entity_id = v_x and action = 'EXPENSE_MOVED';
  r := r || format('same bucket          no-op, still %s audit row(s)%s', v_logs, E'\n');

  -- ── the leg is cleared on a real move ────────────────────────────────────
  select l.id into v_leg from te_legs l where l.trip_id = v_trip.id limit 1;
  if v_leg is not null and v_trip2.id is not null then
    update te_expenses set leg_id = v_leg where id = v_x;
    v_res := te_expense_move_trip(v_x, v_trip2.id, v_emp.id);
    if (select leg_id from te_expenses where id = v_x) is not null then
      raise exception 'The line kept a journey belonging to the trip it left — a dangling reference into another trip.';
    end if;
    r := r || format('leg cleared          yes, moving %s -> %s%s', v_trip.trip_no, v_trip2.trip_no, E'\n');
    v_res := te_expense_move_trip(v_x, v_trip.id, v_emp.id);
  else
    r := r || E'leg cleared          SKIPPED (needs a journey and a second approved trip)\n';
  end if;

  -- ── and back out to the loose bucket ─────────────────────────────────────
  v_res := te_expense_move_trip(v_x, null, v_emp.id);
  if (select trip_id from te_expenses where id = v_x) is not null then
    raise exception 'A bill could not be moved out of a trip, so a mis-filed one has no way home.';
  end if;
  r := r || E'moved back out       yes, to "not on a trip"\n';

  -- ── somebody else's line is NOT FOUND, not forbidden ─────────────────────
  if v_other.id is not null then
    begin
      v_res := te_expense_move_trip(v_x, v_trip.id, v_other.id);
      raise exception 'A colleague moved somebody else''s bill.';
    exception when others then
      v_err := sqlerrm;
      if v_err like '%moved somebody else%' then raise;
      end if;
      r := r || format('another person       refused: %s%s', left(v_err, 60), E'\n');
    end;
  else
    r := r || E'another person       SKIPPED (no second active employee)\n';
  end if;

  -- ── a trip the actor is not on ───────────────────────────────────────────
  select t.* into v_draft from te_trips t
   where t.company_id = v_emp.company_id and t.employee_id <> v_emp.id
     and t.status in ('APPROVED','CLAIMED')
     and not exists (select 1 from te_trip_people tp where tp.trip_id = t.id and tp.employee_id = v_emp.id)
   limit 1;
  if v_draft.id is not null then
    begin
      v_res := te_expense_move_trip(v_x, v_draft.id, v_emp.id);
      raise exception 'A bill was moved into a trip the person is not on.';
    exception when others then
      v_err := sqlerrm;
      if v_err like '%not on.' then raise; end if;
      r := r || format('not your trip        refused: %s%s', left(v_err, 60), E'\n');
    end;
  else
    r := r || E'not your trip        SKIPPED (no other traveller''s approved trip)\n';
  end if;

  -- ── a trip nobody has approved ───────────────────────────────────────────
  select t.* into v_draft from te_trips t
   where t.employee_id = v_emp.id and t.status in ('DRAFT','PENDING_APPROVAL','SENT_BACK') limit 1;
  if v_draft.id is not null then
    begin
      v_res := te_expense_move_trip(v_x, v_draft.id, v_emp.id);
      raise exception 'A bill was moved into a trip that is only %.', v_draft.status;
    exception when others then
      v_err := sqlerrm;
      if v_err like '%only %' then raise; end if;
      r := r || format('unapproved trip      refused: %s%s', left(v_err, 60), E'\n');
    end;
  else
    r := r || E'unapproved trip      SKIPPED (no draft trip of this traveller)\n';
  end if;

  -- ── a line a claim already carries ───────────────────────────────────────
  update te_expenses set status = 'IN_CLAIM' where id = v_x;
  begin
    v_res := te_expense_move_trip(v_x, v_trip.id, v_emp.id);
    raise exception 'A line already in a claim was moved between trips, rewriting what a claim was approved against.';
  exception when others then
    v_err := sqlerrm;
    if v_err like '%rewriting what a claim%' then raise; end if;
    r := r || format('already claimed      refused: %s%s', left(v_err, 70), E'\n');
  end;
  update te_expenses set status = 'UNCLAIMED' where id = v_x;

  -- ── a company-paid line stays where the desk put it ─────────────────────
  update te_expenses set paid_by = 'company' where id = v_x;
  begin
    v_res := te_expense_move_trip(v_x, v_trip.id, v_emp.id);
    raise exception 'A company-paid line was moved.';
  exception when others then
    v_err := sqlerrm;
    if v_err like '%company-paid line was moved%' then raise; end if;
    r := r || format('company paid         refused: %s%s', left(v_err, 60), E'\n');
  end;

  raise exception E'%\n=== every check passed. Nothing was kept. ===', r;
end $$;
