-- ════════════════════════════════════════════════════════════════════════════
-- 073_snapshot_arrear_columns.sql — the arrear column family the live
-- sync_month_arrear() writes but nobody ever created.
--
-- Data Sync → Appraisal arrear fails with
--   column "arrear_basic" of relation "payroll_employee_snapshot" does not exist
-- because sql111 added only arrear_total / arrear_months / final_net_pay and then
-- UPDATEs nine head-wise columns that were never declared. The same family is
-- what the run sheet (lib/payroll/core.ts), the Data Sync export (lib/payroll/
-- sync.ts) and the engine's arrear EPF (arrear_employee_pf) expect.
--
-- Additive, nullable, re-runnable. Nothing is computed here — the next Appraisal
-- arrear sync fills them.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE payroll_employee_snapshot
  -- written by sync_month_arrear (sql111)
  ADD COLUMN IF NOT EXISTS arrear_appraisal_effective_date DATE,
  ADD COLUMN IF NOT EXISTS arrear_basic                    NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_hra                      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_conveyance               NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_special_allowance        NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_statutory_bonus          NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_epf_wage                 NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_employee_pf              NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_employer_pf              NUMERIC(14,2),
  -- the wider family the sheet / export list (from the arrear spec); stay NULL until
  -- a later sync version computes them, so the sheet columns exist either way
  ADD COLUMN IF NOT EXISTS arrear_employee_esic            NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_employer_esic            NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_pt                       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_lwf                      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_gratuity                 NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_children_education       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_hostel_allowance         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_flexi_car_lease          NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_flexi_driver_salary      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_flexi_fuel_maintenance   NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_flexi_telephone_internet NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_flexi_meal_card          NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_flexi_gadget_device      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_flexi_attire_uniform     NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_flexi_books_periodicals  NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS arrear_flexi_lta                NUMERIC(14,2);

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT count(*) AS arrear_columns
  FROM information_schema.columns
 WHERE table_name = 'payroll_employee_snapshot' AND column_name LIKE 'arrear\_%';
-- expect 30 (5 that existed + 25 above)

-- ════════════════════════════════════════════════════════════════════════════
-- Part 2 — Loan sync: outstanding_balance → outstanding_principal (sql123, never
-- applied). Data Sync → Loan fails with "column l.outstanding_balance does not
-- exist"; the loans table has outstanding_principal, which the whole app uses.
-- Folded in verbatim (rollback section left out) so one file fixes both errors.
-- ════════════════════════════════════════════════════════════════════════════
-- ── 0) Guard ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'loans' AND column_name = 'outstanding_principal') THEN
    RAISE EXCEPTION 'loans.outstanding_principal is missing — this is not the schema this fix is for.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'loans' AND column_name = 'outstanding_balance') THEN
    RAISE WARNING 'loans.outstanding_balance also exists. Two balance columns on one table WILL drift — decide which one is real before relying on either.';
  END IF;
END $$;


-- ── 1) sync_month_loan ─────────────────────────────────────────────────────
-- One loan, one payroll month, one EMI. The loan_emi_ledger check is what stops
-- a second sync of the same month deducting the EMI twice.
CREATE OR REPLACE FUNCTION sync_month_loan(p_run_id UUID, p_codes TEXT[] DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_run   payroll_runs%ROWTYPE;
  v_count INTEGER := 0;
  r       RECORD;
  v_emi   NUMERIC;
  v_after NUMERIC;
BEGIN
  PERFORM payroll_assert_month_open(p_run_id);
  SELECT * INTO v_run FROM payroll_runs WHERE id = p_run_id;

  FOR r IN
    SELECT l.*, e.emp_code
    FROM loans l
    JOIN payroll_eligible_employees(p_run_id, p_codes) e ON e.id = l.employee_id
    WHERE loan_is_running(l.status)
      AND COALESCE(l.outstanding_principal, 0) > 0
      -- Already deducted for this month → leave it alone.
      AND NOT EXISTS (SELECT 1 FROM loan_emi_ledger g WHERE g.loan_id = l.id AND g.run_id = p_run_id)
  LOOP
    -- The last EMI is only as large as the balance left, or the loan goes negative.
    v_emi   := LEAST(COALESCE(r.emi_amount, 0), COALESCE(r.outstanding_principal, 0));
    IF v_emi <= 0 THEN CONTINUE; END IF;
    v_after := COALESCE(r.outstanding_principal, 0) - v_emi;

    PERFORM save_manual_voucher(p_run_id, r.emp_code, 'Loan EMI', v_emi,
                                'Loan EMI — auto', 'BULK', 'Loan module');

    INSERT INTO loan_emi_ledger (loan_id, run_id, employee_id, emi_amount, balance_before, balance_after)
    VALUES (r.id, p_run_id, r.employee_id, v_emi, r.outstanding_principal, v_after);

    UPDATE loans SET
      outstanding_principal = v_after,
      status       = CASE WHEN v_after <= 0 THEN 'CLOSED' ELSE status END,
      closure_date = CASE WHEN v_after <= 0 THEN CURRENT_DATE ELSE closure_date END,
      closure_type = CASE WHEN v_after <= 0 THEN 'CLOSED' ELSE closure_type END
    WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  PERFORM payroll_log_sync(p_run_id, 'loan', v_count, 0, p_codes);
  RETURN v_count;
END;
$$;


-- ── 2) foreclose_loan ──────────────────────────────────────────────────────
-- Same column, same bug. It would have failed the moment anyone foreclosed.
CREATE OR REPLACE FUNCTION foreclose_loan(p_loan_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  UPDATE loans SET outstanding_principal = 0, status = 'FORECLOSED',
                   closure_date = CURRENT_DATE, closure_type = 'FORECLOSED'
  WHERE id = p_loan_id AND loan_is_running(status);
  RETURN FOUND;
END;
$$;


-- ── 3) Schema cache ────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ── 4) VERIFY ──────────────────────────────────────────────────────────────
-- plpgsql bodies are not checked when they are created, so "it compiled" proves
-- nothing here. This reads the stored source back and looks for the old name.
SELECT p.proname AS function,
       (position('outstanding_balance' in pg_get_functiondef(p.oid)) = 0) AS old_name_gone,
       (position('outstanding_principal' in pg_get_functiondef(p.oid)) > 0) AS new_name_present
  FROM pg_proc p
 WHERE p.proname IN ('sync_month_loan', 'foreclose_loan')
 ORDER BY 1;
-- Both rows must read true, true.


-- ════════════════════════════════════════════════════════════════════════════
-- AFTER THIS
--   Payroll → Data Sync → Loan should run. There are no loans on this database
--   yet (loans, loan_requests, loan_schedule and loan_emi_ledger are all empty),
--   so expect "0 rows" — that is the sync working, not failing.
--
