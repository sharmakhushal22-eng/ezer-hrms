-- 178_te_booking_ticket_and_email.sql — the ticket is attached, and the
-- traveller can be sent it.
-- SAFE TO RUN TWICE. Adds three columns and replaces one function.
-- ----------------------------------------------------------------------------
-- TWO THINGS, both about the moment a booking is recorded.
--
-- 1. THE TICKET IS NOW REQUIRED. te_bookings.ticket_url has existed since the
--    table was built and nothing ever filled it: the desk screen collected a
--    vendor, a reference and an amount, so every booking in this database is a
--    PNR and a number. The traveller has nothing to show at a counter and
--    Finance has nothing to match a bill against. The desk has the file in its
--    hand at the moment it records the booking and will not have it as readily
--    a week later, so that is the moment to ask.
--
--    REQUESTING IS NOT RECORDING. te_booking_request — the employee asking the
--    desk to book a stay they found — writes a te_bookings row with status
--    REQUESTED and no ticket, because nothing has been bought yet. That path is
--    untouched; only te_booking_record refuses.
--
--    EXISTING ROWS ARE LEFT ALONE. This is a refusal inside the function, not a
--    NOT NULL on the column: the bookings already recorded without a ticket
--    stay exactly as they are, and nothing has to be backfilled to make the
--    module work.
--
-- 2. WHEN THE TRAVELLER WAS SENT IT. Three columns, so sending is a fact on the
--    record rather than something somebody remembers doing: who it went to, at
--    what time, and which desk member sent it. Sending twice is allowed and
--    expected — a traveller loses the mail, or the itinerary changes — so these
--    hold the LAST send rather than a count.
-- ============================================================================

alter table te_bookings add column if not exists emailed_at timestamptz;
alter table te_bookings add column if not exists emailed_to text;
alter table te_bookings add column if not exists emailed_by uuid references employees(id);

comment on column te_bookings.emailed_at is
  'When the traveller was last sent this booking. Null = never sent.';
comment on column te_bookings.emailed_to is
  'The address it was last sent to, kept because an employee''s address can change afterwards.';

create or replace function te_booking_record(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  t       te_trips;
  l       te_legs;
  pt      te_trip_points;
  b       te_bookings;
  x       te_expenses;
  v_leg   uuid := nullif(p->>'leg_id', '')::uuid;
  v_seq   int  := nullif(p->>'point_seq', '')::int;
  v_cat   text;
begin
  select * into t from te_trips where id = (p->>'trip_id')::uuid for update;
  if not found then
    perform te_fail('TE_BOOKING', 'Trip not found.');
  end if;
  if t.status <> 'APPROVED' then
    perform te_fail('TE_BOOKING', 'Only an approved trip can be booked.');
  end if;
  -- MAY THIS PERSON SPEND. "May book" on the travel desk is the right to
  -- commit company money, and until now it bought nothing: the route asked
  -- only for the dashboard Travel Claims permission, so a desk member with
  -- the box unticked could still record a booking. The floor says no.
  if not te_may_book(p_actor) then
    perform te_fail('TE_FORBIDDEN', 'You are on the travel desk but not allowed to book. Ask an administrator to tick "May book" for you.');
  end if;
  if coalesce(btrim(p->>'vendor'), '') = '' or coalesce(btrim(p->>'reference'), '') = '' or coalesce((p->>'amount')::numeric, 0) <= 0 then
    perform te_fail('TE_BOOKING', 'Enter vendor, reference and amount.');
  end if;
  -- THE TICKET ITSELF. A booking without it is a PNR and a number: the
  -- traveller has nothing to show at a counter, and Finance has nothing to
  -- match the bill against months later. The desk has the file in its hand at
  -- the moment it records this, and will not have it as readily afterwards.
  --
  -- ONLY ON RECORDING, not on requesting. te_booking_request is the employee
  -- asking the desk to book a stay they found; there is no ticket then,
  -- because nothing has been bought.
  if coalesce(btrim(p->>'ticket_url'), '') = '' then
    perform te_fail('TE_BOOKING', 'Attach the ticket or the booking slip. The traveller is sent this, and Finance matches the bill to it.');
  end if;
  if v_leg is not null then
    select * into l from te_legs where id = v_leg and trip_id = t.id;
  elsif v_seq is not null then
    select * into pt from te_trip_points where trip_id = t.id and seq = v_seq;
  end if;
  if l.id is null and pt.id is null then
    perform te_fail('TE_BOOKING', 'Choose what is booked.');
  end if;

  insert into te_bookings (company_id, booking_no, trip_id, leg_id, point_seq, kind, vendor, reference, amount, ticket_url, booked_by)
  values (t.company_id, te_next_no(t.company_id, 'booking'), t.id, l.id, case when l.id is null then v_seq end,
          case when l.id is not null then 'travel' else 'hotel' end, btrim(p->>'vendor'), upper(btrim(p->>'reference')),
          (p->>'amount')::numeric, nullif(p->>'ticket_url', ''), p_actor)
  returning * into b;

  if l.id is not null then
    select coalesce(m.category_code, 'air') into v_cat from te_modes m where m.company_id = t.company_id and m.code = l.mode;
  end if;
  x := te__expense_write(jsonb_build_object(
         'employee_id', t.employee_id, 'trip_id', t.id, 'leg_id', l.id, 'booking_id', b.id,
         'category_code', case when l.id is not null then coalesce(v_cat, 'air') else 'hotel' end,
         'expense_date', coalesce(l.leg_date, pt.arrive_on, t.start_date),
         'check_in', pt.arrive_on, 'check_out', pt.leave_on,
         'merchant', b.vendor, 'reference', b.reference, 'bill_amount', b.amount, 'claimed_amount', 0,
         'paid_by', 'company', 'payment_mode', 'Paid by company',
         'description', 'Booked by Travel Desk, ' || b.booking_no), p_actor);

  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'BOOKED', p_actor,
                 'Travel Desk booked ' || b.vendor || ' (' || b.reference || ') for ' || te_rs(b.amount) || '. Paid by company.');
  return jsonb_build_object('booking_id', b.id, 'booking_no', b.booking_no, 'expense_id', x.id);
end;
$$;

-- ── recording that the traveller was sent it ────────────────────────────────
-- Called after the mail provider has accepted the message, so the record says
-- what actually happened rather than what was attempted. The actor must be the
-- person who sent it; the route has already checked they may act on this desk.
create or replace function te_booking_emailed(p_booking_id uuid, p_actor uuid, p_to text)
returns jsonb language plpgsql as $$
declare
  b te_bookings;
  t te_trips;
begin
  select * into b from te_bookings where id = p_booking_id for update;
  if not found then
    perform te_fail('TE_BOOKING', 'Booking not found.');
  end if;
  if coalesce(btrim(p_to), '') = '' then
    perform te_fail('TE_BOOKING', 'Say which address it went to.');
  end if;
  update te_bookings
     set emailed_at = now(), emailed_to = btrim(p_to), emailed_by = p_actor
   where id = p_booking_id;
  select * into t from te_trips where id = b.trip_id;
  perform te_log(b.company_id, 'trip', t.id, t.trip_no, 'BOOKING_EMAILED', p_actor,
                 'Sent ' || b.booking_no || ' (' || b.vendor || ', ' || b.reference || ') to ' || btrim(p_to) || '.');
  return jsonb_build_object('booking_id', b.id, 'emailed_to', btrim(p_to));
end;
$$;

comment on function te_booking_emailed is
  'Records that a booking was emailed to the traveller. Holds the last send, not a count: sending again is normal.';

do $$
declare
  sig text;
begin
  for sig in
    select format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'te_booking_emailed'
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
