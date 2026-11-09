-- 182_te_numbers_are_unique.sql -- a trip number identifies one trip.
-- SAFE TO RUN TWICE. Replaces one function, adds six partial unique indexes.
-- Changes no existing row.
-- ----------------------------------------------------------------------------
-- WHAT WAS WRONG. Every number this module issues restarted at 1 for each
-- company, because te_sequences is keyed on (company_id, kind, year). On this
-- data that had already happened:
--
--   TRP-2026-0001    Sharma Retail Solutions  AND  Sharma Trading Corporation
--   TRP-2026-0002    both again
--   TRP-2026-0007    both again
--   CLM-2026-000001  both
--   EXP-00001 .. EXP-00005  both
--   ADV-0001, BKG-0001, BKG-0002  both
--
-- So "the trip number is the identity of a trip" was not true: searching one
-- found two trips, and a number quoted in an email meant nothing without also
-- saying which company. Every screen had to carry company_id alongside, and any
-- that forgot was wrong in a way nobody would notice until two companies
-- disagreed about whose ticket had been booked.
--
-- WHAT IT IS NOW. The company's own code goes in front:
--
--   SRS-TRP-2026-0001        Sharma Retail Solutions
--   STC-TRP-2026-0001        Sharma Trading Corporation
--
-- companies.company_code already exists (SRS, SSM, STC) and is what employee
-- codes are built from -- SRS9010 is a Sharma Retail employee -- so a trip
-- number now reads in the same hand as the people on it. No new column, no
-- second source of truth about what a company is called.
--
-- WHY NOT ONE SEQUENCE FOR EVERYTHING. A single global counter would also be
-- unique, and would leak: a company could read its own gaps and infer how much
-- the others travel. Each company keeps its own tidy 1, 2, 3, and the prefix
-- does the separating.
--
-- HISTORY IS LEFT EXACTLY AS IT IS. The thirteen trips, two claims, eleven
-- expense lines and the rest keep the numbers they were issued, collisions
-- included. A number somebody has already quoted in an email, filed against a
-- claim or written into the audit log does not change underneath them. That is
-- why the indexes below are PARTIAL: they cover prefixed numbers only.
--
--   where trip_no ~ '^[A-Z0-9]{2,6}-TRP-'
--
-- An old number is 'TRP-2026-0001' and does not match; a new one is
-- 'SRS-TRP-2026-0001' and does. So everything issued from here is unique and
-- nothing issued before is touched. The index is not really guarding against
-- two companies -- their prefixes differ, so they cannot collide -- it guards
-- against te_sequences being reset or te_next_no being changed back. It makes
-- the guarantee structural instead of a thing the generator promises.
--
-- A COMPANY WITH NO CODE GETS NO NUMBER, loudly. Falling back to an unprefixed
-- number would reintroduce the collision for exactly the one company somebody
-- forgot to set up, which is the hardest kind to find afterwards.
-- ============================================================================

create or replace function te_next_no(p_company_id uuid, p_kind text)
returns text language plpgsql as $$
declare
  v_year int := extract(year from te_today(p_company_id))::int;
  v_key  int := case when p_kind in ('trip','claim') then v_year else 0 end;
  v_no   bigint;
  v_code text;
begin
  -- THE COMPANY'S OWN CODE, which is what makes the number unique across the
  -- whole system rather than only inside one company. companies.company_code
  -- already exists and is what employee codes are built from (SRS9010), so a
  -- trip number now reads in the same hand as the people on it.
  --
  -- NO CODE, NO NUMBER. Falling back to an unprefixed number would quietly
  -- reintroduce exactly the collision this exists to stop, and it would do it
  -- only for the one company somebody forgot to set up -- which is the hardest
  -- kind of bug to find later.
  select nullif(btrim(c.company_code), '') into v_code from companies c where c.id = p_company_id;
  if v_code is null then
    perform te_fail('TE_NOT_SET_UP',
      'This company has no company code, so travel numbers cannot be issued. Set it in the company profile.');
  end if;

  insert into te_sequences (company_id, kind, year, last_no)
  values (p_company_id, p_kind, v_key, 1)
  on conflict (company_id, kind, year) do update set last_no = te_sequences.last_no + 1
  returning last_no into v_no;

  -- lpad() cuts a longer number short (lpad('10000', 4, '0') is '1000'), so a
  -- number that has outgrown its padding is written out in full: trip 10,000
  -- is TRP-2026-10000
  -- The prefix goes on once, here, rather than six times below: a seventh kind
  -- added later gets it without anybody having to remember.
  return v_code || '-' || case p_kind
    when 'trip'    then 'TRP-' || v_year || '-' || case when v_no < 10000   then lpad(v_no::text, 4, '0') else v_no::text end
    when 'claim'   then 'CLM-' || v_year || '-' || case when v_no < 1000000 then lpad(v_no::text, 6, '0') else v_no::text end
    when 'advance' then 'ADV-' || case when v_no < 10000  then lpad(v_no::text, 4, '0') else v_no::text end
    when 'expense' then 'EXP-' || case when v_no < 100000 then lpad(v_no::text, 5, '0') else v_no::text end
    when 'booking' then 'BKG-' || case when v_no < 10000  then lpad(v_no::text, 4, '0') else v_no::text end
    when 'batch'   then 'PAY-' || case when v_no < 10000  then lpad(v_no::text, 4, '0') else v_no::text end
  end;
end;
$$;

-- ── the guarantee, made structural ──────────────────────────────────────────
-- Partial, so the numbers already issued keep theirs. See the header.
create unique index if not exists uq_te_trips_no_unique
  on te_trips (trip_no)        where trip_no    ~ '^[A-Z0-9]{2,6}-TRP-';
create unique index if not exists uq_te_claims_no_unique
  on te_claims (claim_no)      where claim_no   ~ '^[A-Z0-9]{2,6}-CLM-';
create unique index if not exists uq_te_bookings_no_unique
  on te_bookings (booking_no)  where booking_no ~ '^[A-Z0-9]{2,6}-BKG-';
create unique index if not exists uq_te_expenses_no_unique
  on te_expenses (expense_no)  where expense_no ~ '^[A-Z0-9]{2,6}-EXP-';
create unique index if not exists uq_te_advances_no_unique
  on te_advances (advance_no)  where advance_no ~ '^[A-Z0-9]{2,6}-ADV-';
create unique index if not exists uq_te_batches_no_unique
  on te_payout_batches (batch_no) where batch_no ~ '^[A-Z0-9]{2,6}-PAY-';

comment on index uq_te_trips_no_unique is
  'A trip number identifies exactly one trip. Partial on purpose: numbers issued before 182 were per-company and are left as they are.';

notify pgrst, 'reload schema';
