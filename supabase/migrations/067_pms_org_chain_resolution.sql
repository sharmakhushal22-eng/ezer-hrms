-- =====================================================================
-- 067_pms_org_chain_resolution.sql — delivered as "056_pms_org_chain_
-- resolution.sql"; renumbered alongside 066 (formerly 055) — see its header.
-- Run 066 first: this file alters pms_overall_rating, which 066 creates.
-- =====================================================================
-- EZER HRMS — Migration 080: PMS Org-Chain Resolution & Readiness Gate
-- Patch on top of 079_pms_module_v2.sql
-- Fixes: employees.hod_id empty for all 398 employees; PMS finalise step
--        has nobody to route to.
-- =====================================================================
-- DECISIONS ENCODED HERE
--   1. HOD lives on DEPARTMENTS, not on employees.
--   2. Resolution order: employees.hod_id -> departments.hod_employee_id -> BLOCK.
--      No silent fallback to L2 or MD. Wrong finaliser is worse than no finaliser.
--   3. Chain is RESOLVED ONCE at period start and SNAPSHOT into
--      pms_overall_rating, so mid-period reorg cannot break live cycles.
--   4. Missing L2 is NOT an error. Missing L1 or HOD IS.
--   5. Higher-role collapse (MD > HOD > RM L2 > RM L1) applied to WORKFLOW,
--      consistent with the existing display rule.
-- ALSO FIXES: column-name mismatch. 079 assumed rm_l1_id / rm_l2_id.
--             Actual schema is l1_manager_id / l2_manager_id.
-- =====================================================================


-- =====================================================================
-- STEP 0 — DIAGNOSTICS. Run these FIRST, before applying anything below.
-- They tell you the size of the job.
-- =====================================================================
/*
-- D1. How many departments? This is how many rows you actually have to fill.
SELECT COUNT(*) AS dept_count FROM departments WHERE status = 'Active';

-- D2. Employees per department — spot the unassigned ones.
SELECT COALESCE(d.dept_name,'** NO DEPARTMENT **') AS dept,
       COUNT(e.id) AS emp_count
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
WHERE e.date_of_leaving IS NULL
GROUP BY 1 ORDER BY 2 DESC;

-- D3. WHO are the 26 with no L1? Almost certainly org-top or data gaps.
SELECT e.emp_code AS employee_code, e.full_name AS employee_name, e.designation,
       d.dept_name AS department_name, e.grade, e.company_doj
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
WHERE e.date_of_leaving IS NULL AND e.l1_manager_id IS NULL
ORDER BY e.grade DESC NULLS LAST, e.company_doj;

-- D4. Collapse cases — same person at two levels.
SELECT COUNT(*) FILTER (WHERE l1_manager_id = l2_manager_id) AS l1_equals_l2,
       COUNT(*) FILTER (WHERE l2_manager_id IS NULL
                          AND l1_manager_id IS NOT NULL)      AS l1_only_chain
FROM employees WHERE date_of_leaving IS NULL;

-- D5. Do managers themselves have managers? Orphan check.
SELECT e.emp_code AS employee_code, e.full_name AS employee_name, 'is L1 but has no L1' AS issue
FROM employees e
WHERE e.date_of_leaving IS NULL AND e.l1_manager_id IS NULL
  AND EXISTS (SELECT 1 FROM employees x WHERE x.l1_manager_id = e.id);
*/


-- =====================================================================
-- STEP 1 — HOD moves to DEPARTMENTS
-- =====================================================================
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS hod_employee_id uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS hod_effective_from date DEFAULT CURRENT_DATE;

COMMENT ON COLUMN departments.hod_employee_id IS
  'Head of Department. PRIMARY source for PMS finalisation routing. '
  'employees.hod_id is an override for matrix / dotted-line exceptions only.';

CREATE INDEX IF NOT EXISTS idx_dept_hod ON departments(hod_employee_id);

-- Optional: history, so a mid-year HOD change is auditable
CREATE TABLE IF NOT EXISTS department_hod_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id   uuid NOT NULL REFERENCES departments(id),
  hod_employee_id uuid NOT NULL REFERENCES employees(id),
  effective_from  date NOT NULL,
  effective_to    date,
  changed_by      uuid,
  change_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Company-level MD (top of chain). Skip if you already have this.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS md_employee_id uuid REFERENCES employees(id);


-- =====================================================================
-- STEP 2 — CHAIN RESOLVER
-- Returns the effective chain for one employee, with a hard block when
-- it cannot be resolved. Never guesses.
-- =====================================================================
CREATE OR REPLACE FUNCTION pms_resolve_chain(p_employee_id uuid)
RETURNS TABLE (
  l1_id           uuid,
  l2_id           uuid,
  hod_id          uuid,
  md_id           uuid,
  finaliser_id    uuid,
  finaliser_role  text,
  chain_shape     text,     -- L1_L2_HOD | L1_HOD | HOD_ONLY | MD_DIRECT
  is_resolvable   boolean,
  block_reason    text
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_l1 uuid; v_l2 uuid; v_hod uuid; v_md uuid;
  v_dept uuid; v_shape text; v_fin uuid; v_finrole text;
  v_reason text := NULL;
BEGIN
  SELECT e.l1_manager_id, e.l2_manager_id, e.hod_id, e.department_id
    INTO v_l1, v_l2, v_hod, v_dept
  FROM employees e WHERE e.id = p_employee_id;

  -- MD (top of chain)
  SELECT c.md_employee_id INTO v_md
  FROM companies c JOIN employees e ON e.company_id = c.id
  WHERE e.id = p_employee_id;

  -- HOD resolution: explicit override -> department -> nothing
  IF v_hod IS NULL AND v_dept IS NOT NULL THEN
    SELECT d.hod_employee_id INTO v_hod FROM departments d WHERE d.id = v_dept;
  END IF;

  ---------------------------------------------------------------------
  -- Higher-role collapse (MD > HOD > RM L2 > RM L1)
  ---------------------------------------------------------------------
  -- Same person at L1 and L2: drop L2, keep them as L1 reviewer
  IF v_l2 IS NOT NULL AND v_l2 = v_l1 THEN v_l2 := NULL; END IF;

  -- Same person at L2 and HOD: drop L2, they act at the higher role
  IF v_l2 IS NOT NULL AND v_hod IS NOT NULL AND v_l2 = v_hod THEN v_l2 := NULL; END IF;

  -- Employee IS the HOD -> finalisation escalates to MD
  IF v_hod = p_employee_id THEN v_hod := v_md; END IF;

  -- Employee IS the MD -> outside PMS
  IF p_employee_id = v_md THEN
    RETURN QUERY SELECT v_l1, v_l2, v_hod, v_md, NULL::uuid, NULL::text,
                        'MD_DIRECT', false, 'Employee is the MD — excluded from PMS';
    RETURN;
  END IF;

  ---------------------------------------------------------------------
  -- Hard gates
  ---------------------------------------------------------------------
  IF v_l1 IS NULL AND v_hod IS NULL THEN
    v_reason := 'No L1 manager and no HOD — employee is unmapped';
  ELSIF v_l1 IS NULL THEN
    v_reason := 'No L1 manager mapped';
  ELSIF v_hod IS NULL THEN
    v_reason := 'No HOD — set departments.hod_employee_id for this department';
  ELSIF v_hod = v_l1 THEN
    -- Department head directly manages this person. One human, two hats.
    -- Escalate finalisation to MD so a second pair of eyes remains.
    IF v_md IS NULL THEN
      v_reason := 'HOD is also the L1 manager and no MD is set to escalate to';
    ELSE
      v_hod := v_md;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    RETURN QUERY SELECT v_l1, v_l2, v_hod, v_md, NULL::uuid, NULL::text,
                        NULL::text, false, v_reason;
    RETURN;
  END IF;

  ---------------------------------------------------------------------
  -- Shape + finaliser
  ---------------------------------------------------------------------
  v_shape := CASE
               WHEN v_l1 IS NOT NULL AND v_l2 IS NOT NULL THEN 'L1_L2_HOD'
               WHEN v_l1 IS NOT NULL                      THEN 'L1_HOD'
               ELSE 'HOD_ONLY' END;

  v_fin     := v_hod;
  v_finrole := 'HOD';

  RETURN QUERY SELECT v_l1, v_l2, v_hod, v_md, v_fin, v_finrole,
                      v_shape, true, NULL::text;
END $$;


-- =====================================================================
-- STEP 3 — READINESS VIEW (the unmapped list HR works off)
-- =====================================================================
CREATE OR REPLACE VIEW vw_pms_org_readiness AS
SELECT e.id AS employee_id, e.emp_code AS employee_code, e.full_name AS employee_name, e.designation,
       e.grade, d.dept_name AS department_name, e.company_id,
       c.l1_id, c.l2_id, c.hod_id, c.chain_shape,
       c.is_resolvable, c.block_reason,
       CASE
         WHEN c.is_resolvable                        THEN 'READY'
         WHEN c.block_reason LIKE '%is the MD%'      THEN 'EXCLUDED'
         WHEN c.block_reason LIKE '%No HOD%'         THEN 'FIX_DEPARTMENT'
         WHEN c.block_reason LIKE '%No L1%'          THEN 'FIX_EMPLOYEE'
         ELSE 'FIX_OTHER'
       END AS readiness_status
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
LEFT JOIN companies   c2 ON c2.id = e.company_id
CROSS JOIN LATERAL pms_resolve_chain(e.id) c
WHERE e.date_of_leaving IS NULL;

-- Rollup for the admin readiness screen
CREATE OR REPLACE VIEW vw_pms_readiness_summary AS
SELECT company_id, readiness_status, COUNT(*) AS emp_count,
       ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY company_id), 1) AS pct
FROM vw_pms_org_readiness
GROUP BY company_id, readiness_status;


-- =====================================================================
-- STEP 4 — SNAPSHOT THE CHAIN AT PERIOD START
-- Once frozen, a mid-period reorg cannot break a live cycle.
-- =====================================================================
ALTER TABLE pms_overall_rating
  ADD COLUMN IF NOT EXISTS chain_shape       text,
  ADD COLUMN IF NOT EXISTS chain_snapshot_at timestamptz;

CREATE OR REPLACE FUNCTION pms_snapshot_chains(p_period_id uuid)
RETURNS TABLE (enrolled int, skipped int, unmapped_codes text[])
LANGUAGE plpgsql AS $$
DECLARE
  v_company uuid; v_policy uuid;
  v_ok int := 0; v_skip int := 0; v_codes text[] := '{}';
  r RECORD;
BEGIN
  SELECT company_id, policy_id INTO v_company, v_policy
  FROM pms_periods WHERE id = p_period_id;

  FOR r IN
    SELECT e.id, e.emp_code AS employee_code, e.department_id, e.grade,
           c.l1_id, c.l2_id, c.hod_id, c.chain_shape,
           c.is_resolvable, c.block_reason
    FROM employees e
    CROSS JOIN LATERAL pms_resolve_chain(e.id) c
    WHERE e.company_id = v_company AND e.date_of_leaving IS NULL
  LOOP
    IF NOT r.is_resolvable THEN
      v_skip  := v_skip + 1;
      v_codes := v_codes || r.employee_code;
      CONTINUE;
    END IF;

    INSERT INTO pms_overall_rating
      (company_id, period_id, employee_id, policy_id, department_id, grade,
       rm_l1_id, rm_l2_id, hod_id, chain_shape, chain_snapshot_at,
       workflow_status)
    VALUES
      (v_company, p_period_id, r.id, v_policy, r.department_id, r.grade,
       r.l1_id, r.l2_id, r.hod_id, r.chain_shape, now(),
       'NOT_STARTED')
    ON CONFLICT (period_id, employee_id) DO NOTHING;

    v_ok := v_ok + 1;
  END LOOP;

  RETURN QUERY SELECT v_ok, v_skip, v_codes;
END $$;


-- =====================================================================
-- STEP 5 — GATE: a period cannot open while anyone is unmapped
-- =====================================================================
CREATE OR REPLACE FUNCTION pms_open_period(p_period_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_company uuid; v_bad int; v_res RECORD;
BEGIN
  SELECT company_id INTO v_company FROM pms_periods WHERE id = p_period_id;

  SELECT COUNT(*) INTO v_bad
  FROM vw_pms_org_readiness
  WHERE company_id = v_company AND readiness_status IN ('FIX_DEPARTMENT','FIX_EMPLOYEE','FIX_OTHER');

  IF v_bad > 0 THEN
    RETURN format('BLOCKED: %s employees have an unresolvable chain. '
                  'See vw_pms_org_readiness.', v_bad);
  END IF;

  SELECT * INTO v_res FROM pms_snapshot_chains(p_period_id);

  UPDATE pms_periods SET status = 'KRA_SETTING' WHERE id = p_period_id;

  RETURN format('OPENED: %s employees enrolled, %s excluded (MD / exited).',
                v_res.enrolled, v_res.skipped);
END $$;


-- =====================================================================
-- STEP 6 — FIX COLUMN-NAME ASSUMPTION FROM 079
-- 079 assumed rm_l1_id / rm_l2_id on employees. Actual: l1_manager_id /
-- l2_manager_id. pms_overall_rating keeps its own rm_* snapshot columns —
-- those are correct and stay. Only the employees-side reads change.
--
-- l1_manager_id / l2_manager_id are appended at the END of the SELECT list
-- rather than inserted after date_of_resignation, where 066 originally put
-- employment_flag: vw_pms_fill_status and vw_pms_exit_priority already
-- depend on this view, and CREATE OR REPLACE VIEW refuses to rename or
-- retype a column at an existing ordinal position — it can only append.
-- Inserting in the middle shifts employment_flag from position 7 to 9 and
-- fails with 42P16. Appending keeps every existing position identical.
-- =====================================================================
CREATE OR REPLACE VIEW vw_pms_employment_flag AS
SELECT e.id AS employee_id, e.emp_code AS employee_code, e.full_name AS employee_name,
       e.company_doj, e.date_of_leaving, e.date_of_resignation,
       CASE
         WHEN e.date_of_leaving   IS NOT NULL AND e.date_of_leaving <= CURRENT_DATE THEN 'EXITED'
         WHEN e.date_of_leaving   IS NOT NULL AND e.date_of_leaving  > CURRENT_DATE THEN 'NOTICE_PERIOD'
         WHEN e.date_of_resignation  IS NOT NULL                                       THEN 'NOTICE_PERIOD'
         WHEN e.company_doj   > CURRENT_DATE - 30                               THEN 'NEW_JOINER'
         ELSE 'ACTIVE'
       END AS employment_flag,
       e.date_of_leaving AS last_working_day,
       CASE WHEN e.date_of_leaving IS NOT NULL
            THEN e.date_of_leaving - CURRENT_DATE END AS days_to_lwd,
       e.l1_manager_id, e.l2_manager_id
FROM employees e;


-- =====================================================================
-- STEP 7 — RLS on new objects
-- =====================================================================
ALTER TABLE department_hod_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS department_hod_history_all ON department_hod_history;
CREATE POLICY department_hod_history_all ON department_hod_history
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);


-- =====================================================================
-- STEP 8 — POPULATE (run after D1/D2 tell you the department list)
-- =====================================================================
/*
-- 8a. Set HOD per department. One row per department, not per employee.
UPDATE departments SET hod_employee_id =
  (SELECT id FROM employees WHERE employee_code = 'SRS0101')
WHERE department_name = 'Finance & Accounts';
-- ... repeat per department

-- 8b. Set the MD.
UPDATE companies SET md_employee_id =
  (SELECT id FROM employees WHERE employee_code = 'SRS0001')
WHERE company_code = 'SRS';

-- 8c. Check readiness.
SELECT * FROM vw_pms_readiness_summary;

-- 8d. Work the remaining list.
SELECT employee_code, employee_name, department_name, readiness_status, block_reason
FROM vw_pms_org_readiness
WHERE readiness_status <> 'READY'
ORDER BY readiness_status, department_name;

-- 8e. Open the period only when 8c shows READY + EXCLUDED only.
SELECT pms_open_period('<period_id>');
*/

-- =====================================================================
-- END 080
-- =====================================================================
