-- 177_te_desk_sees_travel_early.sql — the desk sees a trip when it is raised,
-- not when it is approved.
-- SAFE TO RUN TWICE. Replaces one view and adds one; no data is touched.
-- ----------------------------------------------------------------------------
-- WHY. A travel desk needs lead time. The module already says so out loud:
-- migration 169 refuses a domestic or international plan that leaves inside the
-- notice period, because "the tickets will not be available on an instant basis,
-- it at least needs 3 days for travel desk and finance desk to confirm and book
-- ticket". But the desk could not SEE a trip until every approver had finished
-- with it, so the lead time it was promised was whatever was left over.
--
-- v_te_to_book required t.status = 'APPROVED'. It now accepts a trip that is
-- waiting (PENDING_APPROVAL) or has been sent back for a change (SENT_BACK)
-- as well, and carries t.status so the screen can tell them apart.
--
-- SEEING IS NOT BOOKING, AND THAT LINE IS NOT MOVED HERE. te_booking_record
-- still refuses anything that is not APPROVED -- "Only an approved trip can be
-- booked" -- so the desk can check fares and hold options on a waiting trip but
-- cannot commit company money to one. If an approver then rejects it, nothing
-- has been bought. The screen shows the reason in place of the Record button,
-- rather than offering a button that the floor underneath will refuse.
--
-- WHAT WAS NOT WRONG. Approval already reached the desk correctly: on this data
-- an approved trip with unbooked desk legs appears within the same request. Two
-- things make a desk look empty and neither was a fault --
--   · the desk is per company, so another company's trip is never in it;
--   · a trip where the traveller books every leg themselves has nothing for the
--     desk to book, so the work list is rightly silent about it.
-- The second is what v_te_desk_watch below is for.
--
-- DRAFT IS DELIBERATELY NOT INCLUDED. A DRAFT trip here is a past trip recorded
-- after travel (te_trip_save leaves POST_FACTO trips in DRAFT); there is nothing
-- left to book on a journey that already happened.
-- ============================================================================

-- CREATE OR REPLACE cannot add a column anywhere but the end of a view's column
-- list, and trip_status belongs beside the trip it describes rather than tacked
-- on after the preferences. So the view is dropped and rebuilt. Nothing in SQL
-- depends on it -- the API reads it directly -- so there is nothing to cascade,
-- and a plain DROP rather than DROP ... CASCADE will say so if that ever changes.
drop view if exists v_te_to_book;

create view v_te_to_book as
select t.company_id, t.id as trip_id, t.trip_no, t.name as trip_name, t.employee_id,
       -- WHAT THE APPROVAL IS DOING, carried to the desk so the screen can say
       -- "waiting for approval" and withhold the Record button rather than
       -- offering one that te_booking_record will refuse.
       t.status as trip_status,
       'leg'::text as kind, l.id as leg_id, null::int as point_seq, l.leg_date as on_date, l.mode,
       pf.short_name as from_name, pt.short_name as to_name,
       -- WHAT THE TRAVELLER ASKED FOR, beside the leg it is about. Without
       -- it the desk has the route and the date and has to write to the
       -- traveller to find out which flight they actually want.
       to_char(sg.pref_time, 'HH24:MI') as pref_time, sg.pref_url, sg.pref_note
  from te_trips t
  join te_legs l on l.trip_id = t.id and l.booked_by = 'desk' and l.status = 'PLANNED'
  join te_places pf on pf.id = l.from_place_id
  join te_places pt on pt.id = l.to_place_id
  -- left: a leg added during the trip has no segment behind it.
  left join te_trip_segments sg on sg.trip_id = t.id and sg.seq = l.segment_seq
 where t.status in ('PENDING_APPROVAL', 'SENT_BACK', 'APPROVED')
   and te_today(t.company_id) <= t.end_date
   and not exists (select 1 from te_bookings b where b.leg_id = l.id and b.status <> 'CANCELLED')
union all
select t.company_id, t.id, t.trip_no, t.name, t.employee_id, t.status,
       'hotel', null::uuid, p.seq, p.arrive_on, null::text, null::text, pl.short_name,
       null::text, null::text, null::text
  from te_trips t
  join te_trip_points p on p.trip_id = t.id and p.seq > 0 and not p.is_return
                       and p.arrive_on is not null and coalesce(p.leave_on, p.arrive_on) > p.arrive_on
  join te_places pl on pl.id = p.place_id
 where t.status in ('PENDING_APPROVAL', 'SENT_BACK', 'APPROVED')
   and t.stay_by = 'desk' and te_today(t.company_id) <= t.end_date
   and not exists (select 1 from te_bookings b where b.trip_id = t.id and b.point_seq = p.seq and b.status <> 'CANCELLED');


-- ── for information: travel the desk is NOT booking ─────────────────────────
-- Trips that are happening and have nothing for the desk to do, because the
-- traveller is booking every leg themselves and did not ask for a hotel. The
-- desk asked to see these, to know what is moving in its company.
--
-- KEPT OUT OF v_te_to_book ON PURPOSE. A work list has to be work. On this data
-- two of six approved trips have no desk-booked leg, and putting every local cab
-- trip into the booking queue would bury the tickets that somebody is waiting
-- for. One row per trip here, not one per leg: there is nothing to act on, so
-- there is nothing to act on per leg.
create or replace view v_te_desk_watch as
select t.company_id, t.id as trip_id, t.trip_no, t.name as trip_name, t.employee_id,
       t.scope, t.status as trip_status, t.start_date, t.end_date,
       t.stay_wanted, t.stay_by,
       (select count(*) from te_legs l where l.trip_id = t.id) as leg_count
  from te_trips t
 where t.status in ('PENDING_APPROVAL', 'SENT_BACK', 'APPROVED')
   and te_today(t.company_id) <= t.end_date
   -- Nothing for the desk to book: no leg marked for it, and no hotel asked of
   -- it. Either of those puts the trip in v_te_to_book instead, and a trip must
   -- not sit in both lists.
   and not exists (select 1 from te_legs l where l.trip_id = t.id and l.booked_by = 'desk')
   and coalesce(t.stay_by, 'self') <> 'desk';

comment on view v_te_desk_watch is
  'Trips the travel desk is not booking anything for, shown for information only. One row per trip.';

-- ── locked down, because a rebuilt view does not keep its grants ─────────────
-- 151_te_lockdown.sql revoked the browser keys from every v_te_ view that
-- existed when it ran. Dropping v_te_to_book above threw its grants away with
-- it, and v_te_desk_watch never had any -- so without this block both would
-- fall back to whatever the database hands a brand new view, which is how a
-- travel desk's work list could end up readable with the key that ships in the
-- browser. Re-running 151 would also fix it; not depending on that is cheaper
-- than finding out.
do $$
declare
  v text;
begin
  for v in select unnest(array['v_te_to_book', 'v_te_desk_watch']) loop
    execute format('revoke all on table %I from public', v);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', v);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', v);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant select on table %I to service_role', v);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
