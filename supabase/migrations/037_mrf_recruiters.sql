-- ============================================================
-- 037_mrf_recruiters.sql — EZER HRMS · Multiple recruiters per MRF
-- HR Head assigns one or more HR recruiters to an MRF at approval time.
-- assigned_recruiter (text) stays for backward-compat display; the array holds ids.
-- Additive & idempotent. HOW TO RUN: Supabase -> SQL Editor -> paste -> Run.
-- ============================================================

ALTER TABLE manpower_requisitions ADD COLUMN IF NOT EXISTS assigned_recruiter_ids UUID[];

notify pgrst, 'reload schema';
