-- 187_te_trip_no_is_globally_unique.sql — one number, one trip, everywhere.
-- SAFE TO RUN TWICE. Renames only numbers that have no company prefix yet.
-- ----------------------------------------------------------------------------
-- WHAT WAS WRONG. 182 made every NEW trip number carry its company's code and
-- left the existing rows alone, which was the decision at the time. The result,
-- measured on 25 October 2026:
--
--     trips                      14
--     with a company prefix       1
--     bare legacy numbers        13
--     numbers naming TWO trips    3   TRP-2026-0001, -0002 and -0007,
--                                     each existing in both SRS and STC
--
-- So "TRP-2026-0007" named two different trips belonging to two different
-- companies. Navigation was never wrong — every link in the product carries the
-- trip's uuid, not its number — but a human number that is not unique is a
-- human number that cannot be quoted, searched for, or read down a phone, and
-- the number is precisely what people call a trip by.
--
-- WHAT THIS DOES.
--
--   1. Prefixes every unprefixed number with its company code, so
--      TRP-2026-0007 becomes SRS-TRP-2026-0007 or STC-TRP-2026-0007.
--   2. Writes the old number into each trip's own history, employee-visible,
--      so a claim, an email or an audit line that quoted the old number still
--      leads somewhere. Renaming an identifier people have already been given
--      without leaving a trail is how a number becomes a dead end.
--   3. Adds a GLOBAL unique index on trip_no, so this cannot come back. The
--      per-company unique has always been there; it is what allowed two
--      companies to share a number in the first place.
--
-- THE GLOBAL INDEX IS THE POINT. Everything above is a one-off data fix, and a
-- data fix with no constraint behind it is a thing that drifts back. With every
-- number prefixed by a company code the global unique is also automatically
-- satisfiable, so the two halves fit: the prefix makes uniqueness possible and
-- the index makes it compulsory.
--
-- IT REFUSES RATHER THAN GUESSES. A company with no company_code cannot have a
-- prefix built for it, and a rename that would collide with a number already
-- taken is not applied. Either case is reported and the block raises, leaving
-- every row untouched, because a half-renamed set of identifiers is worse than
-- an ambiguous one.
-- ============================================================================

do $$
declare
  r          record;
  v_new      text;
  v_done     int := 0;
  v_already  int := 0;
  v_blocked  text[] := '{}';
  v_report   text := '';
begin
  -- ── 1. the rename ────────────────────────────────────────────────────────
  for r in
    select t.id, t.trip_no, t.company_id, c.company_code
      from te_trips t
      join companies c on c.id = t.company_id
     order by t.created_at
  loop
    -- Already prefixed: nothing to do, and this is what makes the file safe to
    -- run twice.
    if r.trip_no ~ '^[A-Z0-9]{2,6}-TRP-' then
      v_already := v_already + 1;
      continue;
    end if;

    if coalesce(btrim(r.company_code), '') = '' then
      v_blocked := v_blocked || format('%s has no company_code', r.trip_no);
      continue;
    end if;

    v_new := upper(btrim(r.company_code)) || '-' || r.trip_no;

    if exists (select 1 from te_trips x where x.trip_no = v_new and x.id <> r.id) then
      v_blocked := v_blocked || format('%s -> %s is already taken', r.trip_no, v_new);
      continue;
    end if;

    -- The old number goes into the trip's own history BEFORE the change, so the
    -- entry reads in the order it happened.
    perform te_log(r.company_id, 'trip', r.id, v_new, 'TRIP_RENUMBERED', null,
      format('Trip number changed from %s to %s, so that one number names one trip across every company.',
             r.trip_no, v_new),
      true,
      jsonb_build_object('trip_no', r.trip_no),
      jsonb_build_object('trip_no', v_new));

    update te_trips set trip_no = v_new where id = r.id;
    v_done := v_done + 1;
  end loop;

  if array_length(v_blocked, 1) > 0 then
    raise exception E'Nothing was renamed. These rows could not be done safely:\n  %\nFix them and run this again — a half-renamed set of identifiers is worse than an ambiguous one.',
      array_to_string(v_blocked, E'\n  ');
  end if;

  v_report := format('renamed %s, already prefixed %s', v_done, v_already);

  -- ── 2. prove it before trusting it ───────────────────────────────────────
  if exists (select trip_no from te_trips group by trip_no having count(*) > 1) then
    raise exception 'Some trip numbers are still shared by more than one trip, so the global unique cannot be added. %', v_report;
  end if;

  raise notice '187: %', v_report;
end $$;

-- ── 3. the constraint that keeps it true ───────────────────────────────────
-- The per-company unique in 144 is what allowed two companies to share a
-- number. This is the one that does not.
create unique index if not exists uq_te_trips_trip_no_global on te_trips (trip_no);

comment on index uq_te_trips_trip_no_global is
  'One number names one trip, across every company. te_next_no (182) prefixes the company code, which is what makes this satisfiable; without the prefix two companies would each reach TRP-2026-0001 and the second would be refused.';

notify pgrst, 'reload schema';
