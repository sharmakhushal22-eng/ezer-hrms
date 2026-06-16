-- ============================================================
-- 018_rename_mdfinal_shortlisted.sql
-- Rename the recruitment stage "MD Final" → "Shortlisted" everywhere
-- it is stored, so the DB matches the app (which no longer uses "MD Final").
-- candidates.stage is free text (no CHECK constraint), so a simple UPDATE is safe.
-- Idempotent — safe to run repeatedly.
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================

-- 1) The live stage on each candidate.
update public.candidates
   set stage = 'Shortlisted'
 where stage = 'MD Final';

-- 2) Any audit-log entries that recorded the old stage name (cosmetic/history).
update public.recruitment_audit_logs
   set details = jsonb_set(details, '{to_stage}', '"Shortlisted"')
 where details ->> 'to_stage' = 'MD Final';

notify pgrst, 'reload schema';
