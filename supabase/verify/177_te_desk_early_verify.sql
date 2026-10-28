-- 177_te_desk_early_verify.sql — proves the desk sees a waiting trip, and that
-- seeing it is not the same as being allowed to book it.
--
-- NOT A MIGRATION. Run it in the SQL editor whenever you want the proof again.
-- APPLY 177 FIRST.
--
-- WRITES NOTHING THAT SURVIVES. Rather than build a trip fixture from nothing,
-- it takes a trip that is already APPROVED and has desk legs, moves it back to
-- PENDING_APPROVAL, asks the views what they now show, and then raises an
-- exception on purpose. The exception aborts the block, so the trip's status is
-- exactly as it was. The report survives because a PL/pgSQL variable is not
-- transactional; that is the whole trick.
--
-- IT FINISHES WITH AN ERROR IN RED. That is the success case. Read the message.
--
-- WHAT IS BEING PROVED:
--
--   waiting trips appear    the point of 177. A trip that has not been approved
--                           is in v_te_to_book, so the desk gets the lead time
--                           the notice rule (169) already promises it.
--   and are marked          trip_status comes through, so the screen can say
--                           "waiting for approval" and withhold Record instead
--                           of offering a button the floor will refuse.
--   booking is still shut   te_booking_record refuses a trip that is not
--                           APPROVED. This is the half that must NOT have moved:
--                           if it ever passes, the desk can spend money on a
--                           trip an approver may still reject.
--   rejected stays out      a REJECTED or CANCELLED trip is in neither list.
--   no trip in both lists   v_te_desk_watch is "nothing to book here", so a trip
--                           with a desk leg must never be in it. Two lists that
--                           overlap are worse than one.
--   the browser keys        neither view is readable by anon or authenticated.
--                           Rebuilding v_te_to_book dropped the grants 151 gave
--                           it, so this is the check that it was put back.
-- ============================================================================

do $$
declare
  t         te_trips;
  v_rows    int;
  v_status  text;
  v_both    int;
  v_bad     int;
  r         text := E'\n';
  fails     int  := 0;
  v_msg     text;
begin
  -- A trip that is approved and still has something for the desk to book.
  select tr.* into t
    from te_trips tr
   where tr.status = 'APPROVED'
     and exists (select 1 from v_te_to_book b where b.trip_id = tr.id and b.kind = 'leg')
   order by tr.trip_no
   limit 1;
  if not found then
    raise exception 'Need one APPROVED trip with an unbooked desk leg. Plan one with a flight marked "Travel Desk books", approve it, and run this again.';
  end if;
  r := r || format(E'  using %s (%s)\n\n', t.trip_no, t.status);

  -- ── it is visible while APPROVED, and marked so ──────────────────────────
  select count(*), min(b.trip_status) into v_rows, v_status
    from v_te_to_book b where b.trip_id = t.id and b.kind = 'leg';
  if v_rows > 0 and v_status = 'APPROVED'
  then r := r || format(E'  ok   approved: %s leg(s) in the desk list, marked APPROVED\n', v_rows);
  else r := r || format(E'  FAIL approved trip shows %s row(s), status %s\n', v_rows, coalesce(v_status, 'null')); fails := fails + 1; end if;

  -- ── now make it wait, which is what 177 is for ───────────────────────────
  update te_trips set status = 'PENDING_APPROVAL' where id = t.id;

  select count(*), min(b.trip_status) into v_rows, v_status
    from v_te_to_book b where b.trip_id = t.id and b.kind = 'leg';
  if v_rows > 0 then r := r || format(E'  ok   waiting: still %s leg(s) in the desk list   <- the fix\n', v_rows);
  else r := r || E'  FAIL a waiting trip vanished from the desk list\n'; fails := fails + 1; end if;

  if v_status = 'PENDING_APPROVAL'
  then r := r || E'  ok   waiting: trip_status says PENDING_APPROVAL, so the screen can show the wait\n';
  else r := r || format(E'  FAIL trip_status is %s, so the screen cannot tell it is waiting\n', coalesce(v_status, 'null')); fails := fails + 1; end if;

  -- ── but it must NOT be bookable ──────────────────────────────────────────
  begin
    perform te_booking_record(jsonb_build_object(
      'trip_id', t.id,
      'leg_id', (select b.leg_id from v_te_to_book b where b.trip_id = t.id and b.kind = 'leg' limit 1),
      'vendor', 'VERIFY', 'reference', 'VERIFY-177', 'amount', 1), t.employee_id);
    r := r || E'  FAIL a WAITING trip was booked. Money can now be spent on a trip nobody approved.\n'; fails := fails + 1;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg ilike '%approved trip%'
    then r := r || E'  ok   booking refused: "' || v_msg || E'"   <- the line that must not move\n';
    else r := r || format(E'  ok   booking refused (%s)\n', left(v_msg, 60)); end if;
  end;

  -- ── a trip nobody will travel is in neither list ─────────────────────────
  update te_trips set status = 'REJECTED' where id = t.id;
  select count(*) into v_rows from v_te_to_book b where b.trip_id = t.id;
  select count(*) into v_both from v_te_desk_watch w where w.trip_id = t.id;
  if v_rows = 0 and v_both = 0 then r := r || E'  ok   rejected: in neither list\n';
  else r := r || format(E'  FAIL rejected trip still shows (%s to_book, %s watch)\n', v_rows, v_both); fails := fails + 1; end if;

  -- ── the two lists never overlap ──────────────────────────────────────────
  select count(*) into v_both
    from v_te_desk_watch w where exists (select 1 from v_te_to_book b where b.trip_id = w.trip_id);
  if v_both = 0 then r := r || E'  ok   no trip is in both the work list and "for information"\n';
  else r := r || format(E'  FAIL %s trip(s) are in both lists\n', v_both); fails := fails + 1; end if;

  -- Every row of the work list is a status the desk should be seeing.
  select count(*) into v_bad from v_te_to_book b
   where b.trip_status not in ('PENDING_APPROVAL', 'SENT_BACK', 'APPROVED');
  if v_bad = 0 then r := r || E'  ok   every row is waiting, sent back, or approved — nothing else\n';
  else r := r || format(E'  FAIL %s row(s) have a status the desk should not see\n', v_bad); fails := fails + 1; end if;

  -- ── the browser keys reach neither view ──────────────────────────────────
  if exists (select 1 from pg_roles where rolname = 'anon') then
    select count(*) into v_bad from (
      select 1 from information_schema.role_table_grants
       where table_name in ('v_te_to_book', 'v_te_desk_watch') and grantee in ('anon', 'authenticated')) q;
    if v_bad = 0 then r := r || E'  ok   anon and authenticated hold no grant on either view\n';
    else r := r || format(E'  FAIL %s browser grant(s) on the desk views — 177 did not lock them down\n', v_bad); fails := fails + 1; end if;
  end if;

  raise exception E'177 VERIFY — % check(s) failed%', fails, r ||
    E'\n  (This error is expected: it rolls the trip''s status back. Nothing was kept.)';
end $$;
