-- ════════════════════════════════════════════════════════════════════
-- 128_leave_holiday_sync.sql — ESS Leave ⇄ Holiday & Weekly-off Config
--
-- Three changes, all idempotent. Run order does not matter.
--
--   1. weekly_off_config.department_id — capture live drift
--   2. resolve_holidays() — narrower scope wins instead of a union
--   3. role_screen_access — let HR reach the Calendars and Weekly Off tabs
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- It does NOT publish the FY 2026-27 calendar. Publishing is the switch that
-- makes holidays bind for all 398 employees, and the calendar still contains
-- "Independace Day" (misspelled) scoped to all three companies while the
-- correctly spelled entry is scoped to one branch. Publishing before that is
-- fixed would show the typo to nearly everyone. Fix the data first, then
-- publish from the Calendars tab.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. department_id — live drift, in no previous migration ──────────
--
-- The Weekly Off tab collects a department scope and sends department_id on
-- every insert (app/dashboard/holidays/page.tsx). The column exists on the live
-- database but was added out of band: migration 026 never created it and no
-- migration since adds it. A database rebuilt from this repo would therefore
-- reject every weekly-off rule the UI tries to save.
--
-- Captured here so the repo and the live schema agree. NOTE: resolve_weekly_offs
-- does not filter on it, so a department-scoped rule still applies to everyone
-- in the company/branch. Narrowing the resolver is a behaviour change and is
-- deliberately not bundled into this migration.
ALTER TABLE weekly_off_config ADD COLUMN IF NOT EXISTS department_id UUID;


-- ── 2. resolve_holidays — narrower scope wins ────────────────────────
--
-- The previous definition (026:102) used SELECT DISTINCT, which is a union: an
-- employee matching both a company-wide row and a branch-specific row for the
-- same date received BOTH. On 15 Aug 2026 an SSM Gurugram Branch employee
-- matches "Independace Day" (all companies, all branches) and "Independence
-- Day" (SSM Gurugram only) and would see the date twice, under two names.
--
-- DISTINCT ON keeps exactly one row per date, ordered so that:
--   * a branch-specific row beats a company-wide one, then
--   * the most recently created entry wins a genuine tie.
--
-- Everything else — the PUBLISHED filter, calendar_type, company_calendar_map
-- and the applicability scope — is unchanged from 026.
CREATE OR REPLACE FUNCTION resolve_holidays(p_employee_id UUID)
RETURNS TABLE(holiday_date DATE, description TEXT, holiday_type TEXT, is_optional BOOLEAN) AS $$
  SELECT DISTINCT ON (he.holiday_date)
         he.holiday_date, he.description, he.holiday_type, he.is_optional
  FROM employees e
  JOIN company_calendar_map ccm ON ccm.company_id = e.company_id
  JOIN holiday_calendar hc      ON hc.id = ccm.holiday_calendar_id
                               AND hc.status = 'PUBLISHED'
                               AND hc.calendar_type = 'HOLIDAY'
  JOIN holiday_entries he       ON he.calendar_id = hc.id
                               AND he.holiday_date BETWEEN hc.from_date AND hc.to_date
  JOIN holiday_applicability ha ON ha.holiday_id = he.id
                               AND ha.company_id = e.company_id
                               AND (ha.branch_id IS NULL OR ha.branch_id = e.location_id)
  WHERE e.id = p_employee_id
  ORDER BY he.holiday_date,
           (ha.branch_id IS NOT NULL) DESC,   -- branch-specific beats company-wide
           he.created_at DESC;                -- newest entry breaks a true tie
$$ LANGUAGE sql STABLE;


-- ── 3. Let HR publish calendars and configure weekly offs ────────────
--
-- Migration 125 granted BRANCH_HR and BRANCH_EXEC only 'holidays.hol' and
-- 'holidays.prev'. Because canSeeScreen restricts a module to exactly the rows
-- a role has (lib/rms/resolve.ts), those two roles cannot open the Calendars
-- tab (where a calendar is published) or the Weekly Off tab (where week-off
-- rules are configured) — the two screens they most need to run this feature.
--
-- Managers (L1/L2/HOD) are deliberately NOT granted these. Publishing a
-- calendar binds holidays for every employee in the company; that is an HR
-- action, not a reporting-line one.
insert into public.role_screen_access (role_id, screen_key, can_view)
select r.id, v.screen_key, true
from (values
  ('BRANCH_HR',   'holidays.cal'),
  ('BRANCH_HR',   'holidays.week'),
  ('BRANCH_EXEC', 'holidays.cal'),
  ('BRANCH_EXEC', 'holidays.week')
) as v(role_code, screen_key)
join public.ess_roles r on r.role_code = v.role_code
on conflict (role_id, screen_key) do nothing;

notify pgrst, 'reload schema';
