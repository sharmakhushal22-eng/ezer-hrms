-- ============================================================
-- EZER HRMS — Loan Module PART 2: Workflow
-- Migration: 047_loan_workflow
-- Date: 03 July 2026
-- Request -> approval -> agreement -> disburse -> recover
--   -> exit/FNF + closure/part-payment
-- ============================================================

-- ============================================================
-- 1. LOAN REQUESTS (employee submits via ESS)
-- ============================================================
CREATE TABLE IF NOT EXISTS loan_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id           UUID NOT NULL REFERENCES employees(id),
  company_id            UUID NOT NULL REFERENCES companies(id),
  fy                    TEXT NOT NULL,
  loan_type_id          UUID NOT NULL REFERENCES loan_types(id),
  requested_amount      NUMERIC NOT NULL,
  requested_tenure_months INTEGER NOT NULL,
  eligibility_max       NUMERIC,                          -- snapshot at request
  indicative_emi        NUMERIC,                          -- snapshot
  reason                TEXT,
  status                TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN (
                          'SUBMITTED','IN_APPROVAL','APPROVED','REJECTED','CANCELLED'
                        )),
  current_approval_level INTEGER DEFAULT 1,
  created_by            UUID,
  submitted_at          TIMESTAMPTZ DEFAULT now(),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loanreq_emp ON loan_requests(employee_id, status);

-- ============================================================
-- 2. LOAN APPROVALS (multi-level chain, from loan_approval_levels)
-- ============================================================
CREATE TABLE IF NOT EXISTS loan_approvals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            UUID NOT NULL REFERENCES loan_requests(id) ON DELETE CASCADE,
  company_id            UUID NOT NULL,
  level_order           INTEGER NOT NULL,
  approver_role         TEXT NOT NULL,
  approver_id           UUID,                             -- who acted
  action                TEXT NOT NULL DEFAULT 'PENDING' CHECK (action IN (
                          'PENDING','APPROVED','REJECTED'
                        )),
  remarks               TEXT,
  acted_at              TIMESTAMPTZ,
  UNIQUE (request_id, level_order)
);
CREATE INDEX IF NOT EXISTS idx_loanappr_req ON loan_approvals(request_id, level_order);

-- ============================================================
-- 3. LOAN AGREEMENTS (generated + signed)
-- ============================================================
CREATE TABLE IF NOT EXISTS loan_agreements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            UUID NOT NULL REFERENCES loan_requests(id),
  loan_id               UUID,                             -- set after disbursement
  employee_id           UUID NOT NULL,
  company_id            UUID NOT NULL,
  agreement_number      TEXT NOT NULL,
  schedule_snapshot     JSONB,                            -- generated schedule
  terms_version         TEXT DEFAULT 'v1',
  agreement_pdf_url     TEXT,                             -- generated (unsigned)

  -- Signature (BOTH options supported)
  signature_type        TEXT CHECK (signature_type IN ('ESIGN','UPLOAD')),
  esign_name            TEXT,                             -- typed name
  esign_image_url       TEXT,                             -- drawn signature (data/storage)
  signed_pdf_url        TEXT,                             -- uploaded signed PDF
  signed_at             TIMESTAMPTZ,

  status                TEXT NOT NULL DEFAULT 'GENERATED' CHECK (status IN (
                          'GENERATED','SIGNED','UNDER_REVIEW','APPROVED','REJECTED'
                        )),
  reviewed_by           UUID,
  reviewed_at           TIMESTAMPTZ,
  review_remarks        TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loanagr_req ON loan_agreements(request_id);

-- ============================================================
-- 4. LOANS (active loan after disbursement)
-- ============================================================
CREATE TABLE IF NOT EXISTS loans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_number           TEXT NOT NULL,
  request_id            UUID REFERENCES loan_requests(id),
  agreement_id          UUID REFERENCES loan_agreements(id),
  employee_id           UUID NOT NULL REFERENCES employees(id),
  company_id            UUID NOT NULL REFERENCES companies(id),
  loan_type_id          UUID NOT NULL REFERENCES loan_types(id),

  principal             NUMERIC NOT NULL,
  interest_rate         NUMERIC NOT NULL DEFAULT 0,
  interest_type         TEXT NOT NULL,
  tenure_months         INTEGER NOT NULL,
  emi_amount            NUMERIC NOT NULL,
  total_interest        NUMERIC DEFAULT 0,
  total_payable         NUMERIC,

  -- PayWorks: sanction != disbursement
  sanction_date         DATE,
  disbursement_date     DATE,
  recovery_start_date   DATE,
  recovery_end_date     DATE,
  first_emi_fy          TEXT,
  first_emi_month       INTEGER,

  outstanding_principal NUMERIC,
  paid_installments     INTEGER DEFAULT 0,
  remaining_installments INTEGER,

  status                TEXT NOT NULL DEFAULT 'RECOVERING' CHECK (status IN (
                          'DISBURSED','RECOVERING','CLOSED','FORECLOSED','EXIT_RECOVERY'
                        )),
  disbursed_by          UUID,
  utr_number            TEXT,
  remarks               TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loans_emp ON loans(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_loans_company ON loans(company_id, status);

-- ============================================================
-- 5. LOAN SCHEDULE (amortization rows)
-- ============================================================
CREATE TABLE IF NOT EXISTS loan_schedule (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id               UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  installment_number    INTEGER NOT NULL,
  fy                    TEXT NOT NULL,
  month                 INTEGER NOT NULL,                 -- 1=Apr..12=Mar
  due_date              DATE,
  opening_balance       NUMERIC,
  emi_amount            NUMERIC,
  principal_component   NUMERIC,
  interest_component    NUMERIC,
  closing_balance       NUMERIC,
  status                TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                          'PENDING','DEDUCTED','SKIPPED','PARTIAL','WAIVED'
                        )),
  recovered_amount      NUMERIC DEFAULT 0,
  balance               NUMERIC,
  deducted_in_run       UUID,                             -- payroll_runs.id
  deducted_at           TIMESTAMPTZ,
  UNIQUE (loan_id, installment_number)
);
CREATE INDEX IF NOT EXISTS idx_loansch_run ON loan_schedule(fy, month, status);

-- ============================================================
-- 6. LOAN TRANSACTIONS (EMI, part-pay, foreclosure, FNF, skip)
-- ============================================================
CREATE TABLE IF NOT EXISTS loan_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id               UUID NOT NULL REFERENCES loans(id),
  txn_type              TEXT NOT NULL CHECK (txn_type IN (
                          'EMI','PART_PAYMENT','FORECLOSURE','FNF_RECOVERY','SKIP','WAIVER'
                        )),
  amount                NUMERIC NOT NULL,
  txn_date              DATE DEFAULT CURRENT_DATE,
  payroll_run_id        UUID,
  outstanding_after     NUMERIC,
  remarks               TEXT,
  performed_by          UUID,
  source                TEXT DEFAULT 'PAYROLL',           -- PAYROLL / ESS / FINANCE / FNF
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loantxn_loan ON loan_transactions(loan_id, created_at DESC);

-- ============================================================
-- 7. LOAN CLOSURE / PART-PAYMENT REQUESTS (ESS)
-- ============================================================
CREATE TABLE IF NOT EXISTS loan_closure_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id               UUID NOT NULL REFERENCES loans(id),
  employee_id           UUID NOT NULL,
  request_type          TEXT NOT NULL CHECK (request_type IN (
                          'CLOSURE','PART_PAYMENT','EXTRA_DEDUCTION'
                        )),
  amount                NUMERIC,                          -- part-pay / extra amount
  outstanding_at_request NUMERIC,
  status                TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
                          'REQUESTED','APPROVED','APPLIED','REJECTED'
                        )),
  apply_in_fy           TEXT,
  apply_in_month        INTEGER,
  remarks               TEXT,
  requested_at          TIMESTAMPTZ DEFAULT now(),
  applied_at            TIMESTAMPTZ,
  approved_by           UUID
);
CREATE INDEX IF NOT EXISTS idx_loanclose_loan ON loan_closure_requests(loan_id, status);

-- ============================================================
-- 8. LOAN AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS loan_audit_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id               UUID,
  request_id            UUID,
  employee_id           UUID,
  company_id            UUID,
  action                TEXT NOT NULL,
  old_value             JSONB,
  new_value             JSONB,
  performed_by          UUID,
  source                TEXT DEFAULT 'ESS',
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loanaudit_loan ON loan_audit_log(loan_id, created_at DESC);

-- ============================================================
-- 9. RLS (all tables)
-- ============================================================
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'loan_requests','loan_approvals','loan_agreements','loans',
  'loan_schedule','loan_transactions','loan_closure_requests','loan_audit_log'
]) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

-- ============================================================
-- NOTE: payroll_lines.ded_loan_emi already exists (migration 038)
-- ============================================================
