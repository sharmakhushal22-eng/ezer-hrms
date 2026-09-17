-- 121_candidate_application_details.sql
-- ===========================================================================
-- FULL "ADD CANDIDATE" FORM — a home for every field the pipeline card and the
-- offer flow don't already have a column for.
--
-- FOR: Nayan Ahuja. ONE NULLABLE JSONB COLUMN. NO DATA TOUCHED. SAFE TO RUN TWICE.
--
-- The rich Add-candidate form captures personal details, professional
-- background, compensation breakdown, source/referral/vendor, documents and
-- screening answers. The core identity fields (name, phone, email, CTC, notice,
-- stage, source) map to their existing candidates columns exactly as before;
-- everything else is kept verbatim in this one JSONB blob so nothing the
-- recruiter typed is lost, without adding thirty single-purpose columns.
-- ===========================================================================

alter table public.candidates
  add column if not exists application_details jsonb;

comment on column public.candidates.application_details is
  'Full Add-candidate form payload — the fields with no dedicated column (personal, professional, compensation breakdown, source detail, documents, screening). Core fields still live in their own columns.';
