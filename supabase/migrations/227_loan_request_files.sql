-- 227_loan_request_files.sql — the supporting documents behind a loan request.
--
-- ESS → Payroll → Loans → "Apply for a loan" had an amount, a tenure and a free-text reason,
-- and nothing else: an employee could not attach the proof behind that reason — a salary
-- slip, a quotation, a medical bill, an admission letter. Now a loan request takes documents,
-- which the approver (Payroll Manager, then HR) opens before approving.
--
-- One row per uploaded file. The file itself sits in a private bucket; nothing here is a
-- public URL. Only the server (service role) reads or writes this table and that bucket:
-- /api/ess/loans/documents checks that the caller is the employee, or Loans staff of the
-- employee's company, and hands out short-lived signed URLs. Mirrors 212 (investment proofs).

CREATE TABLE IF NOT EXISTS loan_request_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES loan_requests(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id    UUID,
  file_name     TEXT NOT NULL,
  storage_path  TEXT NOT NULL UNIQUE,
  mime_type     TEXT,
  size_bytes    INTEGER,
  uploaded_by   UUID,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loan_request_files_request_idx  ON loan_request_files (request_id);
CREATE INDEX IF NOT EXISTS loan_request_files_employee_idx ON loan_request_files (employee_id);

-- Locked to the server, the way te_* (151), lms_* (206) and investment_proof_files (212) are:
-- RLS on, no policy, and the table grant taken away from the browser roles altogether.
ALTER TABLE loan_request_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON loan_request_files FROM anon, authenticated;
GRANT ALL ON loan_request_files TO service_role;

-- A private bucket of its own: loan documents never share a bucket with anything that has a
-- browser-facing policy. 10 MB a file; PDFs and photos only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('loan-documents', 'loan-documents', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

NOTIFY pgrst, 'reload schema';

SELECT 'loan_request_files ready' AS status,
       (SELECT COUNT(*) FROM loan_request_files) AS files;
