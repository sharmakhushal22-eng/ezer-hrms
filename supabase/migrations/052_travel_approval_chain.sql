-- ============================================================================
-- EZER HRMS — TRAVEL CLAIM MODULE · CONFIGURABLE APPROVAL CHAIN
-- Migration 052
-- ----------------------------------------------------------------------------
-- Changes the claim approval chain from
--     employee -> HR Head -> Finance
-- to
--     employee -> Reporting Manager -> Finance
--
-- and makes each stage a policy flag rather than something baked into a
-- function, so the next change is a config edit and not another migration.
--
-- ============================================================================
-- READ THIS BEFORE RUNNING — THE DATA DOES NOT SUPPORT THIS CHAIN YET
-- ============================================================================
-- Routing to a Reporting Manager needs employees.l1_manager_id, because an
-- approver needs an employee id to have an inbox. Measured on 19 Aug 2026:
--
--   l1_manager_id          0 / 397 populated
--   l2_manager_id          0 / 397
--   functional_manager_id  0 / 397
--   reporting_manager    390 / 397  — but it is a TEXT NAME, not an id
--
-- reporting_manager holds 10 distinct names. Only 2 of them match an actual
-- employee row:
--
--   Priya Iyer     -> SRS9032   ✅
--   Manoj Bose     -> SRS9012   ✅
--   Rekha Pillai, Sanjay Gupta, Sunita Rao, Anjali Sharma, Vikram Mehta,
--   Rajesh Khanna, Deepak Nair, Neha Kapoor  -> no employee row exists
--
-- So with this chain live today:
--    73 of 397 employees would reach a real manager's inbox
--   324 of 397 would fall straight through to Finance with NO first review
--
-- That is worse than the current HR Head chain, which routes all 397, so this
-- migration does NOT flip the chain on its own. It ships the capability with
-- the new chain configured, and SECTION 3 populates l1_manager_id for the 73
-- that can be resolved. The remaining 324 need their managers to exist as
-- employees before the change is safe to enable — see SECTION 4, which is
-- commented out deliberately.
--
-- Safe to re-run.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — EACH STAGE BECOMES A FLAG
-- ============================================================================

alter table travel_policies
  add column if not exists hr_stage_enabled boolean not null default true;

comment on column travel_policies.hr_stage_enabled is
  'Whether a claim passes the HR Head before Finance. With rm_stage_enabled '
  'this makes the chain configuration rather than code: any combination of '
  'RM and HR, with Finance always last.';
comment on column travel_policies.rm_stage_enabled is
  'Whether a claim passes the Reporting Manager first. Needs '
  'employees.l1_manager_id populated — a stage with nobody mapped is skipped, '
  'not stalled, so enabling this without the data silently removes a review.';


-- ============================================================================
-- SECTION 2 — ROUTING WALKS THE ENABLED STAGES
-- A stage runs only if it is enabled AND somebody is mapped to it. Finance is
-- always last and is never skipped, so a claim can never end up in a state
-- with no owner.
-- ============================================================================

create or replace function travel_first_claim_stage(p_employee_id uuid)
returns text
language plpgsql
stable
as $$
declare
  v_company    uuid;
  v_rm_on      boolean;
  v_hr_on      boolean;
begin
  select company_id into v_company from employees where id = p_employee_id;

  select coalesce(p.rm_stage_enabled, false), coalesce(p.hr_stage_enabled, true)
    into v_rm_on, v_hr_on
    from travel_policies p
   where p.company_id = v_company
     and p.is_active
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc
   limit 1;

  if coalesce(v_rm_on, false)
     and travel_claim_approver(p_employee_id, 'CLAIM_RM') is not null then
    return 'PENDING_RM';
  end if;

  if coalesce(v_hr_on, true)
     and travel_claim_approver(p_employee_id, 'CLAIM_HR') is not null then
    return 'PENDING_HR';
  end if;

  -- Nobody upstream is enabled or mapped. Finance still has to see it rather
  -- than the claim parking in a state no one owns.
  return 'PENDING_FINANCE';
end;
$$;

comment on function travel_first_claim_stage is
  'Entry status for a submitted claim. Walks the enabled stages in order — '
  'RM, then HR Head — and returns the first that has an approver mapped, '
  'else PENDING_FINANCE.';


-- Where a claim goes after the stage that just approved it. Previously the
-- route decided this in TypeScript alone; having it here too means the
-- database and the application cannot drift apart on the same question.
create or replace function travel_next_claim_stage(p_employee_id uuid, p_current text)
returns text
language plpgsql
stable
as $$
declare
  v_company uuid;
  v_hr_on   boolean;
begin
  select company_id into v_company from employees where id = p_employee_id;

  select coalesce(p.hr_stage_enabled, true)
    into v_hr_on
    from travel_policies p
   where p.company_id = v_company and p.is_active
     and p.effective_from <= current_date
     and (p.effective_to is null or p.effective_to >= current_date)
   order by p.effective_from desc
   limit 1;

  if p_current = 'PENDING_RM' then
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
  'The status a claim moves to after the current stage approves. Mirrors '
  'nextClaimStage() in lib/travel/access.ts.';


-- ============================================================================
-- SECTION 3 — BACKFILL l1_manager_id FROM THE NAMES THAT RESOLVE
-- Only exact full-name matches, and only where l1_manager_id is still null.
-- Nobody is guessed at: a near match like "Rekha Pillai" against "Rekha Chopra"
-- is a different person, and pointing a claim at the wrong approver is worse
-- than leaving it unmapped.
-- ============================================================================

do $$
declare
  v_matched int;
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
  raise notice 'l1_manager_id backfilled for % employees', v_matched;

  raise notice 'still unmapped: %', (
    select count(*) from employees where l1_manager_id is null
  );
end $$;


-- Which manager names still have no employee record. Run this after, and give
-- the list to HR — each one needs an employee row before the RM chain can
-- route the people who report to them.
--
--   select e.reporting_manager as manager_name,
--          count(*)            as reports_unrouted
--     from employees e
--    where e.l1_manager_id is null
--      and e.reporting_manager is not null
--    group by e.reporting_manager
--    order by count(*) desc;


-- ============================================================================
-- SECTION 4 — SWITCH THE CHAIN  ***COMMENTED OUT ON PURPOSE***
-- ----------------------------------------------------------------------------
-- Uncomment and run ONLY once the query above returns no rows, or once you
-- accept that everyone still unmapped goes straight to Finance unreviewed.
--
-- Check first:
--   select count(*) filter (where l1_manager_id is not null) as will_reach_a_manager,
--          count(*) filter (where l1_manager_id is null)     as straight_to_finance
--     from employees;
--
-- Then:
--   update travel_policies
--      set rm_stage_enabled = true,    -- Reporting Manager reviews first
--          hr_stage_enabled = false    -- HR Head no longer in the chain
--    where is_active;
--
-- To go back to HR Head -> Finance, reverse the two flags. No code change and
-- no migration either way — that is the point of SECTION 1.
--
-- Claims already in flight keep the status they hold. A claim sitting in
-- PENDING_HR when the flags change still needs an HR Head to action it; the
-- new chain applies to claims submitted after the switch.
-- ============================================================================


-- ============================================================================
-- VERIFICATION
-- ============================================================================

select 'l1_manager_id populated' as check,
       count(*) filter (where l1_manager_id is not null)::text as actual,
       count(*)::text as of_total
  from employees
union all
select 'chain today',
       (select case when rm_stage_enabled and hr_stage_enabled then 'RM -> HR -> Finance'
                    when rm_stage_enabled then 'RM -> Finance'
                    when hr_stage_enabled then 'HR -> Finance'
                    else 'Finance only' end
          from travel_policies where is_active limit 1),
       ''
union all
select 'would reach a real inbox',
       (select count(*)::text from employees e
         where travel_first_claim_stage(e.id) <> 'PENDING_FINANCE'),
       (select count(*)::text from employees);

-- ============================================================================
-- END OF MIGRATION 052
-- ============================================================================
