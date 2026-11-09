-- 212_investment_proof_files.sql — the bills behind an investment proof, as files.
--
-- ESS → Payroll → Investment Proofs had a "Bill / policy reference" text box and nothing
-- else: the employee typed a policy number and HR took it on faith. Now each declared line
-- (80C, 80D, HRA rent, …) takes documents — receipts, policy statements, rent receipts —
-- which HR opens from the review screen before approving.
--
-- One row per uploaded file. The file itself sits in a private bucket; nothing here is a
-- public URL. Only the server (service role) reads or writes this table and that bucket:
-- /api/ess/investment-proofs checks that the caller is the employee, or Payroll staff of
-- the employee's company, and hands out short-lived signed URLs.

CREATE TABLE IF NOT EXISTS investment_proof_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_id      UUID NOT NULL REFERENCES investment_proofs(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id    UUID,
  fy            TEXT NOT NULL,
  section       TEXT,
  file_name     TEXT NOT NULL,
  storage_path  TEXT NOT NULL UNIQUE,
  mime_type     TEXT,
  size_bytes    INTEGER,
  uploaded_by   UUID,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investment_proof_files_proof_idx ON investment_proof_files (proof_id);
CREATE INDEX IF NOT EXISTS investment_proof_files_employee_fy_idx ON investment_proof_files (employee_id, fy);

-- Locked to the server, the way te_* (151) and lms_* (206) are: RLS on, no policy, and the
-- table grant taken away from the browser roles altogether.
ALTER TABLE investment_proof_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON investment_proof_files FROM anon, authenticated;
GRANT ALL ON investment_proof_files TO service_role;

-- A private bucket of its own: receipts and policy statements never share a bucket with
-- anything that has a browser-facing policy. 10 MB a file; PDFs and photos only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('investment-proofs', 'investment-proofs', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
