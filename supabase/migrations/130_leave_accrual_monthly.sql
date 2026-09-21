-- ════════════════════════════════════════════════════════════════════
-- 130_leave_accrual_monthly.sql — leave accrues monthly, not yearly
--
-- THE PROBLEM THIS FIXES IS DATA, NOT SCHEMA.
--
-- The agreed model is: each leave type has a quota, it accrues MONTHLY at
-- annual_quota / 12, a month is credited at month end, a joining or leaving
-- month is weighted by its effective days, and unused accrual accumulates
-- within the year — capped only at the financial-year boundary.
--
-- But every row says otherwise. All eleven rows in leave_types and all three
-- in leave_policy carry accrual = 'YEARLY', which is simply the seeded default
-- from migration 030 that nobody has revisited. lib/leave/accrual.ts reads this
-- column rather than assuming, so until it is corrected the engine computes a
-- full year's quota from day one — which is not what was asked for.
--
-- Idempotent. HOW TO RUN: Supabase Dashboard → SQL Editor → paste → Run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. The catalogue ─────────────────────────────────────────────────
-- Only the types that actually carry a quota. BL, COL, CP, SAB, LWP and AB all
-- sit at annual_quota 0 and accrue nothing whatever this column says; leaving
-- them alone keeps the diff to the rows where it changes behaviour.
UPDATE leave_types
   SET accrual = 'MONTHLY'
 WHERE annual_quota > 0
   AND COALESCE(accrual, '') <> 'MONTHLY';

-- ── 2. The per-company / per-branch policy ───────────────────────────
-- resolve_leave_quota() prefers a branch policy, then the company default,
-- then the catalogue — so a stale 'YEARLY' here would override a corrected
-- catalogue row and the change would appear not to have worked.
UPDATE leave_policy
   SET accrual = 'MONTHLY'
 WHERE annual_quota > 0
   AND COALESCE(accrual, '') <> 'MONTHLY';

-- ── 3. What this leaves ──────────────────────────────────────────────
-- Read it back; expect MONTHLY against EL/CL/SL/ML/PL and nothing surprising
-- in the zero-quota rows.
SELECT 'leave_types' AS src, short_name, annual_quota, carry_forward_max, accrual
  FROM leave_types WHERE is_active ORDER BY sort_order;

SELECT 'leave_policy' AS src, lt.short_name, p.fy, p.branch_id, p.annual_quota,
       p.max_carry_forward, p.accrual
  FROM leave_policy p JOIN leave_types lt ON lt.id = p.leave_type_id
 ORDER BY lt.sort_order, p.fy;

-- ── NOT DONE HERE, deliberately ──────────────────────────────────────
--
-- Quotas are NOT changed. Only EL has a per-company policy row (15 days, carry
-- forward 30); the other ten types fall through to the catalogue. Whether CL's
-- 7 and SL's 7 are right, and whether the zero-quota types should have one, is
-- an HR decision and not something a migration should assume.
--
-- leave_balances is NOT seeded. opening and encashed are the only columns that
-- still need storing — accrued and used are computed by lib/leave/accrual.ts —
-- and for a first year every opening is legitimately 0.

notify pgrst, 'reload schema';
