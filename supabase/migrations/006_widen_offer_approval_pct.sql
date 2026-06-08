-- ============================================================
-- 006_widen_offer_approval_pct.sql
-- Fix "numeric field overflow" when a recruiter submits an offer
-- approval request. hike_pct / offered_variable_pct were NUMERIC(5,2)
-- (max 999.99) but a large hike % (e.g. 2300%) overflows that.
-- Widen them to NUMERIC(10,2), matching the same fix on ctc_negotiations.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ============================================================
alter table public.offer_approval_requests alter column hike_pct type numeric(10,2);
alter table public.offer_approval_requests alter column offered_variable_pct type numeric(10,2);
