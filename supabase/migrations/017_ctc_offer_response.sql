-- ============================================================
-- 017_ctc_offer_response.sql
-- Candidate accept/reject response on the salary-view (CTC) link.
-- The candidate opens /salary-view/<link_token> and presses Accept or
-- Reject; the choice is stored here and shown back to HR in Negotiation.
-- Idempotent — safe to run repeatedly.
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================
alter table public.ctc_negotiations
  add column if not exists candidate_response text,   -- 'ACCEPTED' | 'REJECTED'
  add column if not exists response_at        timestamptz,
  add column if not exists response_note      text;

-- Candidates who were already negotiated (have a CTC row) should appear under
-- "CTC Negotiations" (not "Pre-negotiation Checks") so their saved data shows.
update public.candidates c
   set pre_negotiation_done = true
 where coalesce(pre_negotiation_done, false) = false
   and exists (select 1 from public.ctc_negotiations n where n.candidate_id = c.id);

notify pgrst, 'reload schema';
