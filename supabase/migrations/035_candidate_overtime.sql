-- ============================================================
-- 035_candidate_overtime.sql — EZER HRMS · Overtime pay flag on candidates
-- Captured when adding a candidate to the recruitment pipeline.
-- Additive & idempotent. HOW TO RUN: Supabase → SQL Editor → paste → Run.
-- ============================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS overtime_pay_applicable BOOLEAN DEFAULT FALSE;

notify pgrst, 'reload schema';
