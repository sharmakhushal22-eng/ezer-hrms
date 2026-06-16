-- ============================================================
-- 014_mrf_missing_columns.sql
-- Ensures every column the MRF save writes exists on
-- manpower_requisitions. Fixes: "Could not find the
-- 'education_required' column ... in the schema cache".
-- Idempotent — safe to run repeatedly; no-ops for existing columns.
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================
alter table public.manpower_requisitions
  add column if not exists education_required          text,
  add column if not exists experience_required         text,
  add column if not exists skills_required             text,
  add column if not exists mrf_type                    text,
  add column if not exists hiring_type                 text,
  add column if not exists previous_company_preference text,
  add column if not exists reason_for_hire             text,
  add column if not exists position                    text,
  add column if not exists openings                    integer,
  add column if not exists experience_min              text,
  add column if not exists experience_max              text,
  add column if not exists education_min               text,
  add column if not exists education_max               text;

-- Refresh PostgREST's schema cache so the new columns are usable immediately.
notify pgrst, 'reload schema';
