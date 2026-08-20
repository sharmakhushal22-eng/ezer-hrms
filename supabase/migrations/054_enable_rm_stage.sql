-- 054_enable_rm_stage.sql
-- EZER HRMS — switch the travel-claim chain to Reporting Manager -> Finance.
--
-- DO NOT RUN THIS YET. It is waiting on a decision from Tushar, not on Nayan.
-- Running it is safe and instantly reversible (see SECTION 4), but it changes
-- who reviews every travel claim filed from that moment on.
--
-- WHY IT IS NOT ALREADY DONE
--
-- Migration 052 made every stage of the chain a flag, so this switch is an
-- UPDATE rather than a migration. 052 also backfilled employees.l1_manager_id
-- from the reporting_manager text column. That backfill could only resolve
-- 28 of 398 employees, verified against the live database on 2026-08-20:
--
--     routed to a manager      28
--     manager named, no row   362
--     no manager named          8
--                             ---
--                             398
--
-- employees.reporting_manager holds 10 distinct names. Only two of them exist
-- as an employee record, and 052 matches within a company (a manager in
-- another company must not approve your claim), so even those two resolve
-- only partly:
--
--     Priya Iyer  (SRS9032)   49 reports by name -> 21 same company -> 21 routed
--     Manoj Bose  (SRS9012)   24 reports by name ->  7 same company ->  7 routed
--
-- The other eight names have no employee row at all:
--
--     Rajesh Khanna  53      Rekha Pillai  38
--     Deepak Nair    49      Sunita Rao    38
--     Vikram Mehta   44      Anjali Sharma 31
--     Neha Kapoor    41      Sanjay Gupta  23
--
-- travel_first_claim_stage() skips a stage with nobody mapped. So flipping the
-- flags today means 370 of 398 employees file a claim that goes STRAIGHT TO
-- FINANCE with no manager review. The current HR Head chain, whatever else is
-- wrong with it, routes all 398 somewhere.
--
-- SO ONE OF THESE HAS TO HAPPEN FIRST
--
--   (a) HR creates the eight missing managers as employee records, in the
--       right company, with full_name matching reporting_manager exactly.
--       Then re-run SECTION 1 below and the gap closes on its own.
--
--   (b) Tushar accepts that 370 employees skip manager review for now, and
--       this runs as-is. Defensible if Finance is reviewing everything
--       anyway — but it should be a decision, not a side effect.
--
-- ---------------------------------------------------------------------------

begin;

-- SECTION 1 — RE-RUN THE BACKFILL
-- Safe to run repeatedly. Only fills rows still null, only on an exact
-- full-name match inside the same company. No fuzzy matching: "Rekha Pillai"
-- against "Rekha Chopra" is a different person, and routing a claim to the
-- wrong approver is worse than leaving it unrouted.

do $$
declare v_matched int; v_left int;
begin
  update employees e
     set l1_manager_id = m.id
    from employees m
   where e.l1_manager_id is null
     and e.reporting_manager is not null
     and lower(trim(e.reporting_manager)) = lower(trim(m.full_name))
     and m.id <> e.id
     and m.company_id = e.company_id;

  get diagnostics v_matched = row_count;
  select count(*) into v_left from employees where l1_manager_id is null;
  raise notice 'newly routed: %   still unrouted: %', v_matched, v_left;
end $$;


-- SECTION 2 — THE GAP, BEFORE YOU COMMIT TO ANYTHING
-- Read this output. Every row is a manager HR has not created yet, and the
-- count is how many people would skip manager review because of it.

select coalesce(e.reporting_manager, '(no manager named)') as manager_name,
       count(*)                                            as reports_unrouted
  from employees e
 where e.l1_manager_id is null
 group by e.reporting_manager
 order by count(*) desc;


-- SECTION 3 — THE SWITCH
-- Commented out on purpose. Uncomment only after SECTION 2 reads acceptably.

-- update travel_policies
--    set rm_stage_enabled = true,      -- Reporting Manager reviews first
--        hr_stage_enabled = false      -- HR Head leaves the chain
--  where is_active;


-- SECTION 4 — HOW TO PUT IT BACK
-- No code change, no migration. Reversing the two flags restores the HR Head
-- chain immediately:
--
--   update travel_policies
--      set rm_stage_enabled = false, hr_stage_enabled = true
--    where is_active;
--
-- Claims already in flight keep the stage they are sitting on either way.
-- Only claims submitted after the change use the new chain.


-- SECTION 5 — VERIFY
-- Expect one row per active company. Confirm the flags are what you intended
-- rather than trusting that no error appeared.

select p.company_id,
       p.rm_stage_enabled,
       p.hr_stage_enabled,
       (select count(*) from employees e
         where e.company_id = p.company_id and e.l1_manager_id is not null) as routed,
       (select count(*) from employees e
         where e.company_id = p.company_id and e.l1_manager_id is null)     as unrouted
  from travel_policies p
 where p.is_active
 order by p.company_id;

commit;
