-- 130_mrf_wage_category.sql
-- ===========================================================================
-- MRF carries the worker / skill category (Unskilled · Semi Skilled · Skilled ·
-- Highly Skilled). Salary negotiation reads it to apply the right state minimum wage.
-- Idempotent. Safe to run twice.
-- ===========================================================================
alter table public.manpower_requisitions add column if not exists wage_category text;
notify pgrst, 'reload schema';
