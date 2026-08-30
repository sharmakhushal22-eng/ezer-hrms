-- ════════════════════════════════════════════════════════════════════════════
-- 071_ess_access_reconciliation.sql — role-wise ESS, built on what is live.
--
-- Source: EZER-RECONCILIATION-ANSWERS.md (30 Aug 2026) reconciling
-- EZER-ESS-ROLE-RENDERING-GUIDE.md against this database. The guide's 074/079/
-- 080/083 were never real; this is the additive replacement. It does NOT add a
-- parallel access system: functional roles stay in ess_roles / ess_user_roles /
-- role_permissions / role_approval_rights, and structural roles (RM, HOD) are
-- DERIVED from employees.l1_manager_id and the department HOD columns, never
-- assigned. Nothing here touches PMS, sql052, the recovery-mail flow, or
-- ess_accounts' login.
--
-- Two departures from the answers, both forced by the data:
--   · HOD source. employees.hod_id is NULL on all 397 rows and
--     departments.hod_employee_id (PMS 066) on all departments. DEPT scope reads
--     BOTH (either one filled makes someone HOD of that department) so whichever
--     HR starts maintaining works. Until one is filled, nobody is an HOD.
--   · Approval gates use the existing role_approval_rights table (approval_type
--     per role), not seven new role_permissions modules — the table already
--     carries RESIGNATION / LEAVE_APPLY / EXPENSE_CLAIM for exactly this purpose.
--     Only the two read-only tabs (Company, Reports) are role_permissions modules.
--
-- RUN THE WHOLE FILE AT ONCE (one transaction). Re-runnable.
-- Requires: 069 (investment_declaration_lines) for the declaration KPI.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ESS enable/disable — employee override → location policy → default ON
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ess_accounts ADD COLUMN IF NOT EXISTS ess_enabled_override BOOLEAN;   -- NULL = follow policy
ALTER TABLE ess_accounts ADD COLUMN IF NOT EXISTS ess_override_reason  TEXT;

CREATE TABLE IF NOT EXISTS ess_location_policy (
  location_id UUID PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  reason      TEXT,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ess_location_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_ess_location_policy" ON ess_location_policy;
CREATE POLICY "allow_all_ess_location_policy" ON ess_location_policy FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION fn_ess_enabled(p_employee_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE
  a  RECORD;
  lp RECORD;
  e  RECORD;
BEGIN
  SELECT status, ess_enabled_override, ess_override_reason, deactivation_reason
    INTO a FROM ess_accounts WHERE employee_id = p_employee_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', false, 'reason', 'No ESS account', 'source', 'account');
  END IF;
  IF a.ess_enabled_override IS NOT NULL THEN
    RETURN jsonb_build_object('enabled', a.ess_enabled_override,
                              'reason', COALESCE(a.ess_override_reason, 'Set for this employee'), 'source', 'employee');
  END IF;
  IF COALESCE(a.status, 'ACTIVE') <> 'ACTIVE' THEN
    RETURN jsonb_build_object('enabled', false, 'reason', COALESCE(a.deactivation_reason, 'Account ' || lower(a.status)), 'source', 'account');
  END IF;
  SELECT location_id, employment_status INTO e FROM employees WHERE id = p_employee_id;
  IF e.location_id IS NOT NULL THEN
    SELECT * INTO lp FROM ess_location_policy WHERE location_id = e.location_id;
    IF FOUND AND NOT lp.is_enabled THEN
      RETURN jsonb_build_object('enabled', false, 'reason', COALESCE(lp.reason, 'ESS is switched off for this location'), 'source', 'location');
    END IF;
  END IF;
  IF COALESCE(e.employment_status, 'Active') <> 'Active' THEN
    RETURN jsonb_build_object('enabled', false, 'reason', 'Employment status: ' || e.employment_status, 'source', 'employee');
  END IF;
  RETURN jsonb_build_object('enabled', true, 'reason', NULL, 'source', 'default');
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Structural scope — derived from the org columns, never assigned
-- ─────────────────────────────────────────────────────────────────────────────
-- Direct reports (TEAM). Flat, one level, exactly lib/ess-scope.ts's rule.
CREATE OR REPLACE FUNCTION ess_direct_reports(p_employee_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM employees
   WHERE l1_manager_id = p_employee_id
     AND COALESCE(employment_status, 'Active') = 'Active'
     AND COALESCE(is_test, false) = false
$$;

-- Departments this person heads — either HOD column counts.
CREATE OR REPLACE FUNCTION ess_hod_departments(p_employee_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM departments WHERE hod_employee_id = p_employee_id
  UNION
  SELECT DISTINCT department_id FROM employees WHERE hod_id = p_employee_id AND department_id IS NOT NULL
$$;

-- Everyone in scope for one scope word. ORG = all active; DEPT = the departments
-- this person heads (or, holding a DEPT-scoped functional role, their own
-- department); BRANCH = own location; TEAM = direct reports; SELF = nobody else.
CREATE OR REPLACE FUNCTION ess_scope_employee_ids(p_employee_id UUID, p_scope TEXT)
RETURNS SETOF UUID LANGUAGE plpgsql STABLE AS $$
DECLARE me RECORD;
BEGIN
  SELECT department_id, location_id INTO me FROM employees WHERE id = p_employee_id;
  IF p_scope = 'ORG' THEN
    RETURN QUERY SELECT id FROM employees WHERE COALESCE(employment_status,'Active')='Active' AND COALESCE(is_test,false)=false AND id <> p_employee_id;
  ELSIF p_scope = 'BRANCH' THEN
    RETURN QUERY SELECT id FROM employees WHERE location_id = me.location_id AND COALESCE(employment_status,'Active')='Active' AND COALESCE(is_test,false)=false AND id <> p_employee_id;
  ELSIF p_scope = 'DEPT' THEN
    RETURN QUERY SELECT id FROM employees
      WHERE department_id IN (SELECT ess_hod_departments(p_employee_id) UNION SELECT me.department_id)
        AND COALESCE(employment_status,'Active')='Active' AND COALESCE(is_test,false)=false AND id <> p_employee_id;
  ELSIF p_scope = 'TEAM' THEN
    RETURN QUERY SELECT ess_direct_reports(p_employee_id);
  END IF;
  RETURN;
END $$;

-- The menu, as data (guide §5). Structural flags + functional roles + the
-- approval types this login can act on. The API merges this with the RMS
-- Grant (role_permissions modules) and renders the nav from it; no component
-- ever compares a role code.
CREATE OR REPLACE FUNCTION ess_menu(p_employee_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_reports INT; v_depts INT; v_roles TEXT[]; v_scope TEXT; v_appr TEXT[]; v_mods JSONB;
BEGIN
  SELECT count(*) INTO v_reports FROM ess_direct_reports(p_employee_id);
  SELECT count(*) INTO v_depts   FROM ess_hod_departments(p_employee_id);

  SELECT COALESCE(array_agg(r.role_code ORDER BY r.sort_order), '{}'),
         COALESCE(max(CASE r.scope WHEN 'ORG' THEN 4 WHEN 'BRANCH' THEN 3 WHEN 'DEPT' THEN 2 WHEN 'TEAM' THEN 1 ELSE 0 END), 0)
    INTO v_roles, v_scope
    FROM ess_accounts a
    JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND ur.is_active
    JOIN ess_roles r ON r.id = ur.role_id
   WHERE a.employee_id = p_employee_id;

  SELECT COALESCE(array_agg(DISTINCT ar.approval_type), '{}') INTO v_appr
    FROM ess_accounts a
    JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND ur.is_active
    JOIN role_approval_rights ar ON ar.role_id = ur.role_id AND ar.can_approve
   WHERE a.employee_id = p_employee_id;

  SELECT COALESCE(jsonb_object_agg(m.module, m.lvl), '{}') INTO v_mods
    FROM (SELECT rp.module,
                 max(CASE rp.access_level WHEN 'FULL' THEN 3 WHEN 'EDIT' THEN 2 WHEN 'VIEW' THEN 1 ELSE 0 END) AS lvl
            FROM ess_accounts a
            JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND ur.is_active
            JOIN role_permissions rp ON rp.role_id = ur.role_id
           WHERE a.employee_id = p_employee_id
           GROUP BY rp.module) m;

  RETURN jsonb_build_object(
    'employee_id',    p_employee_id,
    'is_rm',          v_reports > 0,
    'direct_reports', v_reports,
    'is_hod',         v_depts > 0,
    'hod_departments',(SELECT COALESCE(jsonb_agg(d), '[]') FROM ess_hod_departments(p_employee_id) d),
    'roles',          to_jsonb(v_roles),
    'functional_scope', CASE v_scope::INT WHEN 4 THEN 'ORG' WHEN 3 THEN 'BRANCH' WHEN 2 THEN 'DEPT' WHEN 1 THEN 'TEAM' ELSE 'SELF' END,
    'approval_types', to_jsonb(v_appr),
    'modules',        v_mods
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Delegation — stamp the delegate, never a dual inbox (E3)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ess_role_delegations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delegator_employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  delegate_employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role_id                UUID REFERENCES ess_roles(id),     -- NULL = everything (leave cover)
  starts_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at                TIMESTAMPTZ NOT NULL,
  reason                 TEXT,
  created_by             UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (delegator_employee_id <> delegate_employee_id)
);
CREATE INDEX IF NOT EXISTS ess_role_delegations_active ON ess_role_delegations (delegator_employee_id, starts_at, ends_at);
ALTER TABLE ess_role_delegations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_ess_role_delegations" ON ess_role_delegations;
CREATE POLICY "allow_all_ess_role_delegations" ON ess_role_delegations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Who actually holds p_employee's approvals right now: the delegate while a
-- delegation is live, otherwise the person themself. One hop only.
CREATE OR REPLACE FUNCTION ess_effective_approver(p_employee_id UUID, p_at TIMESTAMPTZ DEFAULT now())
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT delegate_employee_id FROM ess_role_delegations
      WHERE delegator_employee_id = p_employee_id AND role_id IS NULL
        AND p_at >= starts_at AND p_at < ends_at
      ORDER BY starts_at DESC LIMIT 1),
    p_employee_id)
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Approval vocabulary — role_approval_rights + two read-only modules
-- ─────────────────────────────────────────────────────────────────────────────
-- Travel claim stages. RM and HR stages resolve from the employee's own
-- l1_manager_id / hr_manager_id (E1); only the Finance stage is a role lookup.
INSERT INTO role_approval_rights (role_id, approval_type, can_approve, can_reject, can_initiate)
SELECT r.id, v.approval_type, true, true, false
  FROM (VALUES
    ('TRAVEL_CLAIM_FINANCE', 'FINANCE_EXECUTIVE'), ('TRAVEL_CLAIM_FINANCE', 'CFO'), ('TRAVEL_CLAIM_FINANCE', 'PAYROLL_ADMIN'),
    ('EXIT_CLEARANCE_HR',    'HR_MANAGER'), ('EXIT_CLEARANCE_HR',    'HR_HEAD'),
    ('EXIT_CLEARANCE_IT',    'IT'),
    ('EXIT_CLEARANCE_ADMIN', 'ADMIN_COMPANY'), ('EXIT_CLEARANCE_ADMIN', 'ADMIN_SUPER')
  ) AS v(approval_type, role_code)
  JOIN ess_roles r ON r.role_code = v.role_code
 WHERE NOT EXISTS (SELECT 1 FROM role_approval_rights x WHERE x.role_id = r.id AND x.approval_type = v.approval_type);

-- RESIGNATION already exists for HR_MANAGER / HR_HEAD / CHRO — that IS the
-- "HR Manager stage" gate. Nothing to add.

-- The two read-only tabs, as modules on the roles the answers list (B5).
INSERT INTO role_permissions (role_id, module, access_level)
SELECT r.id, v.module, 'VIEW'
  FROM (VALUES
    ('Company Dashboard', 'HR_HEAD'), ('Company Dashboard', 'CHRO'), ('Company Dashboard', 'CFO'), ('Company Dashboard', 'MD'),
    ('ESS Reports', 'HR_HEAD'), ('ESS Reports', 'CHRO'), ('ESS Reports', 'CFO'), ('ESS Reports', 'MD'),
    ('ESS Reports', 'PAYROLL'), ('ESS Reports', 'PAYROLL_ADMIN')
  ) AS v(module, role_code)
  JOIN ess_roles r ON r.role_code = v.role_code
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.module = v.module);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Resignation — stages on the EXISTING employee_resignation row (D1–D5)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exit_reason_master (
  code        TEXT PRIMARY KEY,
  category    TEXT NOT NULL CHECK (category IN ('PUSH','PULL','PERSONAL')),
  label       TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO exit_reason_master (code, category, label, sort_order) VALUES
  ('CAREER_GROWTH',     'PUSH',     'Lack of career growth',              10),
  ('MANAGER',           'PUSH',     'Relationship with manager',          20),
  ('COMPENSATION',      'PUSH',     'Compensation below market',          30),
  ('WORK_LIFE',         'PUSH',     'Workload / work-life balance',       40),
  ('ROLE_FIT',          'PUSH',     'Role not as expected',               50),
  ('BETTER_OPPORTUNITY','PULL',     'Better opportunity',                 60),
  ('HIGHER_STUDIES',    'PULL',     'Higher studies',                     70),
  ('RELOCATION',        'PERSONAL', 'Relocation',                         80),
  ('HEALTH_FAMILY',     'PERSONAL', 'Health / family',                    90),
  ('OTHER',             'PERSONAL', 'Other',                             100)
ON CONFLICT (code) DO NOTHING;
ALTER TABLE exit_reason_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_exit_reason_master" ON exit_reason_master;
CREATE POLICY "allow_all_exit_reason_master" ON exit_reason_master FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE employee_resignation
  ADD COLUMN IF NOT EXISTS reason_code           TEXT REFERENCES exit_reason_master(code),
  ADD COLUMN IF NOT EXISTS is_regrettable        BOOLEAN,                  -- set at HR Manager stage (D4)
  ADD COLUMN IF NOT EXISTS proposed_lwd          DATE,                     -- an RM's suggestion, not binding
  ADD COLUMN IF NOT EXISTS final_lwd             DATE,                     -- set at HR Manager stage
  ADD COLUMN IF NOT EXISTS current_stage         TEXT,                     -- RM_L1 | RM_L2 | HOD | HR_MANAGER | NULL when done
  ADD COLUMN IF NOT EXISTS current_approver_id   UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS submitted_by_employee BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS submitted_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_note        TEXT;

-- 022's CHECK allowed INITIATED / RECOVERY_PENDING / SETTLED / WITHDRAWN. The
-- chain adds one PENDING_* per stage and RETENTION_HOLD; the old values stay valid.
ALTER TABLE employee_resignation DROP CONSTRAINT IF EXISTS employee_resignation_status_check;
ALTER TABLE employee_resignation ADD CONSTRAINT employee_resignation_status_check
  CHECK (status IN ('INITIATED','PENDING_RM_L1','PENDING_RM_L2','PENDING_HOD','PENDING_HR_MANAGER',
                    'RETENTION_HOLD','RECOVERY_PENDING','SETTLED','WITHDRAWN'));

CREATE TABLE IF NOT EXISTS resignation_stage_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resignation_id  UUID NOT NULL REFERENCES employee_resignation(id) ON DELETE CASCADE,
  stage           TEXT NOT NULL,                       -- RM_L1 | RM_L2 | HOD | HR_MANAGER | EMPLOYEE
  approver_id     UUID REFERENCES employees(id),       -- who was stamped for this stage
  actor_id        UUID REFERENCES employees(id),       -- who actually acted (delegate, or the employee)
  action          TEXT NOT NULL CHECK (action IN ('STAMPED','ACKNOWLEDGED','ACCEPTED_WITH_DATE','REQUESTED_RETENTION','RESUMED','SKIPPED','FINAL_LWD_SET','WITHDRAWN')),
  proposed_lwd    DATE,
  note            TEXT,
  actioned_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resignation_stage_log_res ON resignation_stage_log (resignation_id, actioned_at);
ALTER TABLE resignation_stage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_resignation_stage_log" ON resignation_stage_log;
CREATE POLICY "allow_all_resignation_stage_log" ON resignation_stage_log FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Who approves stage X for this employee. NULL when the stage has nobody.
CREATE OR REPLACE FUNCTION fn_resignation_stage_approver(p_employee_id UUID, p_stage TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE e RECORD; v UUID;
BEGIN
  SELECT l1_manager_id, l2_manager_id, hod_id, hr_manager_id, department_id INTO e FROM employees WHERE id = p_employee_id;
  IF p_stage = 'RM_L1' THEN v := e.l1_manager_id;
  ELSIF p_stage = 'RM_L2' THEN v := e.l2_manager_id;
  ELSIF p_stage = 'HOD' THEN
    v := COALESCE(e.hod_id, (SELECT hod_employee_id FROM departments WHERE id = e.department_id));
  ELSIF p_stage = 'HR_MANAGER' THEN
    -- the employee's own HR manager if set, else any active RESIGNATION approver
    v := e.hr_manager_id;
    IF v IS NULL THEN
      SELECT a.employee_id INTO v
        FROM ess_accounts a
        JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND ur.is_active
        JOIN role_approval_rights ar ON ar.role_id = ur.role_id AND ar.approval_type = 'RESIGNATION' AND ar.can_approve
        JOIN ess_roles r ON r.id = ur.role_id
       ORDER BY r.sort_order LIMIT 1;
    END IF;
  END IF;
  RETURN v;
END $$;

-- Move a resignation to its next real stage. Skips a stage whose approver is
-- NULL, is the resigning employee, or already acted on this resignation (D1).
CREATE OR REPLACE FUNCTION fn_resignation_advance(p_resignation_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  r RECORD; stages TEXT[] := ARRAY['RM_L1','RM_L2','HOD','HR_MANAGER'];
  i INT := 1; s TEXT; appr UUID; acted BOOLEAN;
BEGIN
  SELECT * INTO r FROM employee_resignation WHERE id = p_resignation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'resignation % not found', p_resignation_id; END IF;
  IF r.current_stage IS NOT NULL THEN
    i := array_position(stages, r.current_stage) + 1;
  END IF;
  WHILE i <= array_length(stages, 1) LOOP
    s := stages[i];
    appr := fn_resignation_stage_approver(r.employee_id, s);
    SELECT EXISTS (SELECT 1 FROM resignation_stage_log l WHERE l.resignation_id = p_resignation_id
                     AND l.approver_id = appr AND l.action IN ('ACKNOWLEDGED','ACCEPTED_WITH_DATE')) INTO acted;
    IF appr IS NULL OR appr = r.employee_id OR acted THEN
      INSERT INTO resignation_stage_log (resignation_id, stage, approver_id, action, note)
      VALUES (p_resignation_id, s, appr, 'SKIPPED',
              CASE WHEN appr IS NULL THEN 'No approver resolved' WHEN appr = r.employee_id THEN 'Resolves to the resigning employee' ELSE 'Already acted at an earlier stage' END);
      i := i + 1; CONTINUE;
    END IF;
    UPDATE employee_resignation
       SET current_stage = s, current_approver_id = ess_effective_approver(appr), status = 'PENDING_' || s
     WHERE id = p_resignation_id;
    INSERT INTO resignation_stage_log (resignation_id, stage, approver_id, action)
    VALUES (p_resignation_id, s, ess_effective_approver(appr), 'STAMPED');
    RETURN s;
  END LOOP;
  -- Chain exhausted without an HR Manager stamp: park it for HR under the old status.
  UPDATE employee_resignation SET current_stage = NULL, current_approver_id = NULL, status = 'INITIATED' WHERE id = p_resignation_id;
  RETURN NULL;
END $$;

-- Employee submits from ESS (the mockup's chain starts here).
CREATE OR REPLACE FUNCTION fn_resignation_submit(p_employee_id UUID, p_reason_code TEXT, p_date DATE DEFAULT CURRENT_DATE, p_remarks TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_notice INT; v_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM employee_resignation WHERE employee_id = p_employee_id AND status NOT IN ('SETTLED','WITHDRAWN')) THEN
    RAISE EXCEPTION 'An open resignation already exists for this employee';
  END IF;
  SELECT full_name, COALESCE(notice_period_days, 30) INTO v_name, v_notice FROM employees WHERE id = p_employee_id;
  INSERT INTO employee_resignation (employee_id, date_of_resignation, notice_period_days, lwd_as_per_policy, status,
                                    remarks, initiated_by, initiated_by_name, reason_code, submitted_by_employee, submitted_at)
  VALUES (p_employee_id, p_date, v_notice, p_date + v_notice, 'INITIATED', p_remarks, p_employee_id, v_name, p_reason_code, true, now())
  RETURNING id INTO v_id;
  PERFORM fn_resignation_advance(v_id);
  RETURN v_id;
END $$;

-- An approver acts on the stage stamped to them (D2/D3).
CREATE OR REPLACE FUNCTION fn_resignation_act(p_resignation_id UUID, p_actor_id UUID, p_action TEXT,
                                              p_note TEXT DEFAULT NULL, p_lwd DATE DEFAULT NULL,
                                              p_regrettable BOOLEAN DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r RECORD; nxt TEXT;
BEGIN
  SELECT * INTO r FROM employee_resignation WHERE id = p_resignation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'resignation not found'; END IF;

  IF p_action = 'WITHDRAWN' THEN
    IF p_actor_id <> r.employee_id THEN RAISE EXCEPTION 'Only the employee can withdraw a resignation'; END IF;
    UPDATE employee_resignation SET status='WITHDRAWN', current_stage=NULL, current_approver_id=NULL WHERE id = p_resignation_id;
    INSERT INTO resignation_stage_log (resignation_id, stage, actor_id, action, note) VALUES (p_resignation_id, 'EMPLOYEE', p_actor_id, 'WITHDRAWN', p_note);
    RETURN jsonb_build_object('status', 'WITHDRAWN');
  END IF;

  IF r.current_approver_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'This resignation is not waiting on you (stage %, approver %)', r.current_stage, r.current_approver_id;
  END IF;

  IF p_action = 'RESUMED' THEN
    IF r.status <> 'RETENTION_HOLD' THEN RAISE EXCEPTION 'Not on retention hold'; END IF;
    INSERT INTO resignation_stage_log (resignation_id, stage, approver_id, actor_id, action, note) VALUES (p_resignation_id, r.current_stage, r.current_approver_id, p_actor_id, 'RESUMED', p_note);
    UPDATE employee_resignation SET status = 'PENDING_' || current_stage WHERE id = p_resignation_id;
    RETURN jsonb_build_object('status', 'PENDING_' || r.current_stage, 'stage', r.current_stage);
  END IF;

  IF r.status = 'RETENTION_HOLD' THEN RAISE EXCEPTION 'On retention hold — log RESUMED first'; END IF;

  IF p_action = 'REQUESTED_RETENTION' THEN
    INSERT INTO resignation_stage_log (resignation_id, stage, approver_id, actor_id, action, note) VALUES (p_resignation_id, r.current_stage, r.current_approver_id, p_actor_id, 'REQUESTED_RETENTION', p_note);
    UPDATE employee_resignation SET status='RETENTION_HOLD', retention_note = COALESCE(p_note, retention_note) WHERE id = p_resignation_id;
    RETURN jsonb_build_object('status', 'RETENTION_HOLD', 'stage', r.current_stage);
  END IF;

  IF r.current_stage = 'HR_MANAGER' THEN
    IF p_action <> 'FINAL_LWD_SET' THEN RAISE EXCEPTION 'HR Manager stage expects FINAL_LWD_SET'; END IF;
    IF p_lwd IS NULL THEN RAISE EXCEPTION 'final LWD required'; END IF;
    INSERT INTO resignation_stage_log (resignation_id, stage, approver_id, actor_id, action, proposed_lwd, note) VALUES (p_resignation_id, 'HR_MANAGER', r.current_approver_id, p_actor_id, 'FINAL_LWD_SET', p_lwd, p_note);
    UPDATE employee_resignation
       SET final_lwd = p_lwd,
           lwd_confirmed_by_emp = p_lwd,
           notice_shortfall_days = GREATEST(0, lwd_as_per_policy - p_lwd),
           recovery_required = (lwd_as_per_policy - p_lwd) > 0,
           is_regrettable = COALESCE(p_regrettable, is_regrettable),
           status = CASE WHEN (lwd_as_per_policy - p_lwd) > 0 THEN 'RECOVERY_PENDING' ELSE 'SETTLED' END,
           current_stage = NULL, current_approver_id = NULL
     WHERE id = p_resignation_id;
    RETURN jsonb_build_object('status', (SELECT status FROM employee_resignation WHERE id = p_resignation_id), 'final_lwd', p_lwd);
  END IF;

  IF p_action NOT IN ('ACKNOWLEDGED','ACCEPTED_WITH_DATE') THEN RAISE EXCEPTION 'Unknown action %', p_action; END IF;
  INSERT INTO resignation_stage_log (resignation_id, stage, approver_id, actor_id, action, proposed_lwd, note)
  VALUES (p_resignation_id, r.current_stage, r.current_approver_id, p_actor_id, p_action, p_lwd, p_note);
  IF p_action = 'ACCEPTED_WITH_DATE' AND p_lwd IS NOT NULL THEN
    UPDATE employee_resignation SET proposed_lwd = p_lwd WHERE id = p_resignation_id;
  END IF;
  nxt := fn_resignation_advance(p_resignation_id);
  RETURN jsonb_build_object('status', (SELECT status FROM employee_resignation WHERE id = p_resignation_id), 'stage', nxt);
END $$;

-- Attrition by reason, by quarter of the resignation date (D5).
CREATE OR REPLACE VIEW v_attrition_reasons AS
SELECT date_trunc('quarter', r.date_of_resignation)::DATE          AS quarter_start,
       to_char(r.date_of_resignation, 'YYYY') || '-Q' || to_char(r.date_of_resignation, 'Q') AS quarter,
       e.company_id,
       e.department_id,
       d.dept_name,
       COALESCE(m.category, 'UNKNOWN')                               AS category,
       COALESCE(m.label, 'Not recorded')                             AS reason,
       r.reason_code,
       count(*)                                                      AS exits,
       count(*) FILTER (WHERE r.is_regrettable)                      AS regrettable,
       count(*) FILTER (WHERE r.status NOT IN ('SETTLED','WITHDRAWN')) AS open_exits
  FROM employee_resignation r
  JOIN employees e ON e.id = r.employee_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN exit_reason_master m ON m.code = r.reason_code
 WHERE r.status <> 'WITHDRAWN'
 GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Travel claims — stamp the approver on every status change (E1)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE travel_claims ADD COLUMN IF NOT EXISTS current_approver_id UUID REFERENCES employees(id);
CREATE INDEX IF NOT EXISTS travel_claims_current_approver ON travel_claims (current_approver_id) WHERE current_approver_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_travel_resolve_approver(p_employee_id UUID, p_status TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE e RECORD; v UUID;
BEGIN
  SELECT l1_manager_id, hr_manager_id INTO e FROM employees WHERE id = p_employee_id;
  IF p_status = 'PENDING_RM' THEN v := e.l1_manager_id;
  ELSIF p_status = 'PENDING_HR' THEN v := e.hr_manager_id;
  ELSIF p_status = 'PENDING_FINANCE' THEN
    SELECT a.employee_id INTO v
      FROM ess_accounts a
      JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND ur.is_active
      JOIN role_approval_rights ar ON ar.role_id = ur.role_id AND ar.approval_type = 'TRAVEL_CLAIM_FINANCE' AND ar.can_approve
      JOIN ess_roles r ON r.id = ur.role_id
     ORDER BY r.sort_order LIMIT 1;
  END IF;
  RETURN CASE WHEN v IS NULL THEN NULL ELSE ess_effective_approver(v) END;
END $$;

CREATE OR REPLACE FUNCTION trg_travel_claims_stamp() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('PENDING_RM','PENDING_HR','PENDING_FINANCE') THEN
    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.current_approver_id IS NULL THEN
      NEW.current_approver_id := fn_travel_resolve_approver(NEW.employee_id, NEW.status);
    END IF;
  ELSE
    NEW.current_approver_id := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS travel_claims_stamp ON travel_claims;
CREATE TRIGGER travel_claims_stamp BEFORE INSERT OR UPDATE ON travel_claims
  FOR EACH ROW EXECUTE FUNCTION trg_travel_claims_stamp();
-- backfill anything already waiting
UPDATE travel_claims SET current_approver_id = fn_travel_resolve_approver(employee_id, status)
 WHERE status IN ('PENDING_RM','PENDING_HR','PENDING_FINANCE') AND current_approver_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Leave — single RM stage (E2; L2 escalation left OPEN for product)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS current_approver_id UUID REFERENCES employees(id);
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS approver_employee_id UUID REFERENCES employees(id);  -- who actually resolved it
CREATE INDEX IF NOT EXISTS leave_applications_current_approver ON leave_applications (current_approver_id) WHERE current_approver_id IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_leave_applications_stamp() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF upper(COALESCE(NEW.status, 'PENDING')) = 'PENDING' THEN
    IF TG_OP = 'INSERT' OR NEW.current_approver_id IS NULL OR NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.current_approver_id := ess_effective_approver((SELECT l1_manager_id FROM employees WHERE id = NEW.employee_id));
    END IF;
  ELSE
    NEW.current_approver_id := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leave_applications_stamp ON leave_applications;
CREATE TRIGGER leave_applications_stamp BEFORE INSERT OR UPDATE ON leave_applications
  FOR EACH ROW EXECUTE FUNCTION trg_leave_applications_stamp();
UPDATE leave_applications l SET current_approver_id = ess_effective_approver(e.l1_manager_id)
  FROM employees e WHERE e.id = l.employee_id AND upper(COALESCE(l.status,'PENDING')) = 'PENDING' AND l.current_approver_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Audit — access grants, view-as, approval actions outside the stage log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ess_access_audit (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_employee_id   UUID,                  -- NULL for the legacy admin login
  actor_label         TEXT,                  -- email / name for the legacy login
  action              TEXT NOT NULL,         -- VIEW_AS_START | VIEW_AS_END | ROLE_GRANTED | ROLE_REVOKED | DELEGATION_SET | ...
  target_employee_id  UUID,
  detail              JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ess_access_audit_time ON ess_access_audit (created_at DESC);
ALTER TABLE ess_access_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_ess_access_audit" ON ess_access_audit;
CREATE POLICY "allow_all_ess_access_audit" ON ess_access_audit FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Declaration window (F5) — nothing in 062–070 stored the dates
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tds_declaration_window (
  fy                 TEXT PRIMARY KEY,
  declaration_open   DATE NOT NULL,
  declaration_close  DATE NOT NULL,
  proof_close        DATE NOT NULL,          -- after this, unproven declarations are dropped from the projection
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO tds_declaration_window (fy, declaration_open, declaration_close, proof_close)
VALUES ('2026-27', '2026-04-01', '2026-12-31', '2027-01-15')
ON CONFLICT (fy) DO NOTHING;
ALTER TABLE tds_declaration_window ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_tds_declaration_window" ON tds_declaration_window;
CREATE POLICY "allow_all_tds_declaration_window" ON tds_declaration_window FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'rms' AS what, count(*) AS n FROM employees WHERE id IN (SELECT DISTINCT l1_manager_id FROM employees WHERE l1_manager_id IS NOT NULL)
UNION ALL SELECT 'hods', count(*) FROM (SELECT hod_employee_id FROM departments WHERE hod_employee_id IS NOT NULL UNION SELECT hod_id FROM employees WHERE hod_id IS NOT NULL) h
UNION ALL SELECT 'finance approvers', count(*) FROM role_approval_rights WHERE approval_type = 'TRAVEL_CLAIM_FINANCE'
UNION ALL SELECT 'company-tab roles', count(*) FROM role_permissions WHERE module = 'Company Dashboard'
UNION ALL SELECT 'leave stamped', count(*) FROM leave_applications WHERE current_approver_id IS NOT NULL
UNION ALL SELECT 'exit reasons', count(*) FROM exit_reason_master;
