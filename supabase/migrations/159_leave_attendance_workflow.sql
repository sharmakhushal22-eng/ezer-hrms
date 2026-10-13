-- ============================================================
-- 159_leave_attendance_workflow.sql (was 138 on the feature branch) — EZER HRMS · Leave & Attendance
--
-- Four jobs:
--   1. ess_pick_approver() — one rule for "who approves this", which never
--      returns the applicant. The 121 trigger routed an HR manager's own leave
--      to themselves (COALESCE(hr_manager_id, …) = self), and they could then
--      approve it.
--   2. Attendance regularisation gets an approver. Requests were saved PENDING
--      and nothing ever acted on them: no approver column, no queue, no
--      notification. This adds the column, a stamping trigger (same shape as
--      leave's), a request_group so a date-range submission is one approval,
--      and backfills the requests already waiting.
--   3. Approved leave can be cancelled — by request, which the approver
--      confirms. Columns only; the workflow lives in lib/leave/workflow.ts.
--   4. Both tables become read-only to the browser. Every write now goes
--      through /api/ess/* (service role), which is what enforces "you can only
--      file for yourself" and "only the approver decides". Under the old
--      allow-all policy an employee could mark their own correction APPROVED
--      with one REST call.
--
-- Idempotent — safe to re-run. HOW TO RUN: Supabase → SQL Editor → paste → Run.
-- Depends on: 030, 071 (ess_effective_approver), 121.
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ess_pick_approver — the first candidate who is not the applicant
--
-- Candidates are tried in order. Each goes through ess_effective_approver(), so
-- a delegation (approver on leave → delegate) still applies, and the result is
-- re-checked: a delegate who happens to be the applicant is skipped too.
-- NULL when nobody qualifies — the request is then "unrouted" and shows up for
-- HR in Attendance & Leave → Requests.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ess_pick_approver(p_employee_id UUID, p_candidates UUID[])
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE
  c   UUID;
  eff UUID;
BEGIN
  IF p_candidates IS NULL THEN RETURN NULL; END IF;
  FOREACH c IN ARRAY p_candidates LOOP
    CONTINUE WHEN c IS NULL OR c = p_employee_id;
    eff := ess_effective_approver(c);
    IF eff IS NOT NULL AND eff <> p_employee_id THEN
      RETURN eff;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LEAVE — the 121 trigger, with the self-approval hole closed
--
-- Same modes as 121 (L1 / HR_MANAGER / BOTH / ASSIGNED→L1). The only change is
-- that each mode now names an ORDERED fallback list instead of a two-way
-- COALESCE, and ess_pick_approver skips the applicant. Shreya (HR manager of
-- record for herself) now routes her own sick leave to her HR head, then her
-- line manager — never to herself.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_leave_applications_stamp() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_mode  TEXT;
  e       RECORD;
  v_cands UUID[];
BEGIN
  IF upper(COALESCE(NEW.status, 'PENDING')) <> 'PENDING' THEN
    NEW.current_approver_id := NULL;
    NEW.approval_stage      := NULL;
    RETURN NEW;
  END IF;

  SELECT upper(COALESCE(lt.approval_by, 'L1')) INTO v_mode
    FROM leave_types lt WHERE lt.id = NEW.leave_type_id;

  SELECT l1_manager_id, l2_manager_id, hr_manager_id, hr_head_id INTO e
    FROM employees WHERE id = NEW.employee_id;

  IF v_mode = 'BOTH' THEN
    IF TG_OP = 'INSERT' OR NEW.approval_stage IS NULL THEN
      NEW.approval_stage := 'L1';
    END IF;
    v_cands := CASE WHEN NEW.approval_stage = 'HR'
                    THEN ARRAY[e.hr_manager_id, e.hr_head_id, e.l1_manager_id, e.l2_manager_id]
                    ELSE ARRAY[e.l1_manager_id, e.hr_manager_id, e.l2_manager_id, e.hr_head_id] END;
  ELSIF v_mode = 'HR_MANAGER' THEN
    NEW.approval_stage := NULL;
    v_cands := ARRAY[e.hr_manager_id, e.hr_head_id, e.l1_manager_id, e.l2_manager_id];
  ELSE
    NEW.approval_stage := NULL;
    v_cands := ARRAY[e.l1_manager_id, e.hr_manager_id, e.l2_manager_id, e.hr_head_id];
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.current_approver_id IS NULL
     OR NEW.current_approver_id = NEW.employee_id
     OR NEW.status         IS DISTINCT FROM OLD.status
     OR NEW.approval_stage IS DISTINCT FROM OLD.approval_stage THEN
    NEW.current_approver_id := ess_pick_approver(NEW.employee_id, v_cands);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leave_applications_stamp ON leave_applications;
CREATE TRIGGER leave_applications_stamp
  BEFORE INSERT OR UPDATE ON leave_applications
  FOR EACH ROW EXECUTE FUNCTION trg_leave_applications_stamp();

-- Re-route anything pending that currently sits with its own applicant.
UPDATE leave_applications SET current_approver_id = NULL
 WHERE status = 'PENDING' AND current_approver_id = employee_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. LEAVE — cancelling an APPROVED request
--
-- status stays APPROVED while the cancellation waits; cancel_status carries the
-- request. On approval the row becomes CANCELLED (the 030 CHECK already allows
-- it) and the balance gives the days back. A separate approver column, because
-- the stamping trigger above clears current_approver_id on any non-PENDING row.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS cancel_status       TEXT;
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS cancel_reason       TEXT;
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS cancel_approver_id  UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS cancel_decided_at   TIMESTAMPTZ;
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS cancel_decided_by   TEXT;
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS cancel_remark       TEXT;

DO $$ BEGIN
  ALTER TABLE leave_applications DROP CONSTRAINT IF EXISTS chk_leave_cancel_status;
  ALTER TABLE leave_applications ADD CONSTRAINT chk_leave_cancel_status
    CHECK (cancel_status IS NULL OR cancel_status IN ('REQUESTED', 'APPROVED', 'DECLINED'));
END $$;

CREATE INDEX IF NOT EXISTS idx_leave_app_cancel_approver
  ON leave_applications(cancel_approver_id)
  WHERE cancel_status = 'REQUESTED';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ATTENDANCE REGULARISATION — an approver, a group, a decider
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE attendance_regularisation ADD COLUMN IF NOT EXISTS current_approver_id UUID REFERENCES employees(id) ON DELETE SET NULL;
-- reviewed_by is TEXT (a name) in production; the id of whoever decided goes here.
ALTER TABLE attendance_regularisation ADD COLUMN IF NOT EXISTS reviewed_by_id UUID REFERENCES employees(id) ON DELETE SET NULL;
-- One id per submission: a date-range request is approved as one item.
ALTER TABLE attendance_regularisation ADD COLUMN IF NOT EXISTS request_group UUID;
ALTER TABLE attendance_regularisation ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- The status CHECK in production predates version control and its name is
-- unknown, so every CHECK that mentions status is replaced with one that also
-- allows CANCELLED (an employee withdrawing a pending request).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'attendance_regularisation'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE attendance_regularisation DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE attendance_regularisation ADD CONSTRAINT chk_att_reg_status
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'));
END $$;

-- Re-filing a day upserts on (employee_id, attendance_date). Production has
-- the unique key (the ESS upsert works); this makes a rebuild match.
CREATE UNIQUE INDEX IF NOT EXISTS uq_att_reg_emp_date
  ON attendance_regularisation(employee_id, attendance_date);

CREATE OR REPLACE FUNCTION trg_att_reg_stamp() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE e RECORD;
BEGIN
  NEW.updated_at := now();
  IF upper(COALESCE(NEW.status, 'PENDING')) <> 'PENDING' THEN
    NEW.current_approver_id := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT'
     OR NEW.current_approver_id IS NULL
     OR NEW.current_approver_id = NEW.employee_id
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT l1_manager_id, l2_manager_id, hr_manager_id, hr_head_id INTO e
      FROM employees WHERE id = NEW.employee_id;
    -- Reporting manager first: they know whether the person was at work.
    NEW.current_approver_id := ess_pick_approver(NEW.employee_id,
      ARRAY[e.l1_manager_id, e.hr_manager_id, e.l2_manager_id, e.hr_head_id]);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS att_reg_stamp ON attendance_regularisation;
CREATE TRIGGER att_reg_stamp
  BEFORE INSERT OR UPDATE ON attendance_regularisation
  FOR EACH ROW EXECUTE FUNCTION trg_att_reg_stamp();

-- Backfill: the requests that have been waiting since July reach an approver.
UPDATE attendance_regularisation SET current_approver_id = NULL
 WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_att_reg_approver
  ON attendance_regularisation(current_approver_id, status)
  WHERE current_approver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_att_reg_group
  ON attendance_regularisation(request_group)
  WHERE request_group IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — read-only for the browser
--
-- Reads stay open (the ESS calendar, the dashboard reports and the mobile app
-- read these tables directly). Writes are service-role only, i.e. through the
-- API routes that check who is asking.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT; p RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_regularisation', 'leave_applications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON %I', p.policyname, t);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO anon, authenticated USING (true)', 'read_' || t, t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'regularisations pending'          AS what, count(*) AS n FROM attendance_regularisation WHERE status = 'PENDING'
UNION ALL SELECT 'regularisations routed',     count(*) FROM attendance_regularisation WHERE status = 'PENDING' AND current_approver_id IS NOT NULL
UNION ALL SELECT 'leave pending',              count(*) FROM leave_applications WHERE status = 'PENDING'
UNION ALL SELECT 'leave pending with self',    count(*) FROM leave_applications WHERE status = 'PENDING' AND current_approver_id = employee_id
UNION ALL SELECT 'leave pending unrouted',     count(*) FROM leave_applications WHERE status = 'PENDING' AND current_approver_id IS NULL;

notify pgrst, 'reload schema';
