-- =====================================================================
-- EZER HRMS — 075: ESS notification catalogue columns
--
-- The notification feature WORKS WITHOUT THIS MIGRATION. It is an
-- improvement, not a prerequisite — nothing is blocked waiting on it.
--
-- ess_notifications was created by migration 021 as:
--     id, employee_id, category, title, body, link, is_read, created_at
--
-- The catalogue document assumes a notification_code and a channel column.
-- Neither exists. Rather than block the feature, the application writes the
-- stable code into `category`, which is free TEXT and was already used that
-- way — the rows already in the table hold 'BIRTHDAY' and 'ANNIVERSARY'.
--
-- This migration adds the proper columns and backfills them FROM category,
-- so nothing has to be re-sent and no history is lost. After applying it,
-- flip NOTIF_HAS_CODE to true in lib/notifications/dispatch.ts and the app
-- starts populating them; until then it keeps using category and behaves
-- identically.
--
-- All ADD COLUMN IF NOT EXISTS, all nullable. No existing row changes
-- meaning, no data is deleted.
-- =====================================================================


-- ── The stable code, separate from the free-text category ───────────────
ALTER TABLE ess_notifications ADD COLUMN IF NOT EXISTS notification_code text;

-- ── Priority: the catalogue's "In-app + Email" tier ─────────────────────
-- Build note 1: those entries are time-sensitive, financial, or a rejection,
-- and want a visible marker in the inbox rather than only a second channel.
ALTER TABLE ess_notifications ADD COLUMN IF NOT EXISTS priority text
  DEFAULT 'NORMAL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ess_notifications_priority_chk'
  ) THEN
    ALTER TABLE ess_notifications
      ADD CONSTRAINT ess_notifications_priority_chk
      CHECK (priority IN ('NORMAL','HIGH'));
  END IF;
END $$;

-- ── When it was read, not just whether ──────────────────────────────────
-- is_read alone cannot answer "how long do people leave approvals sitting",
-- which is the question an SLA feature will ask next.
ALTER TABLE ess_notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- ── Who caused it, for peer-to-peer notifications ───────────────────────
-- A wish needs a sender. Nullable because system notifications have none.
ALTER TABLE ess_notifications ADD COLUMN IF NOT EXISTS actor_employee_id uuid
  REFERENCES employees(id);


-- ── Backfill from what is already there ─────────────────────────────────
-- category has held the code all along, so this is a rename in effect, not
-- a guess. Filtered to rows where the new column is still empty so it is
-- safe to re-run.
UPDATE ess_notifications
   SET notification_code = category
 WHERE notification_code IS NULL
   AND category IS NOT NULL;

-- Anything already read has no recorded time; created_at is the honest
-- lower bound and is better than leaving it null forever.
UPDATE ess_notifications
   SET read_at = created_at
 WHERE read_at IS NULL
   AND is_read = true;

-- Mark the high-priority codes from the catalogue. Listed explicitly rather
-- than pattern-matched, because guessing priority from a code name is how a
-- rejection quietly ends up looking routine.
UPDATE ess_notifications SET priority = 'HIGH'
 WHERE priority IS DISTINCT FROM 'HIGH'
   AND COALESCE(notification_code, category) IN (
     'LEAVE_REJECTED','TRAVEL_REJECTED','PAYSLIP_READY',
     'DECLARATION_WINDOW_OPEN','PROOF_DEADLINE_APPROACHING','PROOF_REJECTED',
     'RESIGNATION_DATE_PROPOSED','RESIGNATION_RETENTION_REQUESTED',
     'RESIGNATION_LWD_FINAL','EXIT_CLEARANCE_ASSIGNED','FNF_PROCESSED',
     'MGR_RESIGNATION_SUBMITTED','MGR_RETENTION_FOLLOWUP','MGR_DELEGATION_STARTED',
     'L2_SLA_ESCALATED','L2_RESIGNATION_STAGE',
     'HOD_RESIGNATION_STAGE','HOD_ATTRITION_FLAG','HOD_PMS_FINALISE',
     'HR_RESIGNATION_FINAL_STAGE','HR_EXIT_CLEARANCE_PENDING','HR_BULK_PROOF_REMINDER',
     'HRHEAD_ATTRITION_REPORT','HRHEAD_PUSH_SPIKE',
     'FIN_POLICY_BREACH','CFO_BUDGET_ESCALATION','CFO_MONTH_END_SUMMARY',
     'PAYROLL_RUN_READY','PAYROLL_FILING_DUE','PAYROLL_NEGATIVE_NET',
     'IT_EXIT_CLEARANCE','ADMIN_EXIT_CLEARANCE',
     'MD_FINAL_SIGNOFF','MD_MONTHLY_KPI'
   );


-- ── Indexes ─────────────────────────────────────────────────────────────
-- The bell asks one question on every page load: my unread, newest first.
-- Partial index because read rows are the overwhelming majority over time
-- and none of them are ever in that answer.
CREATE INDEX IF NOT EXISTS idx_ess_notifications_unread
  ON ess_notifications (employee_id, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_ess_notifications_employee_created
  ON ess_notifications (employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ess_notifications_code
  ON ess_notifications (notification_code);

-- ess_kudos carries the peer wishes; the celebrations screen asks "did I
-- already wish this person today", which is this exact shape.
CREATE INDEX IF NOT EXISTS idx_ess_kudos_from_created
  ON ess_kudos (from_employee_id, created_at DESC);


-- =====================================================================
-- RLS — DELIBERATELY NOT SET HERE
--
-- ess_notifications already carries the house policy from 021
-- (FOR ALL TO anon, authenticated USING (true)). That means any anon caller
-- can read every employee's notifications, which for a table that will soon
-- carry resignation, payroll and appraisal messages is worth a decision
-- rather than an inheritance.
--
-- No policy is changed here because tightening it would break the existing
-- client reads in lib/supabase-ess.ts, and that trade is Nayan's call, not
-- something to slip into a migration about columns.
-- =====================================================================
