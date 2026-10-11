-- 134_offer_response_revision_blacklist.sql
--
-- Offers tab: Accepted / Revision / Backout.
--
--   1. Accepted  — the HR Manager uploads the candidate's signed offer letter (PDF) and a
--                  screenshot of the acceptance mail. Stored on offer_acceptances (table from 005,
--                  unused until now) with the new mail_proof_* columns.
--   2. Revision  — the offer goes back to the HR Head, who edits it and re-approves. The note,
--                  who asked, and the HR Head's revised salary calculation live on the request.
--   3. Backout   — optionally blacklists the candidate's Aadhaar and PAN. Aadhaar is never stored
--                  in full: an HMAC (server secret) for matching, plus the last 4 digits to show.
--
-- candidate_blacklist has RLS ON and NO policy: only the server (service role) reads or writes
-- it. PAN and Aadhaar hashes are not readable from the browser.

-- 1. acceptance proof
ALTER TABLE offer_acceptances ADD COLUMN IF NOT EXISTS mail_proof_url  TEXT;
ALTER TABLE offer_acceptances ADD COLUMN IF NOT EXISTS mail_proof_name TEXT;
ALTER TABLE offer_acceptances ADD COLUMN IF NOT EXISTS uploaded_by     TEXT;

ALTER TABLE offer_acceptances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_offer_acceptances" ON offer_acceptances;
CREATE POLICY "allow_all_offer_acceptances" ON offer_acceptances
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 2. revision
ALTER TABLE offer_approval_requests ADD COLUMN IF NOT EXISTS revision_note          TEXT;
ALTER TABLE offer_approval_requests ADD COLUMN IF NOT EXISTS revision_requested_at  TIMESTAMPTZ;
ALTER TABLE offer_approval_requests ADD COLUMN IF NOT EXISTS revision_requested_by  TEXT;
ALTER TABLE offer_approval_requests ADD COLUMN IF NOT EXISTS revision_count         INTEGER DEFAULT 0;
ALTER TABLE offer_approval_requests ADD COLUMN IF NOT EXISTS revised_calculation    JSONB;
ALTER TABLE offer_approval_requests ADD COLUMN IF NOT EXISTS revised_at             TIMESTAMPTZ;
ALTER TABLE offer_approval_requests ADD COLUMN IF NOT EXISTS revised_by             TEXT;

-- 3. blacklist
CREATE TABLE IF NOT EXISTS candidate_blacklist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aadhaar_hash    TEXT,
  aadhaar_last4   TEXT,
  pan             TEXT,
  candidate_id    UUID REFERENCES candidates(id) ON DELETE SET NULL,
  company_id      UUID REFERENCES companies(id) ON DELETE SET NULL,
  candidate_name  TEXT,
  reason          TEXT,
  blacklisted_by  TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (aadhaar_hash IS NOT NULL OR pan IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS candidate_blacklist_aadhaar_idx ON candidate_blacklist (aadhaar_hash) WHERE is_active;
CREATE INDEX IF NOT EXISTS candidate_blacklist_pan_idx     ON candidate_blacklist (pan)          WHERE is_active;

ALTER TABLE candidate_blacklist ENABLE ROW LEVEL SECURITY;
-- deliberately no policy: server-only (service role bypasses RLS)
