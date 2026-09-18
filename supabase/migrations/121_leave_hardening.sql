-- ============================================================
-- 121_leave_hardening.sql — EZER HRMS · Leave
--
-- Three jobs:
--   1. Capture schema drift — half_session and the widened approval_by CHECK
--      exist in production but in NO migration file. A rebuild from this
--      folder does not currently reproduce the live database.
--   2. Make the approver trigger honour leave_types.approval_by, which is
--      editable in the admin UI, displayed there, and read by nothing.
--   3. Index the approver queue, and stop an employee with no L1 manager from
--      filing a request that reaches nobody.
--
-- Idempotent — safe to re-run. HOW TO RUN: Supabase → SQL Editor → paste → Run.
-- Depends on: 030_leave_config.sql, 071_ess_access_reconciliation.sql.
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DRIFT — columns and constraints that exist live but were never migrated
-- ─────────────────────────────────────────────────────────────────────────────

-- half_session: present in production, mentioned in zero migrations. The ESS
-- data layer carries a runtime fallback that retries the insert without it,
-- citing a migration "sql56" that does not exist in this repo.
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS half_session TEXT;

DO $$ BEGIN
  ALTER TABLE leave_applications DROP CONSTRAINT IF EXISTS chk_leave_half_session;
  ALTER TABLE leave_applications ADD CONSTRAINT chk_leave_half_session
    CHECK (half_session IS NULL OR half_session IN ('', '1st', '2nd'));
EXCEPTION WHEN others THEN
  -- Legacy rows may hold something else; leave the column unconstrained rather
  -- than fail the whole migration on historical data.
  RAISE NOTICE 'half_session CHECK not applied (existing data): %', SQLERRM;
END $$;

-- approval_by: 030 declares CHECK IN ('L1','HR_MANAGER','ASSIGNED'), but the
-- live COL row holds 'BOTH' and the admin UI offers it — the constraint was
-- widened outside version control. Recorded here so the files match reality.
DO $$ BEGIN
  ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_approval_by_check;
  ALTER TABLE leave_types ADD CONSTRAINT leave_types_approval_by_check
    CHECK (approval_by IN ('L1', 'HR_MANAGER', 'ASSIGNED', 'BOTH'));
END $$;

-- BOTH means L1 then HR. Which leg a request is on has to be recorded
-- somewhere, or "approved" cannot be told apart from "half approved".
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS approval_stage TEXT;

DO $$ BEGIN
  ALTER TABLE leave_applications DROP CONSTRAINT IF EXISTS chk_leave_approval_stage;
  ALTER TABLE leave_applications ADD CONSTRAINT chk_leave_approval_stage
    CHECK (approval_stage IS NULL OR approval_stage IN ('L1', 'HR'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'approval_stage CHECK not applied: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ROUTING — honour approval_by
--
-- The 071 trigger routed every request to l1_manager_id regardless of the
-- type's configuration. Live, that meant:
--
--   L1          EL, CL                                    → L1   ✓ correct
--   HR_MANAGER  SL, ML, PL, BL, LWP, AB, CP, SAB          → L1   ✗ wrong
--   BOTH        COL                                        → L1   ✗ wrong
--
-- Nine of eleven types named an approver the system did not use. Sick leave,
-- maternity, paternity and bereavement all said "HR Manager" and all went to
-- the line manager instead.
--
-- The COALESCE fallbacks also fix the orphan case: an employee with no
-- l1_manager_id but a recorded hr_manager_id now routes to HR instead of
-- producing an unroutable request that reaches nobody's queue and generates
-- no notification for anyone.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_leave_applications_stamp() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_mode   TEXT;
  v_l1     UUID;
  v_hr     UUID;
  v_target UUID;
BEGIN
  -- Anything that has left PENDING is nobody's to action. This is why decided
  -- rows show a NULL approver — by design, not data loss.
  IF upper(COALESCE(NEW.status, 'PENDING')) <> 'PENDING' THEN
    NEW.current_approver_id := NULL;
    NEW.approval_stage      := NULL;
    RETURN NEW;
  END IF;

  SELECT upper(COALESCE(lt.approval_by, 'L1')) INTO v_mode
    FROM leave_types lt WHERE lt.id = NEW.leave_type_id;

  SELECT e.l1_manager_id, e.hr_manager_id INTO v_l1, v_hr
    FROM employees e WHERE e.id = NEW.employee_id;

  IF v_mode = 'BOTH' THEN
    -- Two legs. A fresh request starts at L1; the approvals route advances the
    -- stage to 'HR' instead of resolving, and this re-stamps accordingly.
    IF TG_OP = 'INSERT' OR NEW.approval_stage IS NULL THEN
      NEW.approval_stage := 'L1';
    END IF;
    v_target := CASE WHEN NEW.approval_stage = 'HR'
                     THEN COALESCE(v_hr, v_l1)
                     ELSE COALESCE(v_l1, v_hr) END;

  ELSIF v_mode = 'HR_MANAGER' THEN
    NEW.approval_stage := NULL;
    v_target := COALESCE(v_hr, v_l1);

  ELSE
    -- L1, ASSIGNED, and any unknown value. ASSIGNED has no column naming an
    -- assignee anywhere in the schema, so it behaves as L1 until one exists.
    NEW.approval_stage := NULL;
    v_target := COALESCE(v_l1, v_hr);
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.current_approver_id IS NULL
     OR NEW.status         IS DISTINCT FROM OLD.status
     OR NEW.approval_stage IS DISTINCT FROM OLD.approval_stage THEN
    NEW.current_approver_id := ess_effective_approver(v_target);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leave_applications_stamp ON leave_applications;
CREATE TRIGGER leave_applications_stamp
  BEFORE INSERT OR UPDATE ON leave_applications
  FOR EACH ROW EXECUTE FUNCTION trg_leave_applications_stamp();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL — re-route anything currently pending, under the new rules
--
-- Idempotent and safe to re-run: it only ever touches PENDING rows, and the
-- value it writes is a pure function of configuration.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE leave_applications l
   SET current_approver_id = ess_effective_approver(
         CASE upper(COALESCE(lt.approval_by, 'L1'))
           WHEN 'HR_MANAGER' THEN COALESCE(e.hr_manager_id, e.l1_manager_id)
           WHEN 'BOTH'       THEN COALESCE(e.l1_manager_id, e.hr_manager_id)
           ELSE                   COALESCE(e.l1_manager_id, e.hr_manager_id)
         END),
       approval_stage = CASE WHEN upper(COALESCE(lt.approval_by,'L1')) = 'BOTH'
                             THEN COALESCE(l.approval_stage, 'L1') ELSE NULL END
  FROM employees e, leave_types lt
 WHERE e.id  = l.employee_id
   AND lt.id = l.leave_type_id
   AND upper(COALESCE(l.status, 'PENDING')) = 'PENDING';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. INDEX — the approver queue
--
-- lib/ess/pending.ts and lib/notifications/derive.ts both filter on
-- (current_approver_id, status). 030 indexed (employee_id, status) for the
-- employee's own list but never the approver's. Invisible at 3 rows.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_leave_app_approver
  ON leave_applications(current_approver_id, status)
  WHERE current_approver_id IS NOT NULL;

-- Overlap detection in the apply route scans an employee's open requests.
CREATE INDEX IF NOT EXISTS idx_leave_app_emp_dates
  ON leave_applications(employee_id, from_date, to_date)
  WHERE status IN ('PENDING', 'APPROVED');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'pending total'        AS what, count(*) AS n FROM leave_applications WHERE status = 'PENDING'
UNION ALL SELECT 'pending stamped',    count(*) FROM leave_applications WHERE status = 'PENDING' AND current_approver_id IS NOT NULL
UNION ALL SELECT 'pending UNROUTABLE', count(*) FROM leave_applications WHERE status = 'PENDING' AND current_approver_id IS NULL
UNION ALL SELECT 'actives with no manager at all', count(*) FROM employees
    WHERE employment_status = 'Active' AND l1_manager_id IS NULL AND hr_manager_id IS NULL;

notify pgrst, 'reload schema';
