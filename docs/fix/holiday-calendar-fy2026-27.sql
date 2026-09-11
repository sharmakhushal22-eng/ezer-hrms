-- =====================================================================
-- holiday-calendar-fy2026-27.sql — fill in the FY 2026-27 holidays
--
-- FOR: Nayan Ahuja. A DATA change. No schema is touched.
--
-- READ "CONFIRM THESE DATES" IN PART 2 BEFORE RUNNING. Six of the ten
-- dates are lunar and I cannot verify them from here.
--
-- WHY THIS IS NEEDED
--
-- The "Next holiday" card on the ESS Home tab is blank for everybody, and
-- the hero's "Next holiday" line with it. Nothing is wrong with the tab:
-- holiday_entries contains exactly TWO rows and both are 15 August 2026,
-- which is in the past. The rest of the financial year was never entered.
--
-- THE TWO ROWS ARE NOT DUPLICATES, WHICH IS THE TRAP
--
-- They look like one typo and one correction. They are not — they carry
-- DIFFERENT applicability, and only one of them is the group-wide entry:
--
--   c821259b…  "Independace Day"   is_optional = TRUE
--              -> holiday_applicability: all THREE companies, branch NULL
--
--   4b66e19b…  "Independence Day"  is_optional = FALSE
--              -> holiday_applicability: SSM only, Gurugram Branch only
--
-- So the misspelt row is the one that actually covers the group, and the
-- correctly spelled one covers a single branch of a single company.
-- Deleting the typo — the obvious fix — cascades its three applicability
-- rows away (ON DELETE CASCADE) and leaves Independence Day applying to
-- one branch of one company. A national holiday would silently vanish for
-- most of the group.
--
-- This script therefore REPAIRS the group-wide row in place and removes
-- the narrow one. If that Gurugram-only row was deliberate — some local
-- arrangement I do not know about — do the opposite instead: skip Part 1
-- and just correct the spelling on c821259b.
--
-- WHAT THE ESS CARD READS  (migration 114)
--
--   select ... from holiday_entries
--    where holiday_date >= current_date
--      and coalesce(is_optional, false) = false
--    order by holiday_date limit 1
--
-- Worth knowing before you edit anything:
--   • It does NOT join company_calendar_map or holiday_applicability. All
--     three companies currently point at this one calendar, so that is
--     harmless today — but the moment a second calendar exists, or a
--     holiday applies to one company only, the ESS card will show it to
--     everybody. Flagging it; fixing it is a change to 114, not to data.
--   • The calendar's status is NOT filtered. Yours is DRAFT and the card
--     will work anyway. Publishing it is an HR decision, not a
--     prerequisite.
--   • Optional (restricted) holidays never appear, deliberately — a
--     restricted holiday is not a day the office is shut. Note this is
--     why the card is blank even for dates that ARE in the table.
--
-- THERE IS NO SCREEN FOR THIS. Nothing in the app writes holiday_entries,
-- so this file is the only way in until someone builds the admin UI.
--
-- SAFE TO RUN TWICE. Every step is guarded or keyed on an id.
-- =====================================================================

-- ── Part 1 — make 15 August one correct, group-wide holiday ──────────
do $$
declare
  v_group  uuid := 'c821259b-c988-4415-8baf-8dacb6de52ac';  -- misspelt, applies to all 3
  v_narrow uuid := '4b66e19b-683c-49a1-887f-0304dbe79cfa';  -- spelt right, SSM/Gurugram only
  v_appl   int;
begin
  -- Refuse to run if the shape is not what this script was written against.
  if not exists (select 1 from holiday_entries where id = v_group) then
    raise notice 'Group-wide row is already gone — Part 1 has run before. Skipping.';
    return;
  end if;

  select count(*) into v_appl
    from holiday_applicability where holiday_id = v_group;
  if v_appl < 3 then
    raise exception 'Expected the group-wide row to cover 3 companies, found %. '
                    'Something changed since this was written — stopping.', v_appl;
  end if;

  -- Repair in place. Its applicability rows are the ones worth keeping, so
  -- the row must survive; only the text and the optional flag were wrong.
  -- 15 Aug 2026 is a Saturday; on_weekly_off is left alone because whether
  -- Saturday is a weekly off here is a working-days question, not mine.
  update holiday_entries
     set description  = 'Independence Day',
         holiday_type = 'NATIONAL',
         is_optional  = false
   where id = v_group;
  raise notice 'Corrected the group-wide 15 August row.';

  -- Now the narrow one is redundant. Its single applicability row goes with
  -- it by cascade, which is correct — it described only itself.
  delete from holiday_entries where id = v_narrow;
  if found then raise notice 'Removed the Gurugram-only duplicate.'; end if;
end $$;


-- ── Part 2 — the rest of FY 2026-27 ──────────────────────────────────
--
-- CONFIRM THESE DATES BEFORE RUNNING.
--
-- FIXED dates are calendar dates and are certain. LUNAR dates move every
-- year with the Hindu calendar; I have taken them from general knowledge,
-- not from your official list. They can be a day out and they vary by
-- region — Gurugram and Pune will not necessarily observe the same set.
--
-- A wrong Diwali is worse than a missing one: this table drives leave
-- planning and, once payroll reads it, holiday pay. Check every LUNAR row
-- against the almanac HR publishes, and delete any the group does not
-- observe.
--
-- NOT INCLUDED, on purpose:
--   • Regional days (Gudi Padwa, Maharashtra Day). The schema supports
--     these properly — holiday_applicability takes a branch_id, so one
--     holiday can apply to Pune and not Gurugram. Add them that way rather
--     than as duplicate rows on one date; the 15 August mess above is what
--     duplicate-per-scope looks like six months later.
--   • Restricted / optional days. Insert with is_optional = true and they
--     stay out of the ESS card, which is the intent.
--   • Anything before today. Past dates cannot affect "next holiday".
--
-- Applicability is written for all three companies with branch_id NULL —
-- the same shape the working 15 August row has.
with target as (
  select id from holiday_calendar
   where id = '9b469f8e-b0da-4d6d-9983-ff8b4334c683'          -- FY 2026-27
),
wanted (d, label, htype, weekly_off) as (values
  -- date          label                       type         on a weekly off?   -- basis
  ('2026-10-02', 'Gandhi Jayanti',           'NATIONAL', false),   -- FIXED    Friday
  ('2026-10-20', 'Dussehra (Vijayadashami)', 'FESTIVAL', false),   -- LUNAR    Tuesday
  ('2026-11-08', 'Diwali (Deepavali)',       'FESTIVAL', true ),   -- LUNAR    SUNDAY
  ('2026-11-09', 'Govardhan Puja',           'FESTIVAL', false),   -- LUNAR    Monday
  ('2026-11-10', 'Bhai Dooj',                'FESTIVAL', false),   -- LUNAR    Tuesday
  ('2026-11-24', 'Guru Nanak Jayanti',       'FESTIVAL', false),   -- LUNAR    Tuesday
  ('2026-12-25', 'Christmas Day',            'FESTIVAL', false),   -- FIXED    Friday
  ('2027-01-26', 'Republic Day',             'NATIONAL', false),   -- FIXED    Tuesday
  ('2027-03-22', 'Holi',                     'FESTIVAL', false),   -- LUNAR    Monday
  ('2027-03-26', 'Good Friday',              'FESTIVAL', false)    -- COMPUTED Friday
),
inserted as (
  insert into holiday_entries
         (calendar_id, holiday_date, description, holiday_type, is_optional, on_weekly_off)
  select t.id, w.d::date, w.label, w.htype, false, w.weekly_off
    from target t cross join wanted w
   where not exists (                                          -- idempotent
     select 1 from holiday_entries e
      where e.calendar_id = t.id and e.holiday_date = w.d::date)
  returning id
)
insert into holiday_applicability (holiday_id, company_id, branch_id)
select i.id, c.id, null::uuid            -- typed: an untyped NULL here can
  from inserted i cross join companies c;  -- infer as text and trip 42804


-- ── Read it back ─────────────────────────────────────────────────────
-- Expect: 15 August appearing ONCE, spelt correctly, not optional; every
-- new date carrying 3 applicability rows; and the arrow on whichever row
-- the ESS Home card will show.
select h.holiday_date,
       to_char(h.holiday_date, 'Dy')                 as day,
       h.description,
       h.holiday_type,
       h.is_optional,
       h.on_weekly_off,
       (select count(*) from holiday_applicability a
         where a.holiday_id = h.id)                  as companies,
       case when h.holiday_date = (select min(x.holiday_date)
                                     from holiday_entries x
                                    where x.holiday_date >= current_date
                                      and not coalesce(x.is_optional, false))
            then '  <-- ESS Home shows this' end     as note
  from holiday_entries h
 where h.calendar_id = '9b469f8e-b0da-4d6d-9983-ff8b4334c683'
 order by h.holiday_date;

-- Two dates on one calendar — should return nothing.
select holiday_date, count(*), string_agg(description, ' | ')
  from holiday_entries
 group by calendar_id, holiday_date
having count(*) > 1;

-- Holidays nobody is mapped to — should return nothing.
select h.holiday_date, h.description
  from holiday_entries h
 where not exists (select 1 from holiday_applicability a where a.holiday_id = h.id);
