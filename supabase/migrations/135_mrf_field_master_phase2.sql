-- 135_mrf_field_master_phase2.sql
-- ===========================================================================
-- MRF Field Master, phase 2 — section E of the benchmark, the candidate
-- profile. Phase 1 (134) covered headcount, agency terms, BGV/medical and
-- closure; this is what a requisition says about the PERSON it is looking for.
--
-- The forms already carry skills_required, good_to_have_skills, experience
-- min/max, education min/max, previous_company_preference and job_description.
-- These are the rest of section E:
--
--   role_summary / kras            what the role is for, and what it is measured on
--   specialisation / certifications  beside the existing education fields
--   relevant_experience_*          the benchmark wants TOTAL and RELEVANT; the
--                                  existing experience_min/max are total only
--   industry_preference            previous_company_preference is MNC/Startup
--   target_companies               only, so neither of these has a home today
--   max_notice_period_days         how long a notice period is still acceptable
--   languages / travel_percentage / relocation_required
--   diversity_flag                 a diversity requisition
--   licence_requirement            field roles — driving licence, own vehicle
--
-- Every column is OPTIONAL. validateMrf() does not reference any of them, so
-- the step gates, Save Draft and existing drafts are unaffected.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- Role definition.
alter table public.manpower_requisitions add column if not exists role_summary text;
alter table public.manpower_requisitions add column if not exists kras         text;

-- Qualification detail, beside education_min / education_max.
alter table public.manpower_requisitions add column if not exists specialisation text;
alter table public.manpower_requisitions add column if not exists certifications text;

-- Relevant experience, as distinct from total (experience_min / experience_max).
alter table public.manpower_requisitions add column if not exists relevant_experience_min numeric;
alter table public.manpower_requisitions add column if not exists relevant_experience_max numeric;

-- Where the candidate should come from.
alter table public.manpower_requisitions add column if not exists industry_preference text;
alter table public.manpower_requisitions add column if not exists target_companies    text;

-- Practical constraints.
alter table public.manpower_requisitions add column if not exists max_notice_period_days integer;
alter table public.manpower_requisitions add column if not exists languages             text;
alter table public.manpower_requisitions add column if not exists travel_percentage     integer;
alter table public.manpower_requisitions add column if not exists relocation_required   boolean;

-- Flags.
alter table public.manpower_requisitions add column if not exists diversity_flag     boolean;
alter table public.manpower_requisitions add column if not exists licence_requirement text;

notify pgrst, 'reload schema';
