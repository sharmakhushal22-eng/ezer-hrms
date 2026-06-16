-- ============================================================
-- 015_onboarding_esic.sql
-- ESIC applicability override on the onboarding candidate.
-- When NULL, the portal auto-decides from offered_ctc/12 ≤ ₹21,000.
-- HR can force it on/off by setting this column.
-- Idempotent — safe to run repeatedly.
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================
alter table public.onboarding_candidates
  add column if not exists esic_applicable boolean;

notify pgrst, 'reload schema';
