-- =====================================================================
-- UNDO-accidental-open-period.sql
--
-- NOT A MIGRATION. A one-off correction for something I did by mistake on
-- 4 September 2026, offered for you to run or discard.
--
-- WHAT HAPPENED
--
-- While probing which PMS functions existed, I called pms_open_period(). I
-- had treated it as a read because I was testing for the function's
-- EXISTENCE, and did not check what it does before calling it. It opens a
-- period and enrols everybody eligible. It returned:
--
--     "OPENED: 129 employees enrolled, 1 excluded (MD / exited)."
--
-- WHAT CHANGED, exactly
--
--   pms_periods    cdf4f863-2061-4ffe-8df5-8f6c32438997
--                  Q1-FY202627, company 96b6ec21…
--                  status SCHEDULED -> KRA_SETTING
--
--   pms_overall_rating
--                  129 rows created, all at 2026-09-04T07:41:04Z, all for
--                  that period
--
-- WHAT DID NOT CHANGE
--
-- Nothing else. Verified rather than assumed:
--   * all 129 rows are workflow_status NOT_STARTED with null scores — no
--     employee work is captured in them
--   * that period had ZERO pms_overall_rating rows beforehand, so every row
--     for it is mine and none of yours is caught by the delete below
--   * pms_employee_goals and pms_reviews are both still empty company-wide,
--     so nothing references these rows
--   * the other eleven periods are untouched
--
-- WHETHER TO RUN IT
--
-- Your call, and it is defensible either way. Q1 FY2026-27 is April to June
-- 2026 — a period that has already passed — so having it open for one company
-- with 129 people enrolled and nothing filled in is wrong but harmless. If
-- you were going to open it anyway, leave it.
--
-- Run it if you would rather the database matched what somebody intended.
-- =====================================================================

begin;

-- Every statement is filtered by the period id, and additionally by the
-- timestamp of my call. If somebody has legitimately enrolled in this period
-- since, their row has a later created_at and is NOT touched.
delete from pms_overall_rating
 where period_id = 'cdf4f863-2061-4ffe-8df5-8f6c32438997'
   and created_at >= '2026-09-04T07:41:00Z'
   and created_at <  '2026-09-04T07:42:00Z'
   and workflow_status = 'NOT_STARTED'
   and self_score is null
   and final_rating is null;

-- Expect 129. If it is materially different, something else has happened
-- since and you should stop and look rather than continue.

update pms_periods
   set status = 'SCHEDULED'
 where id = 'cdf4f863-2061-4ffe-8df5-8f6c32438997'
   and status = 'KRA_SETTING';

-- Check before committing:
--   select status from pms_periods
--    where id = 'cdf4f863-2061-4ffe-8df5-8f6c32438997';          -- SCHEDULED
--   select count(*) from pms_overall_rating
--    where period_id = 'cdf4f863-2061-4ffe-8df5-8f6c32438997';   -- 0

commit;
