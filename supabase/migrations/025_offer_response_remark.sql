-- ============================================================
-- 025_offer_response_remark.sql
-- Offer-flow follow-ups:
--   • #8  offer_approval_requests.hiring_manager_remark  — Hiring Manager's
--          remark / additional note (e.g. "Target") shown on the approval request.
--   • #13 candidates.offer_response  — post-offer-letter outcome captured by HR
--          (ACCEPTED / REVISION / BACKOUT). Drives MRF reopen/close.
-- Idempotent. HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================

alter table public.offer_approval_requests
  add column if not exists hiring_manager_remark text;

alter table public.candidates
  add column if not exists offer_response text;   -- 'ACCEPTED' | 'REVISION' | 'BACKOUT'

notify pgrst, 'reload schema';
