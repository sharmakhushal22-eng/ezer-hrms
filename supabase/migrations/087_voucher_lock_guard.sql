-- =====================================================================
-- EZER HRMS — 087: a locked payroll refuses voucher edits
--
-- ── THE HOLE ───────────────────────────────────────────────────────────
-- Locking was built in two layers: the month (payroll_runs.status LOCKED /
-- DISBURSED) and the employee (payroll_employee_snapshot.is_locked, sql102),
-- with a trigger that silently drops snapshot UPDATEs on locked rows.
--
-- But voucher amounts live in their own table, manual_voucher_entries — the
-- snapshot trigger never sees them. So the Bulk Uploaders screen could delete
-- (or re-save) an incentive on a month that was locked and PAID, and the next
-- recalculation would quietly disagree with what was disbursed.
--
-- ── THE FIX ────────────────────────────────────────────────────────────
-- Both voucher write paths now refuse when either lock is on, with an error
-- that says what to do — RAISE, not a silent skip, because a person pressing
-- one Delete button must be told why nothing happened. (The snapshot trigger
-- skips silently because a 300-row sync must not die on one locked employee;
-- a single voucher edit has no such excuse.)
--
-- The month check is inline rather than payroll_assert_month_open() because
-- that function's message says "Sync blocked", which would be a lie here.
-- Employee-level reuses guard_payroll_edit (sql102) — its message is right.
--
-- Both functions keep their exact signatures — no client change needed, and
-- PostgREST resolves them exactly as before.
-- =====================================================================

-- ── save: create/replace refused on a locked month or employee ─────────
CREATE OR REPLACE FUNCTION save_manual_voucher(
  p_run_id UUID, p_employee_code TEXT, p_head_name TEXT,
  p_amount NUMERIC, p_remark TEXT DEFAULT NULL, p_via TEXT DEFAULT 'INDIVIDUAL',
  p_source_file TEXT DEFAULT NULL
) RETURNS TABLE (action TEXT, entry_id UUID) LANGUAGE plpgsql AS $$
DECLARE
  v_run       payroll_runs%ROWTYPE;
  v_emp_id    UUID;
  v_head_type TEXT;
  v_old       NUMERIC;
  v_id        UUID;
  v_action    TEXT;
BEGIN
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll month not found'; END IF;

  IF v_run.status IN ('LOCKED', 'DISBURSED') THEN
    RAISE EXCEPTION 'Payroll is locked (% is %) — unlock the month to make changes.',
      COALESCE(v_run.period_label, 'this month'), v_run.status;
  END IF;

  SELECT employee_id INTO v_emp_id FROM payroll_employee_snapshot
  WHERE run_id = p_run_id AND employee_code = p_employee_code;
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION 'Employee % is not in this payroll month', p_employee_code;
  END IF;

  -- Raises 'Employee X is locked for this payroll run — unlock before editing'.
  PERFORM guard_payroll_edit(p_run_id, p_employee_code);

  SELECT head_type INTO v_head_type FROM manual_voucher_heads
  WHERE head_name = p_head_name AND is_active;
  IF v_head_type IS NULL THEN
    RAISE EXCEPTION 'Unknown voucher head: %', p_head_name;
  END IF;

  SELECT amount INTO v_old FROM manual_voucher_entries
  WHERE run_id = p_run_id AND employee_id = v_emp_id AND head_name = p_head_name;

  INSERT INTO manual_voucher_entries (
    run_id, company_id, employee_id, employee_code, head_name, head_type,
    amount, remark, uploaded_via, source_file
  ) VALUES (
    p_run_id, v_run.company_id, v_emp_id, p_employee_code, p_head_name, v_head_type,
    COALESCE(p_amount, 0), p_remark, COALESCE(p_via, 'INDIVIDUAL'), NULLIF(TRIM(COALESCE(p_source_file, '')), '')
  )
  ON CONFLICT ON CONSTRAINT uq_mv_entry DO UPDATE
    SET amount = EXCLUDED.amount, remark = EXCLUDED.remark,
        head_type = EXCLUDED.head_type, uploaded_via = EXCLUDED.uploaded_via,
        source_file = COALESCE(EXCLUDED.source_file, manual_voucher_entries.source_file),
        updated_at = now()
  RETURNING id INTO v_id;

  v_action := CASE WHEN v_old IS NULL THEN 'CREATED' ELSE 'REPLACED' END;

  INSERT INTO manual_voucher_audit_log (
    run_id, company_id, employee_id, employee_code, head_name, head_type,
    action, old_amount, new_amount, remark, uploaded_via, source_file
  ) VALUES (
    p_run_id, v_run.company_id, v_emp_id, p_employee_code, p_head_name, v_head_type,
    v_action, v_old, COALESCE(p_amount, 0), p_remark, COALESCE(p_via, 'INDIVIDUAL'),
    NULLIF(TRIM(COALESCE(p_source_file, '')), '')
  );

  RETURN QUERY SELECT v_action, v_id;
END;
$$;

-- ── delete: same two locks, checked off the entry's own run/employee ────
CREATE OR REPLACE FUNCTION delete_manual_voucher(p_entry_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_e      manual_voucher_entries%ROWTYPE;
  v_status TEXT;
  v_label  TEXT;
BEGIN
  SELECT * INTO v_e FROM manual_voucher_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT status, period_label INTO v_status, v_label FROM payroll_runs WHERE id = v_e.run_id;
  IF v_status IN ('LOCKED', 'DISBURSED') THEN
    RAISE EXCEPTION 'Payroll is locked (% is %) — unlock the month to make changes.',
      COALESCE(v_label, 'this month'), v_status;
  END IF;

  PERFORM guard_payroll_edit(v_e.run_id, v_e.employee_code);

  INSERT INTO manual_voucher_audit_log (
    run_id, company_id, employee_id, employee_code, head_name, head_type,
    action, old_amount, new_amount, remark, uploaded_via, source_file
  ) VALUES (
    v_e.run_id, v_e.company_id, v_e.employee_id, v_e.employee_code, v_e.head_name, v_e.head_type,
    'DELETED', v_e.amount, NULL, v_e.remark, v_e.uploaded_via, v_e.source_file
  );

  DELETE FROM manual_voucher_entries WHERE id = p_entry_id;
  RETURN true;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ── verify — both bodies must now mention the lock ──────────────────────
SELECT proname,
       CASE WHEN prosrc ILIKE '%Payroll is locked%' AND prosrc ILIKE '%guard_payroll_edit%'
            THEN 'OK — guarded' ELSE 'NOT APPLIED' END AS result
FROM pg_proc WHERE proname IN ('save_manual_voucher', 'delete_manual_voucher')
ORDER BY proname;
