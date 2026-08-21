-- 054_enable_rm_stage.sql
-- EZER HRMS — switch the travel-claim chain to Reporting Manager -> Finance,
-- and make it work for every employee rather than only the ones with a
-- manager on record.
--
-- SAFE TO RUN. This version does not strand anybody.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM THIS SOLVES
-- ---------------------------------------------------------------------------
--
-- Tushar asked for  employee -> reporting manager -> finance.
--
-- 052 built the machinery and stopped short of enabling it, because
-- employees.reporting_manager is a TEXT NAME, not a foreign key. Measured on
-- 2026-08-20:
--
--     routed to a manager      28
--     manager named, no row   362
--     no manager named          8
--                             ---
--                             398
--
-- Ten distinct manager names; only Priya Iyer (SRS9032) and Manoj Bose
-- (SRS9012) exist as employees, and a manager must be in the same company to
-- approve, so even those resolve only partly (21 of 49, and 7 of 24).
--
-- Simply flipping the flags would send 370 of 398 employees STRAIGHT TO
-- FINANCE with no first review, because travel_first_claim_stage() skips a
-- stage that has nobody mapped. That is worse than the HR Head chain it
-- replaces, which at least routes all 398 somewhere.
--
-- ---------------------------------------------------------------------------
-- THE FIX — HR HEAD BECOMES A FALLBACK, NOT A STAGE
-- ---------------------------------------------------------------------------
--
-- Adding eight fabricated manager records is not an option; who reports to
-- whom is HR's data, not something a migration should invent.
--
-- Instead this adds a third flag, travel_policies.hr_fallback_only, and
-- teaches the two chain functions to tell the difference between
--
--     "HR Head reviews every claim"          hr_stage_enabled = true
--     "HR Head catches what RM cannot"       hr_fallback_only  = true
--
-- With rm_stage_enabled = true, hr_stage_enabled = false, hr_fallback_only = true:
--
--     employee WITH a manager      RM        -> Finance     <- what was asked
--     employee WITHOUT a manager   HR Head   -> Finance     <- nobody stranded
--
-- Every claim gets exactly one review before Finance. Simulated against all
-- 398 active employees on 2026-08-20: 28 via RM, 369 via the HR fallback, and
-- 1 (SSM9101) who has no manager, no HR Head and no HR manager on their row —
-- a data gap for HR, not something SQL can fix. 370 unreviewed becomes 1.
--
-- And it self-heals: the moment HR creates a missing manager as an employee,
-- re-running SECTION 2 moves their reports off the fallback and onto the RM
-- path. No further migration, no code change.
--
-- ---------------------------------------------------------------------------

begin;

-- ============================================================================
-- SECTION 1 — THE FALLBACK FLAG
-- ============================================================================

alter table travel_policies
  add column if not exists hr_fallback_only boolean not null default false;

comment on column travel_policies.hr_fallback_only is
  'When true, the HR Head reviews a claim only if the employee has no '
  'l1_manager_id — a safety net rather than a stage in the chain. Ignored '
  'unless rm_stage_enabled is true. Set by 054.';


-- ============================================================================
-- SECTION 2 — BACKFILL l1_manager_id
-- Idempotent: fills only rows still null, only on an exact full-name match
-- inside the same company. Re-run it whenever HR adds a manager.
--
-- No fuzzy matching. "Rekha Pillai" against "Rekha Chopra" is a different
-- person, and pointing a claim at the wrong approver is worse than leaving it
-- on the fallback.
-- ============================================================================

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
  raise notice 'newly routed to a manager: %', v_matched;
  raise notice 'on the HR Head fallback:   %', v_left;
end $$;


-- ============================================================================
-- SECTION 3 — TEACH THE CHAIN ABOUT THE FALLBACK
-- ============================================================================

create or replace function travel_first_claim_stage(p_employee_id uuid)
returns text
language plpgsql
stable
as $$
declare
  v_company     uuid;
  v_rm_on       boolean;
  v_hr_on       boolean;
  v_hr_fallback boolean;
  v_has_rm      boolean;
begin
  select company_id into v_company from employees where id = p_employee_id;

  select coalesce(p.rm_stage_enabled, false),
         coalesce(p.hr_stage_enabled, true),
         coalesce(p.hr_fallback_only, false)
    into v_rm_on, v_hr_on, v_hr_fallback
    from travel_policies p
   where p.company_id = v_company
     and p.is_active
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc
   limit 1;

  v_has_rm := travel_claim_approver(p_employee_id, 'CLAIM_RM') is not null;

  if coalesce(v_rm_on, false) and v_has_rm then
    return 'PENDING_RM';
  end if;

  -- HR Head reviews when it is a stage in its own right, OR when it is the
  -- fallback and this employee has no manager to review instead. The second
  -- case is what stops a claim falling through to Finance unreviewed.
  if (coalesce(v_hr_on, true)
      or (coalesce(v_hr_fallback, false) and coalesce(v_rm_on, false) and not v_has_rm))
     and travel_claim_approver(p_employee_id, 'CLAIM_HR') is not null then
    return 'PENDING_HR';
  end if;

  -- Genuinely nobody upstream. Finance still sees it rather than the claim
  -- parking in a state no one owns.
  return 'PENDING_FINANCE';
end;
$$;

comment on function travel_first_claim_stage is
  'Entry status for a submitted claim. Returns PENDING_RM when the RM stage is '
  'on and a manager is mapped; PENDING_HR when HR is a stage, or is the '
  'configured fallback and no manager is mapped; else PENDING_FINANCE.';


create or replace function travel_next_claim_stage(p_employee_id uuid, p_current text)
returns text
language plpgsql
stable
as $$
declare
  v_company     uuid;
  v_hr_on       boolean;
  v_hr_fallback boolean;
begin
  select company_id into v_company from employees where id = p_employee_id;

  select coalesce(p.hr_stage_enabled, true),
         coalesce(p.hr_fallback_only, false)
    into v_hr_on, v_hr_fallback
    from travel_policies p
   where p.company_id = v_company and p.is_active
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc
   limit 1;

  if p_current = 'PENDING_RM' then
    -- A fallback is not a stage. If the manager has just approved, the claim
    -- goes to Finance — it does not then collect an HR signature as well.
    if coalesce(v_hr_fallback, false) then
      return 'PENDING_FINANCE';
    end if;
    if coalesce(v_hr_on, true)
       and travel_claim_approver(p_employee_id, 'CLAIM_HR') is not null then
      return 'PENDING_HR';
    end if;
    return 'PENDING_FINANCE';
  end if;

  if p_current = 'PENDING_HR' then
    return 'PENDING_FINANCE';
  end if;

  return 'APPROVED';   -- Finance approved; nothing follows it
end;
$$;

comment on function travel_next_claim_stage is
  'The status a claim moves to after the current stage approves. A claim that '
  'cleared RM goes straight to Finance when hr_fallback_only is set. Mirrors '
  'nextClaimStage() in lib/travel/access.ts.';


-- ============================================================================
-- SECTION 3b — LET THE HR MANAGER CATCH WHAT THE HR HEAD CANNOT
--
-- travel_claim_approver resolved CLAIM_HR as coalesce(hr_head_id, hr_manager_id).
-- Because coalesce stops at the first non-null, an employee whose hr_head_id is
-- set but points at THEMSELF — the HR Head filing their own claim — never
-- reached hr_manager_id. The self-check then nulled it and the claim fell
-- through to Finance with nobody having reviewed it, even though a perfectly
-- good hr_manager_id was sitting on the row.
--
-- SRS9047 (Kiran Reddy) is exactly this case today.
--
-- Now the candidates are tried in order and the first one who is not the
-- claimant wins.
-- ============================================================================

create or replace function travel_claim_approver(p_employee_id uuid, p_stage text)
returns uuid
language plpgsql
stable
as $$
declare
  v_candidate uuid;
begin
  if p_stage = 'CLAIM_RM' then
    select l1_manager_id into v_candidate
      from employees where id = p_employee_id;
    if v_candidate is not null and v_candidate <> p_employee_id then
      return v_candidate;
    end if;
    return null;

  elsif p_stage = 'CLAIM_HR' then
    -- first choice: the HR Head who signs off travel spend
    select hr_head_id into v_candidate
      from employees where id = p_employee_id;
    if v_candidate is not null and v_candidate <> p_employee_id then
      return v_candidate;
    end if;

    -- second choice: the day-to-day HR contact
    select hr_manager_id into v_candidate
      from employees where id = p_employee_id;
    if v_candidate is not null and v_candidate <> p_employee_id then
      return v_candidate;
    end if;

    return null;
  end if;

  return null;
end;
$$;

comment on function travel_claim_approver is
  'Resolves the approver for CLAIM_RM (l1_manager_id) or CLAIM_HR (hr_head_id, '
  'then hr_manager_id). Candidates are tried in order and the claimant is never '
  'returned, so an HR Head filing their own claim still reaches their HR manager. '
  'Null means the stage has no owner and is skipped.';


-- ============================================================================
-- SECTION 4 — THE SWITCH
-- ============================================================================

update travel_policies
   set rm_stage_enabled = true,      -- Reporting Manager reviews first
       hr_stage_enabled = false,     -- HR Head is no longer a stage for everyone
       hr_fallback_only = true       -- ...but still catches employees with no manager
 where is_active;


-- ============================================================================
-- SECTION 5 — HOW TO PUT IT BACK
-- No migration needed. Restores the HR-Head-reviews-everything chain:
--
--   update travel_policies
--      set rm_stage_enabled = false, hr_stage_enabled = true,
--          hr_fallback_only = false
--    where is_active;
--
-- Claims already in flight keep the stage they are sitting on. Only claims
-- submitted after the change use the new chain.
-- ============================================================================


-- ============================================================================
-- SECTION 6 — VERIFY
-- Read this output rather than trusting that no error appeared.
-- ============================================================================

-- (a) the flags, per active company
select p.company_id,
       p.rm_stage_enabled, p.hr_stage_enabled, p.hr_fallback_only,
       (select count(*) from employees e
         where e.company_id = p.company_id and e.l1_manager_id is not null) as via_manager,
       (select count(*) from employees e
         where e.company_id = p.company_id and e.l1_manager_id is null)     as via_hr_fallback
  from travel_policies p
 where p.is_active
 order by p.company_id;

-- (b) where every employee's next claim would actually land.
--
--     Expected on 2026-08-20, simulated against all 398 active employees:
--
--         PENDING_RM        28     have a manager on record
--         PENDING_HR       369     on the HR Head fallback
--         PENDING_FINANCE    1     see below
--
--     The 1 is SSM9101 (Sam, Admin), who has no l1_manager_id, no hr_head_id
--     and no hr_manager_id — nobody to review them exists on the row. That is
--     a data gap for HR to fill, not something a migration can invent, and
--     falling through to Finance is the correct safe behaviour meanwhile.
--     If this number is anything other than 1, investigate before going live.
select travel_first_claim_stage(e.id) as first_stage, count(*)
  from employees e
 where e.date_of_leaving is null
 group by 1
 order by 2 desc;

-- (b2) exactly who has no reviewer at all. Give this list to HR.
select e.emp_code, e.full_name, e.designation
  from employees e
 where e.date_of_leaving is null
   and travel_claim_approver(e.id, 'CLAIM_RM') is null
   and travel_claim_approver(e.id, 'CLAIM_HR') is null;

-- (c) which managers HR still needs to create. Shrinks as they are added;
--     re-run SECTION 2 afterwards to move their reports onto the RM path.
select e.reporting_manager as manager_name, count(*) as reports_on_fallback
  from employees e
 where e.l1_manager_id is null
   and e.reporting_manager is not null
 group by e.reporting_manager
 order by count(*) desc;

commit;
