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


-- ============================================================================
-- READING A REQUESTED STAY BACK
--
-- The write path above is useless on its own: te_trip_detail carried no
-- `details`, and te_claim_detail carried no bookings AT ALL — so a stay the
-- employee asked for, and the page they found it on, were invisible to the
-- person approving the money.
--
-- Both functions are reproduced in full below because CREATE OR REPLACE has
-- to be. They were taken from 148 verbatim and diffed against it; the only
-- differences are the three keys added to the trip's bookings JSON and the
-- whole bookings key added to the claim's. Nothing else in either moved.
--
-- `ticket` was ALREADY in te_trip_detail and needed no change. It holds the
-- booking page either way: an e-ticket when the desk books, the MakeMyTrip
-- (or other) link when the employee asks.
-- ============================================================================

create or replace function te_trip_detail(p_trip_id uuid, p_actor uuid, p_admin boolean default false)
returns jsonb language plpgsql stable as $$
declare
  t       te_trips;
  v_staff boolean;
begin
  select * into t from te_trips where id = p_trip_id;
  if not found or not (coalesce(p_admin, false) or te_can_view('trip', p_trip_id, p_actor)) then
    perform te_fail('TE_FORBIDDEN', 'You cannot open this trip.');
  end if;
  v_staff := coalesce(p_admin, false) or p_actor = any (te_finance_members(t.company_id));
  return jsonb_build_object(
    'trip', te_trip_json(t),
    'employee', te_emp_json(t.employee_id),
    'places', (select coalesce(jsonb_object_agg(p.id::text, jsonb_build_object(
                 's', p.short_name, 'name', coalesce(p.name, p.short_name), 'addr', p.address, 'city', p.city,
                 'country', p.country, 'pt', p.place_type, 'lat', p.lat, 'lng', p.lng)), '{}'::jsonb)
                 from te_places p
                where p.id in (select place_id from te_trip_points where trip_id = t.id
                               union select from_place_id from te_legs where trip_id = t.id
                               union select to_place_id from te_legs where trip_id = t.id)),
    'legs', (select coalesce(jsonb_agg(te_leg_json(l, false) || jsonb_build_object('history', te_timeline('leg', l.id, v_staff)) order by l.leg_no), '[]'::jsonb)
               from te_legs l where l.trip_id = t.id),
    'expenses', (select coalesce(jsonb_agg(te_expense_json(x) order by x.expense_date, x.expense_no), '[]'::jsonb)
                   from te_expenses x where x.trip_id = t.id and x.status <> 'DISCARDED'),
    'claims', (select coalesce(jsonb_agg(te_claim_json(c, not v_staff and p_actor = c.employee_id) order by c.claim_seq), '[]'::jsonb) from te_claims c where c.trip_id = t.id),
    'advance', (select jsonb_build_object('id', a.id, 'no', a.advance_no, 'requested', a.requested_amount, 'approved', a.approved_amount,
                                          'outstanding', a.outstanding_amount, 'status', a.status, 'display', te_advance_status(a.id),
                                          'due', a.due_date, 'ref', coalesce(a.payment_ref, ''))
                  from te_advances a where a.trip_id = t.id and a.status not in ('REJECTED','CANCELLED') limit 1),
    -- `details` and `requestedAt` are what a REQUESTED stay carries: the hotel
    -- the employee found, and when they asked. `paidBy` says whether the
    -- company is buying it. `ticket` was already here and holds the booking
    -- page — an e-ticket on a desk booking, the platform link on a request.
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'no', b.booking_no, 'legId', b.leg_id, 'pointIdx', b.point_seq,
                                 'kind', b.kind, 'vendor', b.vendor, 'pnr', b.reference, 'amount', b.amount, 'status', b.status,
                                 'ticket', b.ticket_url, 'at', b.booked_at,
                                 'paidBy', b.paid_by, 'details', coalesce(b.details, '{}'::jsonb),
                                 'requestedAt', b.requested_at) order by b.booked_at), '[]'::jsonb)
                   from te_bookings b where b.trip_id = t.id),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('who', m.author_id, 'name', te_emp_name(m.author_id), 'text', m.body, 'at', m.created_at)
                                           order by m.created_at), '[]'::jsonb)
                   from te_messages m where m.entity_type = 'trip' and m.entity_id = t.id),
    'timeline', te_timeline('trip', t.id, v_staff),
    'policy', t.policy_snapshot,
    'can', jsonb_build_object(
       'act', te_step_block_reason(te_current_step('trip', t.id), p_actor) = '' and t.status = 'PENDING_APPROVAL' and p_actor <> t.employee_id,
       'why', case when t.status = 'PENDING_APPROVAL' then te_step_block_reason(te_current_step('trip', t.id), p_actor) else '' end,
       'own', p_actor = t.employee_id)
  );
end;
$$;

create or replace function te_claim_detail(p_claim_id uuid, p_actor uuid, p_admin boolean default false)
returns jsonb language plpgsql stable as $$
declare
  c       te_claims;
  t       te_trips;
  st      te_approval_steps;
  v_staff boolean;
  v_why   text := '';
begin
  select * into c from te_claims where id = p_claim_id;
  if not found or not (coalesce(p_admin, false) or te_can_view('claim', p_claim_id, p_actor)) then
    perform te_fail('TE_FORBIDDEN', 'You cannot open this claim.');
  end if;
  v_staff := coalesce(p_admin, false) or p_actor = any (te_finance_members(c.company_id));
  select * into t from te_trips where id = c.trip_id;
  if c.status in ('IN_APPROVAL','IN_VERIFICATION','ON_HOLD') then
    st := te_current_step('claim', c.id, case when c.status = 'IN_APPROVAL' then 'manager' else 'finance' end);
    v_why := case when p_actor = c.employee_id then 'Nobody acts on their own claim.' else te_step_block_reason(st, p_actor) end;
  end if;
  return jsonb_build_object(
    'claim', te_claim_json(c, p_actor = c.employee_id and not coalesce(p_admin, false)),
    'employee', te_emp_json(c.employee_id),
    'trip', case when t.id is not null then te_trip_json(t) end,
    -- The stays and tickets of the claim's trip. The claim desk had no way to
    -- see them: te_claim_detail carried the trip, the lines and the legs, but
    -- never the bookings — so a stay the employee asked for, and the page they
    -- found it on, were invisible to the person approving the money.
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'no', b.booking_no, 'legId', b.leg_id, 'pointIdx', b.point_seq,
                                 'kind', b.kind, 'vendor', b.vendor, 'pnr', b.reference, 'amount', b.amount, 'status', b.status,
                                 'ticket', b.ticket_url, 'at', b.booked_at,
                                 'paidBy', b.paid_by, 'details', coalesce(b.details, '{}'::jsonb),
                                 'requestedAt', b.requested_at) order by b.booked_at), '[]'::jsonb)
                   from te_bookings b where t.id is not null and b.trip_id = t.id),
    'lines', (select coalesce(jsonb_agg(te_expense_json(x) order by x.expense_date, x.expense_no), '[]'::jsonb)
                from te_expenses x where x.claim_id = c.id or (c.trip_id is not null and x.trip_id = c.trip_id and x.paid_by = 'company')),
    'legs', case when t.id is not null then
              (select coalesce(jsonb_agg(te_leg_json(l, false) order by l.leg_no), '[]'::jsonb) from te_legs l where l.trip_id = t.id)
            else '[]'::jsonb end,
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('line', d.expense_id, 'by', d.decided_by, 'name', te_emp_name(d.decided_by),
                                  'decision', d.decision, 'before', d.amount_before, 'after', d.amount_after, 'reason', d.reason, 'at', d.created_at)
                                  order by d.created_at), '[]'::jsonb)
                    from te_line_decisions d where d.claim_id = c.id),
    'advance', (select jsonb_build_object('id', a.id, 'no', a.advance_no, 'approved', a.approved_amount, 'outstanding', a.outstanding_amount,
                                          'status', a.status, 'due', a.due_date)
                  from te_advances a where a.trip_id = c.trip_id and a.status not in ('REJECTED','CANCELLED') limit 1),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('who', m.author_id, 'name', te_emp_name(m.author_id), 'text', m.body, 'at', m.created_at)
                                           order by m.created_at), '[]'::jsonb)
                   from te_messages m where m.entity_type = 'claim' and m.entity_id = c.id),
    'timeline', te_timeline('claim', c.id, v_staff),
    'can', jsonb_build_object(
       'act', st.id is not null and v_why = '', 'why', v_why, 'stage', st.stage, 'role', st.role_label,
       'own', p_actor = c.employee_id, 'staff', v_staff)
  );
end;
$$;

notify pgrst, 'reload schema';
