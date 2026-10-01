-- 136_mrf_field_master_phase3.sql
-- ===========================================================================
-- MRF Field Master, phase 3 — section F of the benchmark, compensation and
-- budget. 134 covered headcount / agency / BGV / closure, 135 the candidate
-- profile; this is what the requisition is allowed to OFFER.
--
-- Already present, untouched: budget_min, budget_max, currency,
-- compensation_type, pay_period, wage_category, and agency_fee_pct (the
-- benchmark's "hiring cost", which came in with the agency terms in 134).
--
--   variable_percentage        the fixed / variable split. ONE column, not two:
--                              fixed is the remainder, so the pair cannot drift
--                              apart the way two stored percentages would.
--   *_allowed / *_cap          the benchmark asks "whether allowed, and the
--                              cap" for joining bonus, relocation and notice
--                              buyout — so each is a flag plus a ceiling.
--   esop_eligible / _notes     senior roles
--   budget_code                the budget line this requisition draws on;
--                              distinct from cost_center, which is the org unit
--
-- The grade pay-range check the benchmark pairs with these is behaviour, not a
-- field, and stays deferred with the rest of the logic.
--
-- Every column is OPTIONAL. validateMrf() does not reference any of them, so
-- the step gates, Save Draft and existing drafts are unaffected.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- Fixed / variable split. Percent of CTC that is variable; fixed is 100 - this.
alter table public.manpower_requisitions add column if not exists variable_percentage numeric;

-- Joining bonus — whether it may be offered, and the ceiling.
alter table public.manpower_requisitions add column if not exists joining_bonus_allowed boolean;
alter table public.manpower_requisitions add column if not exists joining_bonus_cap     numeric;

-- Relocation allowance.
alter table public.manpower_requisitions add column if not exists relocation_allowance_allowed boolean;
alter table public.manpower_requisitions add column if not exists relocation_allowance_cap     numeric;

-- Notice-period buyout. The offer side already stores the agreed amount
-- (133_offer_approval_buyout_amount); this is the requisition's prior sanction.
alter table public.manpower_requisitions add column if not exists notice_buyout_allowed boolean;
alter table public.manpower_requisitions add column if not exists notice_buyout_cap     numeric;

-- ESOP / retention, for senior roles.
alter table public.manpower_requisitions add column if not exists esop_eligible        boolean;
alter table public.manpower_requisitions add column if not exists esop_retention_notes text;

-- The budget line this requisition draws on — not the same as cost_center.
alter table public.manpower_requisitions add column if not exists budget_code text;

notify pgrst, 'reload schema';
