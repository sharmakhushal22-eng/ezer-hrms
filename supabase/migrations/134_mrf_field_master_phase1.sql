-- 134_mrf_field_master_phase1.sql
-- ===========================================================================
-- MRF Field Master, phase 1 — the gaps the Darwinbox / PeopleStrong benchmark
-- flagged that EZER did not already capture.
--
-- Two of the six it listed needed nothing: the worker/skill category has been
-- there since 130 (wage_category), and the minimum-wage match it calls the
-- India-first differentiator is already wired through lib/recruitment/min-wages.
-- The re-approval trigger is workflow behaviour, not a field, so it is not here.
--
-- Every column is OPTIONAL. Nothing in validateMrf() references them, so an
-- existing draft stays submittable and the approval flow is untouched.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- A. Header — how the requisition came about.
--    Manual · Manpower plan (AOP) · Triggered by separation
alter table public.manpower_requisitions add column if not exists request_source text;

-- B. Requisition type — headcount snapshot for the department/location.
--    Captured as typed numbers for now; reading them live from the employee
--    master is phase 2.
alter table public.manpower_requisitions add column if not exists headcount_sanctioned integer;
alter table public.manpower_requisitions add column if not exists headcount_actual     integer;
alter table public.manpower_requisitions add column if not exists headcount_open       integer;

-- H. Sourcing — agency terms. Exclusivity and ownership are in DAYS so the
--    recruiter can tell when a vendor's claim on a candidate lapses.
alter table public.manpower_requisitions add column if not exists agency_vendor           text;
alter table public.manpower_requisitions add column if not exists agency_fee_pct          numeric;
alter table public.manpower_requisitions add column if not exists agency_exclusivity_days integer;
alter table public.manpower_requisitions add column if not exists agency_ownership_days   integer;

-- I. Hiring process — background verification and pre-employment medical.
alter table public.manpower_requisitions add column if not exists bgv_required     boolean;
alter table public.manpower_requisitions add column if not exists bgv_package      text;
alter table public.manpower_requisitions add column if not exists medical_required boolean;

-- K. Closure — what the role actually closed at, against what was budgeted.
--    Filled when the requisition closes, not when it is raised.
alter table public.manpower_requisitions add column if not exists closure_offered_ctc numeric;
alter table public.manpower_requisitions add column if not exists closure_doj         date;
alter table public.manpower_requisitions add column if not exists closure_source      text;

notify pgrst, 'reload schema';
