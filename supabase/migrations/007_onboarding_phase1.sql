-- ============================================================
-- 007_onboarding_phase1.sql
-- Post-offer onboarding — Phase 1: offer-response branching
-- (Accept / Revise / Backout) + candidate blacklist.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ============================================================

-- Onboarding state on the existing pre-onboarding record.
alter table public.preonboarding_links
  add column if not exists offer_response            text check (offer_response in ('ACCEPTED','REVISE','BACKOUT')),
  add column if not exists candidate_type            text check (candidate_type in ('EXPERIENCED','FRESHER')),
  add column if not exists response_at               timestamptz,
  add column if not exists acceptance_letter_sent_at timestamptz,
  add column if not exists revise_note               text;

-- Blacklist flag for candidates who back out after accepting.
alter table public.candidates
  add column if not exists blacklisted      boolean default false,
  add column if not exists blacklist_reason text;
