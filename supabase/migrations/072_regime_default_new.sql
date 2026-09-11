-- ════════════════════════════════════════════════════════════════════════════
-- 072_regime_default_new.sql — "no election by the 4th ⇒ New Regime".
--
-- Rule (Khushal, 30 Aug 2026): from now on, any employee who has not chosen a tax
-- regime is put on the NEW regime automatically after the 4th of every month.
--
-- "Has not chosen" means: no SUBMITTED row in tds_declarations for the FY and no
-- SUBMITTED flexi_tds_forms for the FY. employees.tds_regime alone does not count —
-- HR's bulk upload filled it for all 398 employees (209 OLD) before anyone elected,
-- so it is a placeholder, not an election.
--
-- What defaulting does, once per employee per FY:
--   · employees.tds_regime := 'NEW'          (the engine reads this via the snapshot)
--   · tds_declarations upsert regime NEW, declaration_status 'DEFAULTED'
--     (never touches a SUBMITTED row; the employee can still submit their own
--      choice — the calculator overwrites DEFAULTED like a blank)
--   · open payroll snapshots of that FY get tds_regime 'NEW' so a run that was
--     synced before the 5th still taxes the right way
--   · regime_default_log row + an ESS notification
--
-- Called by the cron on the 5th (app/api/cron/regime-default) and by Run Payroll
-- just before the TDS sync; the function itself refuses to act on the 1st–4th
-- unless p_force is true. Re-runnable, idempotent.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS regime_default_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  fy               TEXT NOT NULL,
  previous_regime  TEXT,
  defaulted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  source           TEXT NOT NULL DEFAULT 'rule-4th',
  UNIQUE (employee_id, fy)
);
ALTER TABLE regime_default_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_regime_default_log" ON regime_default_log;
CREATE POLICY "allow_all_regime_default_log" ON regime_default_log FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION fn_current_fy(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN extract(month FROM p_date) >= 4
              THEN extract(year FROM p_date)::INT || '-' || lpad(((extract(year FROM p_date)::INT + 1) % 100)::TEXT, 2, '0')
              ELSE (extract(year FROM p_date)::INT - 1) || '-' || lpad((extract(year FROM p_date)::INT % 100)::TEXT, 2, '0') END
$$;

CREATE OR REPLACE FUNCTION fn_default_regime_new(p_fy TEXT DEFAULT NULL, p_force BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_fy     TEXT := COALESCE(p_fy, fn_current_fy());
  e        RECORD;
  n_new    INT := 0;
  n_seen   INT := 0;
BEGIN
  IF NOT p_force AND extract(day FROM CURRENT_DATE) <= 4 THEN
    RETURN jsonb_build_object('fy', v_fy, 'applied', false, 'reason', 'Before the 5th — elections still open', 'defaulted', 0);
  END IF;

  FOR e IN
    SELECT emp.id, emp.company_id, emp.tds_regime
      FROM employees emp
     WHERE COALESCE(emp.employment_status, 'Active') = 'Active'
       AND COALESCE(emp.is_test, false) = false
       AND NOT EXISTS (SELECT 1 FROM tds_declarations d
                        WHERE d.employee_id = emp.id AND d.fy = v_fy AND d.declaration_status = 'SUBMITTED')
       AND NOT EXISTS (SELECT 1 FROM flexi_tds_forms f
                        WHERE f.employee_id = emp.id AND f.fy = v_fy AND f.status = 'SUBMITTED')
  LOOP
    n_seen := n_seen + 1;

    -- once per employee per FY; a second run on the 6th changes nothing
    INSERT INTO regime_default_log (employee_id, fy, previous_regime)
    VALUES (e.id, v_fy, e.tds_regime)
    ON CONFLICT (employee_id, fy) DO NOTHING;
    IF NOT FOUND THEN CONTINUE; END IF;
    n_new := n_new + 1;

    UPDATE employees SET tds_regime = 'NEW' WHERE id = e.id AND tds_regime IS DISTINCT FROM 'NEW';

    INSERT INTO tds_declarations (employee_id, company_id, fy, regime, declaration_status, total_declared, updated_at)
    VALUES (e.id, e.company_id, v_fy, 'NEW', 'DEFAULTED', 0, now())
    ON CONFLICT (employee_id, fy) DO UPDATE
      SET regime = 'NEW', declaration_status = 'DEFAULTED', updated_at = now()
      WHERE tds_declarations.declaration_status IS DISTINCT FROM 'SUBMITTED';

    -- runs of this FY that are still open follow the new default
    UPDATE payroll_employee_snapshot s
       SET tds_regime = 'NEW'
      FROM payroll_runs pr
     WHERE pr.id = s.run_id AND s.employee_id = e.id AND pr.fy = v_fy
       AND COALESCE(pr.status, '') NOT IN ('DISBURSED', 'LOCKED', 'CANCELLED')
       AND s.tds_regime IS DISTINCT FROM 'NEW';

    INSERT INTO ess_notifications (employee_id, category, title, body, link, is_read)
    VALUES (e.id, 'TAX', 'Tax regime set to New by default',
            'No regime was chosen by the 4th, so the New Regime has been applied for FY ' || v_fy ||
            '. You can still submit your own choice from Payroll → Flexi Benefits.',
            '/ess', false);
  END LOOP;

  RETURN jsonb_build_object('fy', v_fy, 'applied', true, 'without_election', n_seen, 'defaulted', n_new);
END $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- SELECT fn_default_regime_new();                 -- does nothing on the 1st–4th
-- SELECT fn_default_regime_new(NULL, true);       -- force it now
-- SELECT count(*), previous_regime FROM regime_default_log GROUP BY 2;
