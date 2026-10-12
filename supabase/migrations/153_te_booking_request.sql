-- 153_te_booking_request.sql
-- ============================================================================
-- EZER HRMS — TRAVEL & EXPENSE v2  ·  AN EMPLOYEE ASKS FOR A STAY
-- SAFE TO RUN TWICE.
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
--
-- te_bookings has carried a 'REQUESTED' status since 144 and nothing ever
-- produced it. The only writer is te_booking_record() (146), which is the
-- Travel Desk recording something it has ALREADY booked and paid for:
--
--   · it refuses unless the trip is APPROVED
--   · it demands a reference — the PNR — which nobody has before booking
--   · it writes a company-paid expense line onto the trip
--
-- A request is the other end of that. The employee has found a hotel, wants
-- the desk to book it, and nothing has been bought: no PNR, no money moved,
-- so no expense line. Creating one would put a cost on the trip for a stay
-- that may never be booked, and the trip's cost sheet is what the approver
-- reads.
--
-- WHAT CHANGES
--
--   reference  becomes nullable. It is the PNR, and a request has none. The
--              desk fills it in when it books.
--   details    new jsonb. What the employee found: the address, the room, the
--              platform, the nights, their note. Kept as jsonb rather than six
--              columns because none of it is ever filtered or joined on — it
--              is read back whole, by a person, on the claim desk.
--   requested_by / requested_at
--              who asked, as distinct from booked_by/booked_at, which stay
--              the desk's. A request that is later booked keeps both.
--
-- The platform link goes in the existing ticket_url. On a desk booking that
-- column holds the e-ticket; on a request it holds the MakeMyTrip (or other)
-- page the employee chose. Both are "where to see this booking", so they are
-- the same column rather than a second one that means almost the same thing.
-- ============================================================================

alter table te_bookings alter column reference drop not null;

alter table te_bookings add column if not exists details jsonb not null default '{}'::jsonb;
alter table te_bookings add column if not exists requested_by uuid references employees(id) on delete set null;
alter table te_bookings add column if not exists requested_at timestamptz;

comment on column te_bookings.details is
  'A requested stay as the employee described it: address, room, platform, nights, note. Read whole, never filtered on.';
comment on column te_bookings.reference is
  'PNR or booking reference. Null on a REQUESTED row — there is nothing to reference until it is booked.';

-- ----------------------------------------------------------------------------
-- te_booking_request(p, p_actor)
--
--   p = { trip_id, point_seq?, leg_id?, vendor, amount, ticket_url?,
--         details: { address?, room?, platform?, check_in?, check_out?, note? } }
--
-- Refuses, as a Postgres exception, when:
--   · the trip is not the actor's own
--   · the trip is in a state where asking makes no sense — cancelled,
--     rejected, closed, or already claimed
--   · the hotel has no name, or the estimate is not a positive number
--   · the same stay has already been asked for and not yet dealt with
--
-- It writes NO expense. The desk's te_booking_record() does that when it
-- actually books, which is the moment a cost exists.
-- ----------------------------------------------------------------------------
create or replace function te_booking_request(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  t      te_trips;
  pt     te_trip_points;
  b      te_bookings;
  v_seq  int  := nullif(p->>'point_seq', '')::int;
  v_leg  uuid := nullif(p->>'leg_id', '')::uuid;
  v_amt  numeric := nullif(p->>'amount', '')::numeric;
  v_det  jsonb := coalesce(p->'details', '{}'::jsonb);
begin
  select * into t from te_trips where id = (p->>'trip_id')::uuid for update;
  if not found then
    perform te_fail('TE_BOOKING', 'Trip not found.');
  end if;

  -- Your own trip. A stay is asked for by the person travelling; the desk has
  -- te_booking_record() and does not come through here.
  if t.employee_id <> p_actor then
    perform te_fail('TE_FORBIDDEN', 'You can only ask for a stay on your own trip.');
  end if;

  -- The STORED statuses only (144): DRAFT, PENDING_APPROVAL, SENT_BACK,
  -- APPROVED, CLAIMED, CLOSED, CANCELLED, REJECTED. ONGOING and COMPLETED are
  -- worked out from the legs and dates by te_trip_status() and are never in
  -- this column, so testing for them here would silently never match — which
  -- is what the first version of this did.
  if t.status in ('CANCELLED', 'REJECTED', 'CLOSED', 'CLAIMED') then
    perform te_fail('TE_BOOKING', 'This trip is ' || lower(t.status) || '. There is nothing left to book for it.');
  end if;

  if coalesce(btrim(p->>'vendor'), '') = '' then
    perform te_fail('TE_BOOKING', 'Enter the name of the hotel.');
  end if;
  if v_amt is null or v_amt <= 0 then
    perform te_fail('TE_BOOKING', 'Enter what you expect the stay to cost.');
  end if;

  -- Which stop it is for. A stay belongs to a place on the route, not a leg,
  -- but leg_id is accepted so the shape matches te_booking_record().
  if v_seq is not null then
    select * into pt from te_trip_points where trip_id = t.id and seq = v_seq;
    if pt.id is null then
      perform te_fail('TE_BOOKING', 'That stop is not on this trip.');
    end if;
  end if;

  -- Asking twice for the same stop is a mistake, not a second stay. An already
  -- cancelled or booked one does not stand in the way of a fresh request.
  if exists (
    select 1 from te_bookings x
     where x.trip_id = t.id
       and x.kind = 'hotel'
       and x.status = 'REQUESTED'
       and coalesce(x.point_seq, -1) = coalesce(v_seq, -1)
  ) then
    perform te_fail('TE_BOOKING', 'You have already asked for a stay here. Change that request instead.');
  end if;

  insert into te_bookings (
    company_id, booking_no, trip_id, leg_id, point_seq, kind,
    vendor, reference, amount, paid_by, status, ticket_url,
    details, requested_by, requested_at
  ) values (
    t.company_id, te_next_no(t.company_id, 'booking'), t.id, v_leg,
    v_seq, 'hotel',
    btrim(p->>'vendor'), null, v_amt, 'company', 'REQUESTED',
    nullif(btrim(p->>'ticket_url'), ''),
    v_det, p_actor, now()
  ) returning * into b;

  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'STAY_REQUESTED', p_actor,
                 'Asked the Travel Desk to book ' || b.vendor ||
                 ' for about ' || te_rs(b.amount) ||
                 case when b.ticket_url is null then '' else '. Link attached.' end);

  return jsonb_build_object(
    'booking_id', b.id,
    'booking_no', b.booking_no,
    'status', b.status
  );
end;
$$;
