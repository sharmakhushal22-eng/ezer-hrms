-- ============================================================
-- 011_mrf_exp_edu.sql
-- MRF: split experience & education into min / max.
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ============================================================
alter table public.manpower_requisitions
  add column if not exists experience_min text,
  add column if not exists experience_max text,
  add column if not exists education_min  text,
  add column if not exists education_max  text;
