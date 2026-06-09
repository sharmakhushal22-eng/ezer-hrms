-- ============================================================
-- 008_offer_revised_flag.sql
-- Marks a candidate whose offer was revised (sent back from
-- pre-onboarding to negotiation) so a "Revised Offer" badge can
-- show everywhere in the recruitment UI.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ============================================================
alter table public.candidates
  add column if not exists offer_revised       boolean default false,
  add column if not exists offer_revision_note text;
