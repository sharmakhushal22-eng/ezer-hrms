-- ============================================================
-- 031_employee_code_sequences.sql — EZER HRMS · Type-wise Employee Code
-- Per company + employment_type sequence, with an ATOMIC increment RPC so the
-- code number is assigned at the moment of generation (ordering = completion
-- order, NOT planned joining date) and is never reused.
--
-- NOTE: spec called this "025" but 025_offer_response_remark.sql exists → 031.
-- Includes the one-time backfill (Section 12) so new codes never clash with the
-- existing employees. Idempotent — safe to re-run.
-- HOW TO RUN: Supabase → SQL Editor → paste → Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_code_sequences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employment_type  TEXT NOT NULL,   -- 'Employee','Intern','NAPS','NATS','Consultant','Contract'
  last_sequence    INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, employment_type)
);
CREATE INDEX IF NOT EXISTS idx_emp_code_seq_lookup ON employee_code_sequences(company_id, employment_type);

-- RLS (project standard permissive)
ALTER TABLE employee_code_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_emp_code_sequences" ON employee_code_sequences;
CREATE POLICY "allow_all_emp_code_sequences" ON employee_code_sequences
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Atomic increment — reserves the next number in one statement (no race, no reuse).
CREATE OR REPLACE FUNCTION get_next_employee_code(p_company_id UUID, p_employment_type TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_next INTEGER;
BEGIN
  INSERT INTO employee_code_sequences (company_id, employment_type, last_sequence)
  VALUES (p_company_id, p_employment_type, 1)
  ON CONFLICT (company_id, employment_type)
  DO UPDATE SET last_sequence = employee_code_sequences.last_sequence + 1, updated_at = now()
  RETURNING last_sequence INTO v_next;
  RETURN v_next;
END;
$$;

-- ── One-time backfill: seed sequences from existing employees so new auto codes
--    continue after the highest used number per company + type (no clash, no reuse).
INSERT INTO employee_code_sequences (company_id, employment_type, last_sequence)
SELECT
  e.company_id,
  e.employment_type,
  COALESCE(MAX(CASE WHEN e.emp_code ~ '\d{4}$'
                    THEN CAST(SUBSTRING(e.emp_code FROM '(\d{4})$') AS INTEGER)
                    ELSE 0 END), 0) AS last_sequence
FROM employees e
WHERE e.company_id IS NOT NULL AND e.employment_type IS NOT NULL
GROUP BY e.company_id, e.employment_type
ON CONFLICT (company_id, employment_type)
DO UPDATE SET last_sequence = GREATEST(employee_code_sequences.last_sequence, EXCLUDED.last_sequence);

notify pgrst, 'reload schema';
