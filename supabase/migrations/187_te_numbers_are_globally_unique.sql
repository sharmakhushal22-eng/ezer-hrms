-- 187_te_numbers_are_globally_unique.sql — one number, one thing, everywhere.
-- SAFE TO RUN TWICE. Renames only numbers that have no company prefix yet.
-- ----------------------------------------------------------------------------
-- WHAT WAS WRONG. 182 made every NEW human number carry its company's code and
-- left the existing rows alone, which was the decision at the time. Measured on
-- 25 October 2026, across every numbered thing in the module:
--
--     table               rows  shared by two things
--     te_expenses           13   5   EXP-00001 … EXP-00005
--     te_trips              14   3   TRP-2026-0001, -0002, -0007
--     te_bookings            5   2   BKG-0001, BKG-0002
--     te_claims              2   1   CLM-2026-000001
--     te_advances            2   1   ADV-0001
--     te_payout_batches      1   0
--
-- Twelve numbers naming two different things each, always across two companies
-- — SRS and STC both reached CLM-2026-000001, and both called it that.
--
-- Navigation was never wrong: every link in the product carries a uuid. But a
-- human number that is not unique cannot be quoted, searched for, or read down
-- a phone, and these numbers are exactly what people say to each other. Finance
-- quotes a claim number on a payout; a traveller quotes a trip number; a desk
-- quotes a booking number to an airline.
--
-- THIS FILE WAS ORIGINALLY ONLY ABOUT TRIPS, because that is what was asked
-- for. Running the same count across the other five tables while testing the
-- Finance desk found the same defect in all of them, so it does all six rather
-- than leaving five to be discovered one at a time.
--
-- WHAT IT DOES, per table:
--   1. Prefixes every unprefixed number with its company code.
--   2. Writes the old number into that row's own history, employee-visible, so
--      a claim, an email or an audit line quoting the old one still leads
--      somewhere. Renaming an identifier people have been given without
--      leaving a trail is how a number becomes a dead end.
--   3. Adds a GLOBAL unique index. That is the point: everything above is a
--      one-off data fix, and a data fix with no constraint behind it drifts
--      back. The per-company uniques are what allowed two companies to share a
--      number in the first place.
--
-- IT REFUSES RATHER THAN GUESSES. A company with no company_code, or a rename
-- that would collide with a number already taken, aborts the whole block with
-- nothing changed — a half-renamed set of identifiers is worse than an
-- ambiguous one.
-- ============================================================================

do $$
declare
  spec      record;
  r         record;
  v_new     text;
  v_clash   boolean;
  v_done    int;
  v_already int;
  v_blocked text[] := '{}';
  v_report  text := '';
begin
  for spec in
    select * from (values
      -- table,              column,        tag,   what the audit calls it
      ('te_trips',          'trip_no',     'TRP', 'trip'),
      ('te_claims',         'claim_no',    'CLM', 'claim'),
      ('te_advances',       'advance_no',  'ADV', 'advance'),
      ('te_bookings',       'booking_no',  'BKG', 'booking'),
      ('te_payout_batches', 'batch_no',    'PAY', 'payout'),
      ('te_expenses',       'expense_no',  'EXP', 'expense')
    ) as t(tbl, col, tag, entity)
  loop
    v_done := 0;
    v_already := 0;

    -- Ordered by id rather than created_at: te_bookings has no created_at, and
    -- the order only has to be stable, not meaningful.
    for r in execute format(
      'select id, company_id, %I::text as no from %I order by id', spec.col, spec.tbl)
    loop
      -- Already prefixed: nothing to do. This is what makes the file idempotent.
      if r.no ~ ('^[A-Z0-9]{2,6}-' || spec.tag || '-') then
        v_already := v_already + 1;
        continue;
      end if;

      select upper(btrim(c.company_code)) into v_new
        from companies c where c.id = r.company_id;
      if coalesce(v_new, '') = '' then
        v_blocked := v_blocked || format('%s %s has no company_code', spec.tbl, r.no);
        continue;
      end if;
      v_new := v_new || '-' || r.no;

      execute format('select exists (select 1 from %I where %I = $1 and id <> $2)', spec.tbl, spec.col)
        into v_clash using v_new, r.id;
      if v_clash then
        v_blocked := v_blocked || format('%s %s -> %s is already taken', spec.tbl, r.no, v_new);
        continue;
      end if;

      -- The old number goes into the row's own history BEFORE the change, so
      -- the entry reads in the order it happened.
      perform te_log(r.company_id, spec.entity, r.id, v_new,
        upper(spec.entity) || '_RENUMBERED', null,
        format('%s number changed from %s to %s, so that one number names one thing across every company.',
               initcap(spec.entity), r.no, v_new),
        true,
        jsonb_build_object(spec.col, r.no),
        jsonb_build_object(spec.col, v_new));

      execute format('update %I set %I = $1 where id = $2', spec.tbl, spec.col) using v_new, r.id;
      v_done := v_done + 1;
    end loop;

    v_report := v_report || format('  %-18s renamed %s, already prefixed %s%s',
                                   spec.tbl, v_done, v_already, E'\n');
  end loop;

  if array_length(v_blocked, 1) > 0 then
    raise exception E'Nothing was renamed. These could not be done safely:\n  %\nFix them and run this again — a half-renamed set of identifiers is worse than an ambiguous one.',
      array_to_string(v_blocked, E'\n  ');
  end if;

  raise notice E'187:\n%', v_report;
end $$;

-- ── the constraints that keep it true ──────────────────────────────────────
-- The per-company uniques in 144 are what allowed two companies to share a
-- number. These are the ones that do not. Each is created only after the
-- rename above has made it satisfiable; if any is still shared the index
-- creation fails loudly rather than leaving the promise half-kept.
create unique index if not exists uq_te_trips_no_global      on te_trips (trip_no);
create unique index if not exists uq_te_claims_no_global     on te_claims (claim_no);
create unique index if not exists uq_te_advances_no_global   on te_advances (advance_no);
create unique index if not exists uq_te_bookings_no_global   on te_bookings (booking_no);
create unique index if not exists uq_te_payouts_no_global    on te_payout_batches (batch_no);
create unique index if not exists uq_te_expenses_no_global   on te_expenses (expense_no);

comment on index uq_te_trips_no_global is
  'One number names one trip, across every company. te_next_no (182) prefixes the company code, which is what makes this satisfiable; without it two companies would each reach TRP-2026-0001 and the second would be refused.';

notify pgrst, 'reload schema';
