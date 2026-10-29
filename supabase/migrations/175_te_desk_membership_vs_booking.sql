-- 175_te_desk_membership_vs_booking.sql — "May book" means what it says.
-- SAFE TO RUN TWICE. Replaces four functions and adds one; no data is touched.
-- ----------------------------------------------------------------------------
-- WHAT WAS WRONG. travel_desk.can_book is shown on the admin screen as a
-- checkbox labelled "May book" (components/te/admin/TeDesks.tsx). It did the
-- opposite of its label, in both directions:
--
--   unticking it  removed that person from the travel desk ENTIRELY. te_on_desk
--                 and te_desk_members both required can_book, so they lost the
--                 desk tab, the work list, and the stay decisions in 164 — all
--                 the desk work that has nothing to do with spending money.
--
--   ticking it    bought nothing at booking time. No route and no function
--                 consulted can_book: POST /api/te/bookings asks only for the
--                 dashboard Travel Claims (edit) permission, so a desk member
--                 with the box unticked could still record and cancel bookings.
--
-- Measured on this data: 5 of the 13 people on Sharma Retail's travel desk —
-- the DESK-role rows at grades E1 and E2 — were not "on the desk" at all
-- according to te_on_desk. Migration 174 put them there and set can_book from
-- grade, which is what made the inversion visible at scale.
--
-- WHAT IT MEANS NOW, which is what the label says:
--   on the desk   every active member, can_book or not. They see the work list,
--                 verify vehicles, decide stays.
--   may book      can_book only, enforced in the two functions that commit
--                 money — te_booking_record and te_booking_cancel.
--
-- FINANCE IS DELIBERATELY UNTOUCHED. finance_team.can_approve has the same
-- shape and the same question hanging over it, but approval routing reads
-- te_desk_members('finance', ...) in migration 162 — changing who is returned
-- there changes who gets approval steps. That is a separate decision and is
-- not made here. The finance branches of te_desk_members are byte-identical.
--
-- SOMEBODY WHO IS NOT ON THE DESK AT ALL is unaffected: an administrator with
-- Travel Claims access books as before. te_may_book only ever refuses a person
-- who IS on the travel desk and has not been given the right.
-- ============================================================================

-- Mirrors te_on_desk's "anywhere" reading: membership of any company's travel
-- desk is membership, so the right is read the same way. Somebody who is on no
-- travel desk is governed by their dashboard role and is never refused here.
create or replace function te_may_book(p_actor uuid)
returns boolean language sql stable as $$
  select not exists (select 1 from travel_desk d
                      where d.employee_id = p_actor and d.is_active
                        and te_is_employee_active(d.employee_id))
      or exists (select 1 from travel_desk d
                  where d.employee_id = p_actor and d.is_active and d.can_book
                    and te_is_employee_active(d.employee_id));
$$;

comment on function te_may_book is
  'Whether this person may commit company money on the travel desk. True for everybody who is not on that desk at all.';

create or replace function te_on_desk(p_kind text, p_actor uuid)
returns boolean language sql stable as $$
  select case when p_kind = 'finance' then exists (
           select 1 from finance_team f
            where f.employee_id = p_actor and f.is_active and f.can_approve
              and te_is_employee_active(f.employee_id))
         else exists (
           select 1 from travel_desk d
            where d.employee_id = p_actor and d.is_active
              and te_is_employee_active(d.employee_id))
         end;
$$;

create or replace function te_desk_members(p_kind text, p_company uuid, p_location uuid default null)
returns uuid[] language plpgsql stable as $$
declare
  v_out   uuid[] := '{}';
  v_group uuid;
begin
  if p_kind not in ('finance', 'travel') then
    perform te_fail('TE_FORBIDDEN', format('There is no %s desk.', p_kind));
  end if;

  -- 1. THE BRANCH. A member with no location_id answers for every branch, so
  --    they belong to this one too and are counted here rather than in step 2.
  if p_location is not null then
    if p_kind = 'finance' then
      select coalesce(array_agg(f.employee_id order by f.created_at, f.employee_id), '{}') into v_out
        from finance_team f
       where f.company_id = p_company
         and (f.location_id = p_location or f.location_id is null)
         and f.is_active and f.can_approve and te_is_employee_active(f.employee_id);
    else
      select coalesce(array_agg(d.employee_id order by d.created_at, d.employee_id), '{}') into v_out
        from travel_desk d
       where d.company_id = p_company
         and (d.location_id = p_location or d.location_id is null)
         and d.is_active and te_is_employee_active(d.employee_id);
    end if;
    if cardinality(v_out) > 0 then
      return v_out;
    end if;
  end if;

  -- 2. THE COMPANY, any branch. Also the answer when no branch was asked for,
  --    which is what te_finance_members(company) has always meant.
  if p_kind = 'finance' then
    select coalesce(array_agg(f.employee_id order by f.created_at, f.employee_id), '{}') into v_out
      from finance_team f
     where f.company_id = p_company
       and f.is_active and f.can_approve and te_is_employee_active(f.employee_id);
  else
    select coalesce(array_agg(d.employee_id order by d.created_at, d.employee_id), '{}') into v_out
      from travel_desk d
     where d.company_id = p_company
       and d.is_active and te_is_employee_active(d.employee_id);
  end if;
  if cardinality(v_out) > 0 then
    return v_out;
  end if;

  -- 3. THE GROUP. A desk that serves every company in the group, for the case
  --    where one company has no desk of its own at all.
  select c.group_id into v_group from companies c where c.id = p_company;
  if v_group is null then
    return v_out;
  end if;
  if p_kind = 'finance' then
    select coalesce(array_agg(f.employee_id order by f.created_at, f.employee_id), '{}') into v_out
      from finance_team f
      join companies c on c.id = f.company_id
     where c.group_id = v_group and f.is_group_scope
       and f.is_active and f.can_approve and te_is_employee_active(f.employee_id);
  else
    select coalesce(array_agg(d.employee_id order by d.created_at, d.employee_id), '{}') into v_out
      from travel_desk d
      join companies c on c.id = d.company_id
     where c.group_id = v_group and d.is_group_scope
       and d.is_active and te_is_employee_active(d.employee_id);
  end if;
  return v_out;
end;
$$;

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

create or replace function te_booking_cancel(p_booking_id uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql as $$
declare
  b te_bookings;
  t te_trips;
begin
  select * into b from te_bookings where id = p_booking_id for update;
  if not found or b.status = 'CANCELLED' then
    perform te_fail('TE_BOOKING', 'Booking not found.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    perform te_fail('TE_COMMENT', 'Say why the booking is cancelled.');
  end if;
  -- Cancelling commits money as surely as booking does — a cancellation fee,
  -- or a seat released that has to be bought again. Same right.
  if not te_may_book(p_actor) then
    perform te_fail('TE_FORBIDDEN', 'You are on the travel desk but not allowed to book. Ask an administrator to tick "May book" for you.');
  end if;
  if exists (select 1 from te_expenses x where x.booking_id = b.id and x.status <> 'UNCLAIMED') then
    perform te_fail('TE_BOOKING', 'This booking is already part of a claim. Ask Finance to correct it there.');
  end if;
  select * into t from te_trips where id = b.trip_id;
  update te_bookings set status = 'CANCELLED' where id = b.id;
  update te_expenses set status = 'DISCARDED' where booking_id = b.id and status = 'UNCLAIMED';
  perform te_log(t.company_id, 'trip', t.id, t.trip_no, 'BOOKING_CANCELLED', p_actor,
                 'Travel Desk cancelled booking ' || b.booking_no || ' (' || b.vendor || ', ' || b.reference || '): ' || btrim(p_reason) || '.');
  return jsonb_build_object('booking_id', b.id, 'status', 'CANCELLED');
end;
$$;

notify pgrst, 'reload schema';
